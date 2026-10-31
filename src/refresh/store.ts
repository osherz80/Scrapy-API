import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { ChainId } from '../contracts/chains.ts';
import { HttpError } from '../http/errors.ts';
import { scrubText } from '../logger/redact.ts';
import type { DispatchOutcome } from './dispatch.ts';

export interface ActiveConflict {
  chainId: string;
  runId: string;
}

export interface AdmittedRun {
  runId: string;
}

export interface ChainStatusRow {
  id: ChainId;
  displayName: string;
  productCount: number;
  catalogUpdatedAt: string | null;
  sourceUpdatedAt: string | null;
  isStale: boolean;
  latestStatus: string | null;
  activeRunId: string | null;
}

export interface RunStatus {
  runId: string;
  origin: string;
  status: string;
  dispatchState: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  githubRunId: string | null;
  requestedChains: string[];
  chains: Array<{
    chainId: string;
    status: string;
    attemptCount: number;
    successfulBranchCount: number;
    productCount: number;
    errorCode: string | null;
    errorMessage: string | null;
  }>;
}

export interface RefreshStore {
  admit(chains: readonly ChainId[]): Promise<AdmittedRun | { conflicts: ActiveConflict[] }>;
  recordDispatch(runId: string, outcome: DispatchOutcome): Promise<void>;
  getRun(runId: string, now: Date, staleAfterHours: number): Promise<RunStatus | null>;
  listChains(now: Date, staleAfterHours: number): Promise<ChainStatusRow[]>;
}

export class PgRefreshStore implements RefreshStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async admit(chains: readonly ChainId[]): Promise<AdmittedRun | { conflicts: ActiveConflict[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.reconcile(client);
      await client.query(
        'SELECT id FROM supermarket.chains WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
        [chains],
      );
      const conflicts = await client.query<{ chain_id: string; run_id: string }>(
        `SELECT chain_id, run_id FROM supermarket.chain_leases
         WHERE chain_id = ANY($1::text[]) AND expires_at > clock_timestamp()`,
        [chains],
      );
      if (conflicts.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          conflicts: conflicts.rows.map((row) => ({ chainId: row.chain_id, runId: row.run_id })),
        };
      }
      const runId = randomUUID();
      const owner = randomUUID();
      await client.query(
        `INSERT INTO supermarket.refresh_runs(id, origin, status, requested_chains, dispatch_state)
         VALUES ($1, 'MANUAL', 'PENDING', $2::text[], 'PENDING')`,
        [runId, chains],
      );
      for (const chainId of chains) {
        await client.query(
          `INSERT INTO supermarket.refresh_run_chains(run_id, chain_id) VALUES ($1, $2)`,
          [runId, chainId],
        );
      }
      for (const chainId of chains) {
        await client.query(
          `INSERT INTO supermarket.chain_leases(chain_id, run_id, owner_token, expires_at, heartbeat_at)
           VALUES ($1, $2, $3, clock_timestamp() + interval '30 minutes', clock_timestamp())`,
          [chainId, runId, owner],
        );
        await client.query('UPDATE supermarket.chains SET current_run_id = $1 WHERE id = $2', [runId, chainId]);
      }
      await client.query('COMMIT');
      return { runId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    } finally {
      client.release();
    }
  }

  async recordDispatch(runId: string, outcome: DispatchOutcome): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (outcome === 'acknowledged') {
        await client.query(
          `UPDATE supermarket.refresh_runs SET dispatch_state = 'ACKNOWLEDGED'
           WHERE id = $1 AND status = 'PENDING'`,
          [runId],
        );
      } else if (outcome === 'uncertain') {
        await client.query(
          `UPDATE supermarket.refresh_runs SET dispatch_state = 'UNCERTAIN'
           WHERE id = $1 AND status = 'PENDING'`,
          [runId],
        );
      } else {
        await client.query(
          `UPDATE supermarket.refresh_runs
           SET status = 'FAILED', finished_at = clock_timestamp(), dispatch_state = 'REJECTED',
               error_code = 'DISPATCH_REJECTED'
           WHERE id = $1 AND status = 'PENDING'`,
          [runId],
        );
        await client.query(
          `UPDATE supermarket.refresh_run_chains
           SET status = 'FAILED', finished_at = clock_timestamp(), error_code = 'DISPATCH_REJECTED'
           WHERE run_id = $1 AND status = 'PENDING'`,
          [runId],
        );
        await client.query('UPDATE supermarket.chains SET current_run_id = NULL WHERE current_run_id = $1', [runId]);
        await client.query('DELETE FROM supermarket.chain_leases WHERE run_id = $1', [runId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    } finally {
      client.release();
    }
  }

  async getRun(runId: string, now: Date, staleAfterHours: number): Promise<RunStatus | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.reconcile(client);
      const run = await client.query<{
        id: string;
        origin: string;
        status: string;
        dispatch_state: string;
        created_at: Date;
        started_at: Date | null;
        finished_at: Date | null;
        github_run_id: string | null;
        requested_chains: string[];
      }>('SELECT * FROM supermarket.refresh_runs WHERE id = $1', [runId]);
      const row = run.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const chains = await client.query<{
        chain_id: string;
        status: string;
        attempt_count: number;
        successful_branch_count: number;
        product_count: number;
        error_code: string | null;
        error_message: string | null;
      }>(
        `SELECT chain_id, status, attempt_count, successful_branch_count, product_count, error_code, error_message
         FROM supermarket.refresh_run_chains WHERE run_id = $1 ORDER BY chain_id`,
        [runId],
      );
      await client.query('COMMIT');
      void now;
      void staleAfterHours;
      return {
        runId: row.id,
        origin: row.origin,
        status: row.status,
        dispatchState: row.dispatch_state,
        createdAt: row.created_at.toISOString(),
        startedAt: row.started_at?.toISOString() ?? null,
        finishedAt: row.finished_at?.toISOString() ?? null,
        githubRunId: row.github_run_id,
        requestedChains: row.requested_chains,
        chains: chains.rows.map((chain) => ({
          chainId: chain.chain_id,
          status: chain.status,
          attemptCount: chain.attempt_count,
          successfulBranchCount: chain.successful_branch_count,
          productCount: chain.product_count,
          errorCode: chain.error_code,
          errorMessage: sanitize(chain.error_message),
        })),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    } finally {
      client.release();
    }
  }

  async listChains(now: Date, staleAfterHours: number): Promise<ChainStatusRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.reconcile(client);
      const result = await client.query<{
        id: ChainId;
        display_name: string;
        product_count: number;
        catalog_updated_at: Date | null;
        source_updated_at: Date | null;
        active_run_id: string | null;
        latest_status: string | null;
      }>(
        `SELECT c.id, c.display_name, c.product_count, c.catalog_updated_at, c.source_updated_at,
                l.run_id AS active_run_id, rc.status AS latest_status
         FROM supermarket.chains c
         LEFT JOIN supermarket.chain_leases l
           ON l.chain_id = c.id AND l.expires_at > clock_timestamp()
         LEFT JOIN LATERAL (
           SELECT status FROM supermarket.refresh_run_chains
           WHERE chain_id = c.id
           ORDER BY coalesce(started_at, finished_at) DESC NULLS LAST
           LIMIT 1
         ) rc ON true
         ORDER BY c.id`,
      );
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        productCount: row.product_count,
        catalogUpdatedAt: row.catalog_updated_at?.toISOString() ?? null,
        sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
        isStale: row.source_updated_at !== null && now.getTime() - row.source_updated_at.getTime() > staleAfterHours * 60 * 60 * 1000,
        latestStatus: row.latest_status,
        activeRunId: row.active_run_id,
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    } finally {
      client.release();
    }
  }

  private async reconcile(client: pg.PoolClient): Promise<void> {
    const expired = await client.query<{ run_id: string; chain_id: string }>(
      `DELETE FROM supermarket.chain_leases
       WHERE expires_at <= clock_timestamp()
       RETURNING run_id, chain_id`,
    );
    if (expired.rows.length === 0) return;
    await client.query(
      `UPDATE supermarket.chains c SET current_run_id = NULL
       WHERE (c.current_run_id, c.id) IN (SELECT * FROM unnest($1::uuid[], $2::text[]))`,
      [expired.rows.map((row) => row.run_id), expired.rows.map((row) => row.chain_id)],
    );
    const runIds = [...new Set(expired.rows.map((row) => row.run_id))];
    await client.query(
      `UPDATE supermarket.refresh_run_chains
       SET status = 'FAILED', finished_at = clock_timestamp(), error_code = 'LEASE_EXPIRED'
       WHERE run_id = ANY($1::uuid[]) AND status IN ('PENDING', 'RUNNING')
         AND NOT EXISTS (
           SELECT 1 FROM supermarket.chain_leases lease WHERE lease.run_id = refresh_run_chains.run_id
         )`,
      [runIds],
    );
    await client.query(
      `UPDATE supermarket.refresh_runs
       SET status = 'FAILED', finished_at = clock_timestamp(), error_code = 'LEASE_EXPIRED'
       WHERE id = ANY($1::uuid[]) AND status IN ('PENDING', 'RUNNING')
         AND NOT EXISTS (SELECT 1 FROM supermarket.chain_leases lease WHERE lease.run_id = refresh_runs.id)`,
      [runIds],
    );
  }
}

function sanitize(value: string | null): string | null {
  if (value === null) return null;
  return scrubText(value).replace(/bearer\s+\S+/gi, 'bearer [redacted]');
}

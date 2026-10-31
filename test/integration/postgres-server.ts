import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DIR = path.join(ROOT, 'Temp', 'pg-api');
const PORT = 55432;

let server: ReturnType<typeof spawn> | undefined;
let url: string | undefined;

export async function localTestDatabase(): Promise<string> {
  if (url) return url;
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const data = path.join(DIR, 'data');
  await run(path.join(BIN, 'initdb.exe'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  writeFileSync(path.join(data, 'pg_hba.conf'), 'local all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n');
  const log = path.join(DIR, 'server.log');
  server = spawn(path.join(BIN, 'postgres.exe'), ['-D', data, '-p', String(PORT), '-h', '127.0.0.1'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderr: Buffer[] = [];
  server.stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk);
    writeFileSync(log, Buffer.concat(stderr));
  });
  const databaseUrl = `postgresql://postgres@127.0.0.1:${PORT}/postgres`;
  await waitFor(databaseUrl);
  await run(path.join(BIN, 'psql.exe'), ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-c', 'CREATE DATABASE supermarket_api_test']);
  url = `postgresql://postgres@127.0.0.1:${PORT}/supermarket_api_test`;
  return url;
}

export async function stopLocalTestDatabase(): Promise<void> {
  server?.kill();
  server = undefined;
  url = undefined;
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(DIR, { recursive: true, force: true });
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed: ${stderr}`));
    });
  });
}

async function waitFor(databaseUrl: string): Promise<void> {
  const { default: pg } = await import('pg');
  const deadline = Date.now() + 20_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : 'connection failed';
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`PostgreSQL did not start: ${last}`);
}

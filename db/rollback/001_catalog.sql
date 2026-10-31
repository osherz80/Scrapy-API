DROP TABLE IF EXISTS supermarket.chain_leases;
DROP TABLE IF EXISTS supermarket.schedule_claims;
DROP TABLE IF EXISTS supermarket.products;
ALTER TABLE IF EXISTS supermarket.chains DROP CONSTRAINT IF EXISTS chains_current_run_fk;
DROP TABLE IF EXISTS supermarket.refresh_run_chains;
DROP TABLE IF EXISTS supermarket.refresh_runs;
DROP TABLE IF EXISTS supermarket.chains;
DROP FUNCTION IF EXISTS supermarket.distinct_values(text[]);
DROP SCHEMA IF EXISTS supermarket;

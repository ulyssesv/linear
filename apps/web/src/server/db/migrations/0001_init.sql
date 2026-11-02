-- Baseline (MIRROR-R5). The runner creates its own bookkeeping table, schema_migrations,
-- before it applies anything, so this first migration only marks where the schema
-- starts. The mirror tables arrive in the next migration (MIRROR T3).
--
-- Each file runs in one transaction with its row in schema_migrations. Name the next one
-- 0002_<slug>.sql and never edit a migration once it has been released.
select 1;

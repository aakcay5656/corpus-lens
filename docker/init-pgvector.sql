-- Runs once, on first start of an empty data volume.
--
-- The extension is created here rather than in a Drizzle migration because CREATE
-- EXTENSION needs superuser rights that the application role should not hold at
-- migration time. Migrations then assume `vector` already exists.
CREATE EXTENSION IF NOT EXISTS vector;

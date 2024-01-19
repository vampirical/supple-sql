CREATE TABLE supple_migration_a (
  id SERIAL PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO supple_migration_a (value) VALUES
  ('foo'),
  ('bar'),
  ('baz')
;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX documents_title_trgm_idx
  ON documents USING gin (title gin_trgm_ops);
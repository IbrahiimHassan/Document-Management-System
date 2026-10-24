-- "uploader" search matches part of the user's name (ILIKE '%...%')
CREATE INDEX users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);

-- The list is always sorted newest-updated first, then by id for stable pages
CREATE INDEX documents_updated_at_idx
  ON documents (updated_at DESC, id);

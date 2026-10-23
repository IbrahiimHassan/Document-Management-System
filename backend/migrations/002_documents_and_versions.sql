CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  uploader_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  visibility  TEXT NOT NULL DEFAULT 'public',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT documents_visibility_check CHECK (visibility IN ('public', 'restricted'))
);

CREATE INDEX documents_uploader_id_idx ON documents (uploader_id);

CREATE TABLE document_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  storage_key     TEXT NOT NULL UNIQUE,
  original_name   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  uploaded_by     UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT document_versions_size_positive CHECK (size_bytes > 0),
  CONSTRAINT document_versions_unique_number UNIQUE (document_id, version_number)
);

CREATE INDEX document_versions_uploaded_by_idx ON document_versions (uploaded_by);
-- Soft delete: a deleted document disappears for everyone, but its rows, versions,
-- files and audit trail stay, so an admin can see the history and restore it.
ALTER TABLE documents
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users (id) ON DELETE RESTRICT;

CREATE INDEX documents_deleted_by_idx ON documents (deleted_by);

-- The admin "Deleted documents" list, newest first
CREATE INDEX documents_deleted_at_idx ON documents (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- Text pulled out of each file at upload. The tsvector is computed by PostgreSQL
-- itself, so it can never get out of sync with the text.
ALTER TABLE document_versions
  ADD COLUMN content_text TEXT,
  ADD COLUMN content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content_text, ''))) STORED;

CREATE INDEX document_versions_content_tsv_idx
  ON document_versions USING gin (content_tsv);

-- "Is this exact file already in the repository?"
CREATE INDEX document_versions_checksum_idx ON document_versions (checksum_sha256);

-- More kinds of audit events, with optional details (for example which fields an edit changed)
ALTER TABLE document_audit_events
  DROP CONSTRAINT document_audit_events_action_check;

ALTER TABLE document_audit_events
  ADD CONSTRAINT document_audit_events_action_check
    CHECK (action IN ('view', 'preview', 'download', 'edit', 'delete', 'restore'));

ALTER TABLE document_audit_events ADD COLUMN details JSONB;

-- "Which version of each document did this user last download?"
CREATE INDEX document_audit_events_user_downloads_idx
  ON document_audit_events (user_id, document_id, version_number)
  WHERE action = 'download';

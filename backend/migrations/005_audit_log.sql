-- Who looked at or downloaded which document, and when. Rows are only ever inserted.
CREATE TABLE document_audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  action         TEXT NOT NULL,
  version_number INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_audit_events_action_check CHECK (action IN ('view', 'download'))
);

-- "Latest activity on this document"
CREATE INDEX document_audit_events_document_idx
  ON document_audit_events (document_id, created_at DESC);

CREATE INDEX document_audit_events_user_id_idx ON document_audit_events (user_id);

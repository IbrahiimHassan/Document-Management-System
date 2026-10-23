CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tags_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- "Finance" and "finance" cannot both exist
CREATE UNIQUE INDEX tags_name_unique ON tags (lower(name));

CREATE TABLE document_tags (
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- Fast lookup: "all documents with this tag"
CREATE INDEX document_tags_tag_id_idx ON document_tags (tag_id);

CREATE TABLE document_permissions (
  document_id   UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  PRIMARY KEY (document_id, department_id)
);

-- Fast lookup: "all documents this department can see"
CREATE INDEX document_permissions_department_id_idx
  ON document_permissions (department_id);
import type { PoolClient } from "pg";
import { pool } from "../config/database.js";

// The view rule in SQL: admin, uploader, public, or the user's department is allowed.
// Every query that uses it passes [user id, is admin, department id] as $1, $2, $3.
// (The same rule is written in TypeScript in accessService.canView; the
// authorization tests lock both copies to the same answers.)
const VISIBLE_TO_USER = `(
  $2::boolean
  OR d.uploader_id = $1
  OR d.visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM document_permissions dp
    WHERE dp.document_id = d.id AND dp.department_id = $3
  )
)`;

type Viewer = { id: string; role: string; departmentId: string };

function viewerParams(user: Viewer): unknown[] {
  return [user.id, user.role === "admin", user.departmentId];
}

export interface DocumentAccessInfo {
  id: string;
  uploaderId: string;
  visibility: "public" | "restricted";
  allowedDepartmentIds: string[];
}

interface AccessRow {
  id: string;
  uploader_id: string;
  visibility: "public" | "restricted";
  allowed_department_ids: string[];
}

// Deleted documents are treated as missing everywhere
export async function findAccessInfo(
  documentId: string,
): Promise<DocumentAccessInfo | null> {
  const result = await pool.query<AccessRow>(
    `SELECT d.id,
            d.uploader_id,
            d.visibility,
            COALESCE(
              array_agg(dp.department_id) FILTER (WHERE dp.department_id IS NOT NULL),
              '{}'
            ) AS allowed_department_ids
     FROM documents d
     LEFT JOIN document_permissions dp ON dp.document_id = d.id
     WHERE d.id = $1 AND d.deleted_at IS NULL
     GROUP BY d.id`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    uploaderId: row.uploader_id,
    visibility: row.visibility,
    allowedDepartmentIds: row.allowed_department_ids,
  };
}

export interface NewVersionData {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedBy: string;
  // Searchable text pulled out of the file, null when there is none
  contentText: string | null;
}

export interface CreateDocumentData {
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploaderId: string;
  tags: string[];
  departmentIds: string[];
  version: NewVersionData;
}

export interface CreatedVersion {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

async function insertVersion(
  client: PoolClient,
  documentId: string,
  versionNumber: number,
  data: NewVersionData,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO document_versions
       (document_id, version_number, storage_key, original_name,
        mime_type, size_bytes, checksum_sha256, uploaded_by, content_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      documentId,
      versionNumber,
      data.storageKey,
      data.originalName,
      data.mimeType,
      data.sizeBytes,
      data.checksumSha256,
      data.uploadedBy,
      data.contentText,
    ],
  );
  return result.rows[0]!.id;
}

// Replaces the document's tags. Tags are stored once and matched case-insensitively.
async function setTags(client: PoolClient, documentId: string, tags: string[]): Promise<void> {
  await client.query("DELETE FROM document_tags WHERE document_id = $1", [documentId]);
  for (const tag of tags) {
    await client.query(
      `INSERT INTO tags (name) VALUES ($1)
       ON CONFLICT (lower(name)) DO NOTHING`,
      [tag],
    );
    await client.query(
      `INSERT INTO document_tags (document_id, tag_id)
       SELECT $1, id FROM tags WHERE lower(name) = lower($2)
       ON CONFLICT DO NOTHING`,
      [documentId, tag],
    );
  }
}

// Replaces the departments allowed to see a restricted document
async function setPermissions(
  client: PoolClient,
  documentId: string,
  departmentIds: string[],
): Promise<void> {
  await client.query("DELETE FROM document_permissions WHERE document_id = $1", [documentId]);
  for (const departmentId of departmentIds) {
    await client.query(
      `INSERT INTO document_permissions (document_id, department_id)
       VALUES ($1, $2)`,
      [documentId, departmentId],
    );
  }
}

export async function createDocumentWithFirstVersion(
  data: CreateDocumentData,
): Promise<CreatedVersion> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const docResult = await client.query<{ id: string }>(
      `INSERT INTO documents (title, description, uploader_id, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.title, data.description, data.uploaderId, data.visibility],
    );
    const documentId = docResult.rows[0]!.id;

    const versionId = await insertVersion(client, documentId, 1, data.version);

    await setTags(client, documentId, data.tags);

    if (data.visibility === "restricted") {
      await setPermissions(client, documentId, data.departmentIds);
    }

    await client.query("COMMIT");
    return { documentId, versionId, versionNumber: 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addVersion(
  documentId: string,
  data: NewVersionData,
): Promise<CreatedVersion> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the document row so two simultaneous uploads can't pick the same number
    const lock = await client.query(
      "SELECT id FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [documentId],
    );
    if (lock.rowCount === 0) {
      throw new Error("Document disappeared during upload");
    }

    const next = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
       FROM document_versions WHERE document_id = $1`,
      [documentId],
    );
    const versionNumber = next.rows[0]!.next;

    const versionId = await insertVersion(client, documentId, versionNumber, data);

    await client.query(
      "UPDATE documents SET updated_at = now() WHERE id = $1",
      [documentId],
    );

    await client.query("COMMIT");
    return { documentId, versionId, versionNumber };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DocumentChanges {
  title?: string;
  description?: string | null;
  tags?: string[];
  visibility?: "public" | "restricted";
  // The full new list. Only stored while the document is restricted.
  departmentIds?: string[];
}

// Applies an edit in one transaction. Returns false if the document was
// deleted in the meantime.
export async function updateDocument(documentId: string, changes: DocumentChanges): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lock = await client.query<{ visibility: "public" | "restricted" }>(
      "SELECT visibility FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [documentId],
    );
    if (lock.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // COALESCE keeps a column as it is when no new value is sent.
    // description is the exception: null is a real value ("no description"),
    // so a separate flag says whether to change it.
    await client.query(
      `UPDATE documents
       SET title       = COALESCE($2, title),
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           visibility  = COALESCE($5, visibility),
           updated_at  = now()
       WHERE id = $1`,
      [
        documentId,
        changes.title ?? null,
        changes.description !== undefined,
        changes.description ?? null,
        changes.visibility ?? null,
      ],
    );

    if (changes.tags) {
      await setTags(client, documentId, changes.tags);
    }

    const visibility = changes.visibility ?? lock.rows[0]!.visibility;
    if (visibility === "public") {
      await setPermissions(client, documentId, []);
    } else if (changes.departmentIds) {
      await setPermissions(client, documentId, changes.departmentIds);
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Hides the document from everyone. Rows and files stay, so it can be restored.
export async function softDelete(documentId: string, deletedBy: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE documents SET deleted_at = now(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL`,
    [documentId, deletedBy],
  );
  return result.rowCount === 1;
}

export async function restore(documentId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE documents SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
     WHERE id = $1 AND deleted_at IS NOT NULL`,
    [documentId],
  );
  return result.rowCount === 1;
}

export interface DeletedDocument {
  id: string;
  title: string;
  uploaderName: string;
  currentVersion: number;
  deletedAt: string;
  deletedByName: string;
}

export async function listDeleted(limit: number): Promise<DeletedDocument[]> {
  const result = await pool.query<{
    id: string;
    title: string;
    uploader_name: string;
    current_version: number;
    deleted_at: Date;
    deleted_by_name: string;
  }>(
    `SELECT d.id, d.title, u.name AS uploader_name,
            (SELECT max(version_number) FROM document_versions WHERE document_id = d.id) AS current_version,
            d.deleted_at, del.name AS deleted_by_name
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     JOIN users del ON del.id = d.deleted_by
     WHERE d.deleted_at IS NOT NULL
     ORDER BY d.deleted_at DESC, d.id
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    uploaderName: row.uploader_name,
    currentVersion: row.current_version,
    deletedAt: row.deleted_at.toISOString(),
    deletedByName: row.deleted_by_name,
  }));
}

export interface SearchFilters {
  q?: string | undefined;
  tags: string[];
  uploader?: string | undefined;
  limit: number;
  offset: number;
}

// A piece of a search snippet. Matching words have match: true.
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface DocumentSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploaderId: string;
  uploaderName: string;
  tags: string[];
  currentVersion: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  // Where the search words were found inside the file (null when they weren't)
  snippet: SnippetPart[] | null;
}

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploader_id: string;
  uploader_name: string;
  tags: string[];
  current_version: number;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: Date;
  updated_at: Date;
  snippet?: string | null;
}

// ts_headline wraps every match in these two characters. Extracted text never
// contains control characters (textExtraction.cleanText removes them), so they
// can't be confused with the file's own text.
const MARK_START = "\u0002";
const MARK_END = "\u0003";

const HEADLINE_OPTIONS =
  `'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', ` +
  `MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "'`;

function toSnippet(raw: string | null | undefined): SnippetPart[] | null {
  if (!raw) return null;
  const parts: SnippetPart[] = [];
  for (const piece of raw.split(MARK_START)) {
    const end = piece.indexOf(MARK_END);
    if (end === -1) {
      if (piece) parts.push({ text: piece, match: false });
    } else {
      parts.push({ text: piece.slice(0, end), match: true });
      if (end + 1 < piece.length) parts.push({ text: piece.slice(end + 1), match: false });
    }
  }
  return parts.some((part) => part.match) ? parts : null;
}

// "Reconcil invoices!" -> "reconcil:* & invoices:*": every word must appear, and
// each may be the start of a longer word, so results show up while typing.
// Only letters and digits survive, so user input can't inject tsquery syntax.
export function toPrefixQuery(q: string): string | null {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 10);
  return words.length > 0 ? words.map((word) => `${word}:*`).join(" & ") : null;
}

function toSummary(row: SummaryRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    tags: row.tags,
    currentVersion: row.current_version,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    snippet: toSnippet(row.snippet),
  };
}

export async function search(
  user: Viewer,
  filters: SearchFilters,
): Promise<{ items: DocumentSummary[]; total: number }> {
  const params: unknown[] = viewerParams(user);
  const conditions: string[] = ["d.deleted_at IS NULL", VISIBLE_TO_USER];
  let snippetSql = "NULL::text";

  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
    const titleParam = `$${params.length}`;

    const prefixQuery = toPrefixQuery(filters.q);
    if (prefixQuery) {
      params.push(prefixQuery);
      const tsq = `to_tsquery('english', $${params.length})`;

      // The title matches, or the words appear in the CURRENT version's text
      conditions.push(`(
        d.title ILIKE ${titleParam}
        OR EXISTS (
          SELECT 1 FROM document_versions cv
          WHERE cv.document_id = d.id
            AND cv.content_tsv @@ ${tsq}
            AND cv.version_number = (
              SELECT max(mv.version_number) FROM document_versions mv WHERE mv.document_id = d.id
            )
        )
      )`);

      // Highlighting reads the whole text, so it's limited to the start of long files
      snippetSql = `CASE WHEN v.content_tsv @@ ${tsq}
        THEN ts_headline('english', left(v.content_text, 50000), ${tsq}, ${HEADLINE_OPTIONS})
      END`;
    } else {
      conditions.push(`d.title ILIKE ${titleParam}`);
    }
  }

  if (filters.uploader) {
    params.push(`%${filters.uploader.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`u.name ILIKE $${params.length}`);
  }

  if (filters.tags.length > 0) {
    params.push(filters.tags);
    const tagsParam = `$${params.length}`;
    params.push(filters.tags.length);
    conditions.push(
      `(
        SELECT count(DISTINCT t.id)
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id AND lower(t.name) = ANY(${tagsParam}::text[])
      ) = $${params.length}::int`,
    );
  }

  const where = conditions.join(" AND ");

  const countResult = await pool.query<{ total: string }>(
    `SELECT count(*) AS total
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]!.total);

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const result = await pool.query<SummaryRow>(
    `SELECT d.id, d.title, d.description, d.visibility,
            d.uploader_id, u.name AS uploader_name,
            COALESCE(
              (SELECT array_agg(t.name ORDER BY t.name)
               FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.document_id = d.id),
              '{}'
            ) AS tags,
            v.version_number AS current_version,
            v.original_name, v.mime_type, v.size_bytes,
            d.created_at, d.updated_at,
            ${snippetSql} AS snippet
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     JOIN LATERAL (
       SELECT version_number, original_name, mime_type, size_bytes, content_text, content_tsv
       FROM document_versions
       WHERE document_id = d.id
       ORDER BY version_number DESC
       LIMIT 1
     ) v ON true
     WHERE ${where}
     ORDER BY d.updated_at DESC, d.id
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  return { total, items: result.rows.map(toSummary) };
}

export interface DocumentDetail extends DocumentSummary {
  allowedDepartments: { id: string; name: string }[];
  // Whether text could be read from the current file (so it's findable by content)
  hasSearchableText: boolean;
}

export interface VersionRecord {
  id: string;
  versionNumber: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
}

export async function findDetail(documentId: string): Promise<DocumentDetail | null> {
  const result = await pool.query<SummaryRow & { has_text: boolean }>(
    `SELECT d.id, d.title, d.description, d.visibility,
            d.uploader_id, u.name AS uploader_name,
            COALESCE(
              (SELECT array_agg(t.name ORDER BY t.name)
               FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.document_id = d.id),
              '{}'
            ) AS tags,
            v.version_number AS current_version,
            v.original_name, v.mime_type, v.size_bytes,
            d.created_at, d.updated_at,
            v.has_text
     FROM documents d
     JOIN users u ON u.id = d.uploader_id
     JOIN LATERAL (
       SELECT version_number, original_name, mime_type, size_bytes,
              content_text IS NOT NULL AS has_text
       FROM document_versions
       WHERE document_id = d.id
       ORDER BY version_number DESC
       LIMIT 1
     ) v ON true
     WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const departments = await pool.query<{ id: string; name: string }>(
    `SELECT dep.id, dep.name
     FROM document_permissions dp
     JOIN departments dep ON dep.id = dp.department_id
     WHERE dp.document_id = $1
     ORDER BY dep.name`,
    [documentId],
  );

  return {
    ...toSummary(row),
    allowedDepartments: departments.rows,
    hasSearchableText: row.has_text,
  };
}

export async function listVersions(documentId: string): Promise<VersionRecord[]> {
  const result = await pool.query<{
    id: string;
    version_number: number;
    original_name: string;
    mime_type: string;
    size_bytes: string;
    checksum_sha256: string;
    uploaded_by: string;
    uploaded_by_name: string;
    created_at: Date;
  }>(
    `SELECT v.id, v.version_number, v.original_name, v.mime_type,
            v.size_bytes, v.checksum_sha256, v.uploaded_by,
            u.name AS uploaded_by_name, v.created_at
     FROM document_versions v
     JOIN users u ON u.id = v.uploaded_by
     WHERE v.document_id = $1
     ORDER BY v.version_number DESC`,
    [documentId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    uploadedById: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at.toISOString(),
  }));
}

export interface DownloadInfo {
  versionNumber: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

// The current (highest) version, the only one that may be downloaded
export async function findCurrentDownloadInfo(
  documentId: string,
): Promise<DownloadInfo | null> {
  const result = await pool.query<{
    version_number: number;
    storage_key: string;
    original_name: string;
    mime_type: string;
    size_bytes: string;
    checksum_sha256: string;
  }>(
    `SELECT version_number, storage_key, original_name, mime_type, size_bytes, checksum_sha256
     FROM document_versions
     WHERE document_id = $1
     ORDER BY version_number DESC
     LIMIT 1`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    versionNumber: row.version_number,
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
  };
}

// Every version's stored file and expected checksum, newest first (for the integrity check)
export async function listVersionFiles(
  documentId: string,
): Promise<{ versionNumber: number; storageKey: string; checksumSha256: string }[]> {
  const result = await pool.query<{ version_number: number; storage_key: string; checksum_sha256: string }>(
    `SELECT version_number, storage_key, checksum_sha256
     FROM document_versions
     WHERE document_id = $1
     ORDER BY version_number DESC`,
    [documentId],
  );
  return result.rows.map((row) => ({
    versionNumber: row.version_number,
    storageKey: row.storage_key,
    checksumSha256: row.checksum_sha256,
  }));
}

export interface DuplicateMatch {
  id: string;
  title: string;
  versionNumber: number;
}

// Live documents this user can see whose CURRENT file has exactly these bytes.
// Documents the user can't see are never mentioned, so this can't reveal them.
export async function findByCurrentChecksum(user: Viewer, checksum: string): Promise<DuplicateMatch[]> {
  const result = await pool.query<{ id: string; title: string; version_number: number }>(
    // Starts from the checksum index, then keeps only versions that are current
    `SELECT d.id, d.title, v.version_number
     FROM document_versions v
     JOIN documents d ON d.id = v.document_id
     WHERE v.checksum_sha256 = $4
       AND d.deleted_at IS NULL
       AND v.version_number = (
         SELECT max(mv.version_number) FROM document_versions mv WHERE mv.document_id = d.id
       )
       AND ${VISIBLE_TO_USER}
     ORDER BY d.updated_at DESC
     LIMIT 5`,
    [...viewerParams(user), checksum],
  );
  return result.rows.map((row) => ({ id: row.id, title: row.title, versionNumber: row.version_number }));
}

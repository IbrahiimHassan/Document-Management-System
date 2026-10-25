import { pool } from "../config/database.js";

export type AuditAction = "view" | "preview" | "download" | "edit" | "delete" | "restore";

// Extra facts about an event, for example which fields an edit changed
export type AuditDetails = { changes?: string[] } | null;

export interface AuditEvent {
  id: string;
  action: AuditAction;
  versionNumber: number | null;
  details: AuditDetails;
  userId: string;
  userName: string;
  createdAt: string;
}

export async function record(input: {
  documentId: string;
  userId: string;
  action: AuditAction;
  versionNumber?: number | null;
  details?: AuditDetails;
}): Promise<void> {
  await pool.query(
    `INSERT INTO document_audit_events (document_id, user_id, action, version_number, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.documentId,
      input.userId,
      input.action,
      input.versionNumber ?? null,
      input.details ? JSON.stringify(input.details) : null,
    ],
  );
}

export async function listForDocument(documentId: string, limit: number): Promise<AuditEvent[]> {
  const result = await pool.query<{
    id: string;
    action: AuditAction;
    version_number: number | null;
    details: AuditDetails;
    user_id: string;
    user_name: string;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.version_number, e.details, e.user_id, u.name AS user_name, e.created_at
     FROM document_audit_events e
     JOIN users u ON u.id = e.user_id
     WHERE e.document_id = $1
     ORDER BY e.created_at DESC, e.id
     LIMIT $2`,
    [documentId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    versionNumber: row.version_number,
    details: row.details,
    userId: row.user_id,
    userName: row.user_name,
    createdAt: row.created_at.toISOString(),
  }));
}

// For each document, the highest version this user has downloaded.
// Documents they never downloaded are left out.
export async function lastDownloadedVersions(
  userId: string,
  documentIds: string[],
): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();
  const result = await pool.query<{ document_id: string; version: number }>(
    `SELECT document_id, max(version_number) AS version
     FROM document_audit_events
     WHERE user_id = $1 AND action = 'download' AND document_id = ANY($2::uuid[])
     GROUP BY document_id`,
    [userId, documentIds],
  );
  return new Map(result.rows.map((row) => [row.document_id, row.version]));
}

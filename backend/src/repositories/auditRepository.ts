import { pool } from "../config/database.js";

export type AuditAction = "view" | "download";

export interface AuditEvent {
  id: string;
  action: AuditAction;
  versionNumber: number | null;
  userId: string;
  userName: string;
  createdAt: string;
}

export async function record(input: {
  documentId: string;
  userId: string;
  action: AuditAction;
  versionNumber?: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO document_audit_events (document_id, user_id, action, version_number)
     VALUES ($1, $2, $3, $4)`,
    [input.documentId, input.userId, input.action, input.versionNumber ?? null],
  );
}

export async function listForDocument(documentId: string, limit: number): Promise<AuditEvent[]> {
  const result = await pool.query<{
    id: string;
    action: AuditAction;
    version_number: number | null;
    user_id: string;
    user_name: string;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.version_number, e.user_id, u.name AS user_name, e.created_at
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
    userId: row.user_id,
    userName: row.user_name,
    createdAt: row.created_at.toISOString(),
  }));
}

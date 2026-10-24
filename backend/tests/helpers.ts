import bcrypt from "bcryptjs";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { uploadDir } from "../src/config/upload.js";
import * as cache from "../src/cache/cache.js";
import * as searchCache from "../src/cache/searchCache.js";

export const PASSWORD = "password123";

// Low cost so tests stay fast. Production seeding still uses cost 10.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

type Role = "admin" | "manager" | "employee";

export async function resetDb(): Promise<void> {
  await pool.query(
    `TRUNCATE document_audit_events, document_tags, document_permissions,
              document_versions, documents, tags, users, departments CASCADE`,
  );
  // Wait for the first connection, or the flush would be skipped
  await cache.ready();
  await cache.safely((redis) => redis.flushDb());
}

export async function createDepartment(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO departments (name) VALUES ($1) RETURNING id",
    [name],
  );
  return result.rows[0]!.id;
}

export async function createUser(input: {
  name: string;
  email: string;
  role: Role;
  departmentId: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.name, input.email, PASSWORD_HASH, input.role, input.departmentId],
  );
  return result.rows[0]!.id;
}

// Same cast as the demo seed: Finance (admin, manager), Legal, HR
export async function seedWorld() {
  const departments = {
    finance: await createDepartment("Finance"),
    legal: await createDepartment("Legal"),
    hr: await createDepartment("HR"),
  };

  const users = {
    admin: await createUser({ name: "Admin User", email: "admin@example.com", role: "admin", departmentId: departments.finance }),
    finance: await createUser({ name: "Finance Manager", email: "finance@example.com", role: "manager", departmentId: departments.finance }),
    legal: await createUser({ name: "Legal Employee", email: "legal@example.com", role: "employee", departmentId: departments.legal }),
    hr: await createUser({ name: "HR Employee", email: "hr@example.com", role: "employee", departmentId: departments.hr }),
  };

  return { departments, users };
}

// A supertest "agent" remembers cookies, like a browser would
export async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Test login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

// Inserts a document with one version, without a real file (enough for metadata checks)
export async function insertDocument(input: {
  title: string;
  uploaderId: string;
  visibility?: "public" | "restricted";
  departmentIds?: string[];
  tags?: string[];
  description?: string;
}): Promise<string> {
  const visibility = input.visibility ?? "public";

  const doc = await pool.query<{ id: string }>(
    `INSERT INTO documents (title, description, uploader_id, visibility)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.title, input.description ?? null, input.uploaderId, visibility],
  );
  const id = doc.rows[0]!.id;

  await pool.query(
    `INSERT INTO document_versions
       (document_id, version_number, storage_key, original_name, mime_type,
        size_bytes, checksum_sha256, uploaded_by)
     VALUES ($1, 1, $2, 'file.pdf', 'application/pdf', 100, $3, $4)`,
    [id, `${randomUUID()}.pdf`, "a".repeat(64), input.uploaderId],
  );

  for (const tag of input.tags ?? []) {
    await pool.query("INSERT INTO tags (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING", [tag]);
    await pool.query(
      `INSERT INTO document_tags (document_id, tag_id)
       SELECT $1, id FROM tags WHERE lower(name) = lower($2)`,
      [id, tag],
    );
  }

  for (const departmentId of input.departmentIds ?? []) {
    await pool.query(
      "INSERT INTO document_permissions (document_id, department_id) VALUES ($1, $2)",
      [id, departmentId],
    );
  }

  // Raw SQL skips the service, so drop cached searches like an upload would
  await searchCache.invalidateAll();
  return id;
}

type Agent = Awaited<ReturnType<typeof loginAs>>;

// The smallest bytes file-type recognises as a PDF. The label makes each checksum unique.
export function pdfBytes(label = "test"): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
}

// Sends a multipart upload the way the browser form does
export function uploadTo(
  agent: Agent,
  url: string,
  fields: Record<string, string> = {},
  file: { buffer: Buffer; name: string } | null = { buffer: pdfBytes(), name: "file.pdf" },
) {
  let req = agent.post(url);
  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value);
  }
  if (file) {
    req = req.attach("file", file.buffer, file.name);
  }
  return req;
}

// Files currently in the test upload folder (uploads-test/)
export async function listUploadedFiles(): Promise<string[]> {
  try {
    return (await readdir(uploadDir)).sort();
  } catch {
    return [];
  }
}

export async function clearUploads(): Promise<void> {
  await rm(uploadDir, { recursive: true, force: true });
}

import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import {
  clearUploads,
  insertDocument,
  loginAs,
  pdfBytes,
  resetDb,
  seedWorld,
  uploadTo,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "legal" | "hr", Agent>;
let publicDoc: string;
let financeOnly: string;

beforeAll(async () => {
  await resetDb();
  await clearUploads();
  world = await seedWorld();
  agents = {
    admin: await loginAs("admin@example.com"),
    finance: await loginAs("finance@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };

  const created = await uploadTo(agents.finance, "/api/documents", { title: "Audited" });
  publicDoc = created.body.documentId;
  await uploadTo(agents.finance, `/api/documents/${publicDoc}/versions`, {}, {
    buffer: pdfBytes("v2"),
    name: "v2.pdf",
  });

  financeOnly = await insertDocument({
    title: "Finance only",
    uploaderId: world.users.finance,
    visibility: "restricted",
    departmentIds: [world.departments.finance],
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE document_audit_events");
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

async function events() {
  const result = await pool.query<{
    document_id: string;
    user_id: string;
    action: string;
    version_number: number | null;
  }>("SELECT document_id, user_id, action, version_number FROM document_audit_events ORDER BY created_at");
  return result.rows;
}

describe("recording activity", () => {
  it("records who opened a document", async () => {
    await agents.hr.get(`/api/documents/${publicDoc}`);

    expect(await events()).toEqual([
      { document_id: publicDoc, user_id: world.users.hr, action: "view", version_number: null },
    ]);
  });

  it("records a download with the version that was served", async () => {
    await agents.legal.get(`/api/documents/${publicDoc}/download`);

    expect(await events()).toEqual([
      { document_id: publicDoc, user_id: world.users.legal, action: "download", version_number: 2 },
    ]);
  });

  it("does not record a refused download of an older version", async () => {
    expect((await agents.legal.get(`/api/documents/${publicDoc}/download?version=1`)).status).toBe(403);

    expect(await events()).toEqual([]);
  });

  it("does not record attempts on a document the user cannot see", async () => {
    expect((await agents.hr.get(`/api/documents/${financeOnly}`)).status).toBe(404);
    expect((await agents.hr.get(`/api/documents/${financeOnly}/download`)).status).toBe(404);

    expect(await events()).toEqual([]);
  });

  it("does not record a download that failed because the file is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await agents.finance.get(`/api/documents/${financeOnly}/download`)).status).toBe(404);
    expect(await events()).toEqual([]);

    vi.restoreAllMocks();
  });

  it("does not record searches or history lookups", async () => {
    await agents.hr.get("/api/documents");
    await agents.hr.get(`/api/documents/${publicDoc}/versions`);

    expect(await events()).toEqual([]);
  });
});

describe("GET /api/documents/:id/audit", () => {
  beforeEach(async () => {
    await agents.hr.get(`/api/documents/${publicDoc}`);
    await agents.legal.get(`/api/documents/${publicDoc}/download`);
  });

  it("shows the uploader the activity, newest first, with names", async () => {
    const res = await agents.finance.get(`/api/documents/${publicDoc}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.items).toMatchObject([
      { action: "download", versionNumber: 2, userName: "Legal Employee" },
      { action: "view", versionNumber: null, userName: "HR Employee" },
    ]);
  });

  it("lets an admin read it too", async () => {
    const res = await agents.admin.get(`/api/documents/${publicDoc}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("refuses other users who can see the document with 403", async () => {
    const res = await agents.hr.get(`/api/documents/${publicDoc}/audit`);

    expect(res.status).toBe(403);
  });

  it("answers 404 to users who cannot see the document", async () => {
    const res = await agents.hr.get(`/api/documents/${financeOnly}/audit`);

    expect(res.status).toBe(404);
  });

  it("rejects a malformed id with 400 and a missing login with 401", async () => {
    expect((await agents.admin.get("/api/documents/not-a-uuid/audit")).status).toBe(400);
    expect((await request(app).get(`/api/documents/${publicDoc}/audit`)).status).toBe(401);
  });
});

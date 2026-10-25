import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import {
  clearUploads,
  insertDocument,
  listUploadedFiles,
  loginAs,
  pdfBytes,
  resetDb,
  seedWorld,
  uploadTo,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "legal" | "hr", Agent>;
let doc: string;

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
});

// A real upload with two versions, so there are files on disk to keep
beforeEach(async () => {
  const created = await uploadTo(agents.finance, "/api/documents", { title: "Old Policy" }, {
    buffer: pdfBytes(`old policy ${Math.random()}`),
    name: "policy.pdf",
  });
  doc = created.body.documentId;
  await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, {
    buffer: pdfBytes(`old policy v2 ${Math.random()}`),
    name: "policy-v2.pdf",
  });
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

const remove = (agent: Agent, id: string) => agent.delete(`/api/documents/${id}`);
const ids = (body: { items: { id: string }[] }) => body.items.map((d) => d.id);

describe("DELETE /api/documents/:id: who may delete", () => {
  it("lets the uploader delete with 204", async () => {
    const res = await remove(agents.finance, doc);

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("lets an admin delete someone else's document", async () => {
    expect((await remove(agents.admin, doc)).status).toBe(204);
  });

  it("refuses a user who can see it but didn't upload it with 403, and keeps it", async () => {
    expect((await remove(agents.hr, doc)).status).toBe(403);
    expect((await agents.hr.get(`/api/documents/${doc}`)).status).toBe(200);
  });

  it("answers 404 for a hidden document, exactly like an unknown id", async () => {
    const hidden = await insertDocument({
      title: "Hidden",
      uploaderId: world.users.finance,
      visibility: "restricted",
      departmentIds: [world.departments.finance],
    });

    const hiddenRes = await remove(agents.hr, hidden);
    const unknownRes = await remove(agents.hr, UNKNOWN_ID);

    expect(hiddenRes.status).toBe(404);
    expect(hiddenRes.body).toEqual(unknownRes.body);
  });

  it("answers 404 when deleting twice", async () => {
    await remove(agents.finance, doc);

    expect((await remove(agents.finance, doc)).status).toBe(404);
  });

  it("rejects a malformed id with 400 and a missing login with 401", async () => {
    expect((await remove(agents.admin, "not-a-uuid")).status).toBe(400);
    expect((await request(app).delete(`/api/documents/${doc}`)).status).toBe(401);
  });
});

describe("after a delete", () => {
  beforeEach(async () => {
    // Warm the cache, so the test also proves the cached list is dropped
    expect(ids((await agents.hr.get("/api/documents?limit=50")).body)).toContain(doc);
    expect((await remove(agents.finance, doc)).status).toBe(204);
  });

  it("is gone from search for everyone, admins included", async () => {
    for (const agent of [agents.hr, agents.finance, agents.admin]) {
      expect(ids((await agent.get("/api/documents?limit=50")).body)).not.toContain(doc);
    }
  });

  it.each(["", "/versions", "/download", "/preview", "/integrity", "/audit"])(
    "answers 404 on GET %s, even to the uploader and admins",
    async (suffix) => {
      for (const agent of [agents.finance, agents.admin]) {
        expect((await agent.get(`/api/documents/${doc}${suffix}`)).status).toBe(404);
      }
    },
  );

  it("refuses edits and new versions with 404", async () => {
    expect((await agents.finance.patch(`/api/documents/${doc}`).send({ title: "Back?" })).status).toBe(404);
    const upload = await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, {
      buffer: pdfBytes("too late"),
      name: "late.pdf",
    });
    expect(upload.status).toBe(404);
  });

  it("keeps the rows and the files on disk (a soft delete)", async () => {
    const versions = await pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM document_versions WHERE document_id = $1",
      [doc],
    );
    expect(versions.rowCount).toBe(2);

    const files = await listUploadedFiles();
    for (const { storage_key } of versions.rows) {
      expect(files).toContain(storage_key);
    }
  });

  it("records who deleted it", async () => {
    const result = await pool.query(
      "SELECT d.deleted_by, e.user_id FROM documents d JOIN document_audit_events e ON e.document_id = d.id AND e.action = 'delete' WHERE d.id = $1",
      [doc],
    );
    expect(result.rows).toEqual([{ deleted_by: world.users.finance, user_id: world.users.finance }]);
  });
});

describe("deleted documents (admin only)", () => {
  beforeEach(async () => {
    await remove(agents.finance, doc);
  });

  it("lists them for an admin, newest first, with who deleted them", async () => {
    const res = await agents.admin.get("/api/documents/deleted");

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      id: doc,
      title: "Old Policy",
      uploaderName: "Finance Manager",
      deletedByName: "Finance Manager",
      currentVersion: 2,
    });
  });

  it("refuses the list to everyone else with 403, even the uploader", async () => {
    expect((await agents.finance.get("/api/documents/deleted")).status).toBe(403);
    expect((await agents.hr.get("/api/documents/deleted")).status).toBe(403);
  });

  it("restores a document with its history and permissions", async () => {
    const res = await agents.admin.post(`/api/documents/${doc}/restore`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: doc, title: "Old Policy", currentVersion: 2 });
    expect(ids((await agents.hr.get("/api/documents?limit=50")).body)).toContain(doc);
    expect((await agents.hr.get(`/api/documents/${doc}/download`)).status).toBe(200);
    expect(ids((await agents.admin.get("/api/documents/deleted")).body)).not.toContain(doc);
  });

  it("records the restore in the activity, after the delete", async () => {
    await agents.admin.post(`/api/documents/${doc}/restore`);

    const res = await agents.finance.get(`/api/documents/${doc}/audit`);

    expect(res.body.items.slice(0, 2)).toMatchObject([
      { action: "restore", userName: "Admin User" },
      { action: "delete", userName: "Finance Manager" },
    ]);
  });

  it("refuses restore to non-admins with 403", async () => {
    expect((await agents.finance.post(`/api/documents/${doc}/restore`)).status).toBe(403);
  });

  it("answers 404 when restoring a document that isn't deleted, or doesn't exist", async () => {
    await agents.admin.post(`/api/documents/${doc}/restore`);

    expect((await agents.admin.post(`/api/documents/${doc}/restore`)).status).toBe(404);
    expect((await agents.admin.post(`/api/documents/${UNKNOWN_ID}/restore`)).status).toBe(404);
  });
});

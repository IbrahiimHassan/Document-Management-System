import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";

const V1 = pdfBytes("version one");
const V2 = pdfBytes("version two, a little longer");

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"finance" | "legal" | "hr", Agent>;
let publicDoc: string;
let financeOnly: string;

beforeAll(async () => {
  await resetDb();
  await clearUploads();
  world = await seedWorld();
  agents = {
    finance: await loginAs("finance@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };

  const created = await uploadTo(agents.finance, "/api/documents", { title: "Handbook" }, {
    buffer: V1,
    name: "handbook-v1.pdf",
  });
  publicDoc = created.body.documentId;
  await uploadTo(agents.finance, `/api/documents/${publicDoc}/versions`, {}, {
    buffer: V2,
    name: "handbook-v2.pdf",
  });

  const restricted = await uploadTo(agents.finance, "/api/documents", {
    title: "Payroll",
    visibility: "restricted",
    departmentIds: world.departments.finance,
  });
  financeOnly = restricted.body.documentId;
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

// supertest only collects text and JSON by default, so gather the raw bytes ourselves
function download(agent: Agent, url: string) {
  return agent
    .get(url)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

describe("GET /api/documents/:id/download", () => {
  it("serves the current version by default, byte for byte", async () => {
    const res = await download(agents.hr, `/api/documents/${publicDoc}/download`);

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, V2)).toBe(0);
  });

  it("sends headers that make the browser save the file safely", async () => {
    const res = await download(agents.hr, `/api/documents/${publicDoc}/download`);

    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-length"]).toBe(String(V2.length));
    // Quotes are optional for simple names, so accept either form
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="?handbook-v2\.pdf"?$/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves the current version when it is asked for by number", async () => {
    const res = await download(agents.hr, `/api/documents/${publicDoc}/download?version=2`);

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, V2)).toBe(0);
  });

  it("refuses an older version with 403: it can be viewed in the history, not downloaded", async () => {
    const res = await agents.hr.get(`/api/documents/${publicDoc}/download?version=1`);
    const history = await agents.hr.get(`/api/documents/${publicDoc}/versions`);

    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: "FORBIDDEN",
      message: "Only the current version can be downloaded",
    });
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(history.body.items.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });

  it("refuses older versions even for the uploader and admins", async () => {
    const admin = await loginAs("admin@example.com");

    expect((await agents.finance.get(`/api/documents/${publicDoc}/download?version=1`)).status).toBe(403);
    expect((await admin.get(`/api/documents/${publicDoc}/download?version=1`)).status).toBe(403);
  });

  it("keeps non-English file names intact", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Arabic name" }, {
      buffer: pdfBytes("arabic"),
      name: "تقرير.pdf",
    });
    const detail = await agents.finance.get(`/api/documents/${res.body.documentId}`);
    const file = await download(agents.finance, `/api/documents/${res.body.documentId}/download`);

    expect(detail.body.originalName).toBe("تقرير.pdf");
    expect(file.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent("تقرير.pdf")}`,
    );
  });

  it("returns 404 for a version that does not exist", async () => {
    const res = await agents.hr.get(`/api/documents/${publicDoc}/download?version=99`);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Version not found");
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects version=%s with 400", async (version) => {
    const res = await agents.hr.get(`/api/documents/${publicDoc}/download?version=${version}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("lets a user from an allowed department download a restricted document", async () => {
    const res = await download(agents.finance, `/api/documents/${financeOnly}/download`);

    expect(res.status).toBe(200);
  });

  it("answers a hidden document exactly like an unknown one", async () => {
    const hidden = await agents.hr.get(`/api/documents/${financeOnly}/download`);
    const missing = await agents.hr.get(`/api/documents/${UNKNOWN_ID}/download`);

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
    expect(hidden.headers["content-disposition"]).toBeUndefined();
  });

  it("answers 404, not 403, for old versions of a hidden document", async () => {
    const res = await agents.legal.get(`/api/documents/${financeOnly}/download?version=1`);

    expect(res.status).toBe(404);
  });

  it("returns 404 with a clear message when the file is gone from disk", async () => {
    // insertDocument creates the database rows but never writes a file
    const orphan = await insertDocument({ title: "Lost file", uploaderId: world.users.finance });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await agents.finance.get(`/api/documents/${orphan}/download`);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("The file for this version is no longer available");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("rejects a malformed id with 400", async () => {
    const res = await agents.hr.get("/api/documents/not-a-uuid/download");

    expect(res.status).toBe(400);
  });

  it("requires a login", async () => {
    const res = await request(app).get(`/api/documents/${publicDoc}/download`);

    expect(res.status).toBe(401);
  });
});

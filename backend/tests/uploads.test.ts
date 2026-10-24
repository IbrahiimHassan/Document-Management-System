import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { maxUploadBytes } from "../src/config/upload.js";
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

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

async function versionsOf(documentId: string) {
  const result = await pool.query<{
    version_number: number;
    storage_key: string;
    checksum_sha256: string;
    mime_type: string;
    original_name: string;
  }>(
    `SELECT version_number, storage_key, checksum_sha256, mime_type, original_name
     FROM document_versions WHERE document_id = $1 ORDER BY version_number`,
    [documentId],
  );
  return result.rows;
}

// Runs an upload that should be rejected and checks nothing was written to disk
async function expectRejectedWithoutFile(
  send: () => Promise<{ status: number; body: { error: { code: string } } }>,
  status: number,
  code: string,
) {
  const before = await listUploadedFiles();
  const res = await send();

  expect(res.status).toBe(status);
  expect(res.body.error.code).toBe(code);
  expect(await listUploadedFiles()).toEqual(before);
  return res;
}

describe("POST /api/documents (first upload)", () => {
  it("creates the document as version 1 and stores the file on disk", async () => {
    const bytes = pdfBytes("first upload");
    const res = await uploadTo(
      agents.finance,
      "/api/documents",
      { title: "Travel Policy", description: "How to book trips" },
      { buffer: bytes, name: "travel.pdf" },
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ versionNumber: 1 });

    const [v1] = await versionsOf(res.body.documentId);
    expect(v1).toMatchObject({
      version_number: 1,
      mime_type: "application/pdf",
      original_name: "travel.pdf",
      checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await listUploadedFiles()).toContain(v1!.storage_key);
  });

  it("stores the file under a random name, not the uploaded one", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Naming" }, {
      buffer: pdfBytes("naming"),
      name: "../../evil.pdf",
    });

    const [v1] = await versionsOf(res.body.documentId);
    expect(v1!.storage_key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it("cleans up tags: lower case, trimmed, no duplicates", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", {
      title: "Tagged",
      tags: " Finance, policy ,FINANCE,,",
    });

    const detail = await agents.finance.get(`/api/documents/${res.body.documentId}`);
    expect(detail.body.tags).toEqual(["finance", "policy"]);
  });

  it("saves the allowed departments of a restricted document", async () => {
    const res = await uploadTo(agents.legal, "/api/documents", {
      title: "Legal and HR memo",
      visibility: "restricted",
      departmentIds: `${world.departments.legal},${world.departments.hr}`,
    });

    expect(res.status).toBe(201);
    const detail = await agents.legal.get(`/api/documents/${res.body.documentId}`);
    expect(detail.body.visibility).toBe("restricted");
    expect(detail.body.allowedDepartments.map((d: { name: string }) => d.name)).toEqual([
      "HR",
      "Legal",
    ]);
  });

  it("trusts the file's bytes, not its name: a PDF called .docx is saved as a PDF", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Renamed" }, {
      buffer: pdfBytes("renamed"),
      name: "report.docx",
    });

    expect(res.status).toBe(201);
    const [v1] = await versionsOf(res.body.documentId);
    expect(v1!.mime_type).toBe("application/pdf");
    expect(v1!.storage_key).toMatch(/\.pdf$/);
  });
});

describe("POST /api/documents rejects bad uploads", () => {
  it("rejects a text file renamed to .pdf with 415", async () => {
    await expectRejectedWithoutFile(
      () =>
        uploadTo(agents.finance, "/api/documents", { title: "Fake" }, {
          buffer: Buffer.from("just some text, not a pdf"),
          name: "fake.pdf",
        }),
      415,
      "UNSUPPORTED_FILE_TYPE",
    );
  });

  it("rejects an image with 415", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
      "hex",
    );
    await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, "/api/documents", { title: "Picture" }, { buffer: png, name: "photo.png" }),
      415,
      "UNSUPPORTED_FILE_TYPE",
    );
  });

  it("rejects a file over the size limit with 413", async () => {
    const tooBig = Buffer.concat([pdfBytes("big"), Buffer.alloc(maxUploadBytes)]);

    await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, "/api/documents", { title: "Huge" }, { buffer: tooBig, name: "huge.pdf" }),
      413,
      "FILE_TOO_LARGE",
    );
  });

  it("rejects a request with no file with 400", async () => {
    const res = await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, "/api/documents", { title: "No file" }, null),
      400,
      "VALIDATION_ERROR",
    );
    expect(res.body.error.message).toContain("file is required");
  });

  it("rejects a file sent under the wrong field name with 400", async () => {
    await expectRejectedWithoutFile(
      () =>
        agents.finance
          .post("/api/documents")
          .field("title", "Wrong field")
          .attach("document", pdfBytes(), "file.pdf"),
      400,
      "VALIDATION_ERROR",
    );
  });

  it.each([
    ["a missing title", {}],
    ["a blank title", { title: "   " }],
    ["a title over 200 characters", { title: "x".repeat(201) }],
    ["an unknown visibility", { title: "Bad", visibility: "secret" }],
    ["a restricted document with no departments", { title: "Bad", visibility: "restricted" }],
    ["a malformed department id", { title: "Bad", visibility: "restricted", departmentIds: "nope" }],
    ["more than 10 tags", { title: "Bad", tags: "a,b,c,d,e,f,g,h,i,j,k" }],
    ["a tag over 30 characters", { title: "Bad", tags: "x".repeat(31) }],
  ])("rejects %s with 400 and writes nothing", async (_name, fields) => {
    await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, "/api/documents", fields as Record<string, string>),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("rejects a department id that does not exist with 400 (not a 500)", async () => {
    const res = await expectRejectedWithoutFile(
      () =>
        uploadTo(agents.finance, "/api/documents", {
          title: "Ghost department",
          visibility: "restricted",
          departmentIds: `${world.departments.finance},${UNKNOWN_ID}`,
        }),
      400,
      "VALIDATION_ERROR",
    );
    expect(res.body.error.message).toBe("One or more departments do not exist");

    const docs = await pool.query("SELECT 1 FROM documents WHERE title = 'Ghost department'");
    expect(docs.rowCount).toBe(0);
  });
});

describe("POST /api/documents/:id/versions", () => {
  let documentId: string;

  beforeAll(async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Versioned" }, {
      buffer: pdfBytes("v1"),
      name: "v1.pdf",
    });
    documentId = res.body.documentId;
  });

  it("the uploader adds version 2 and version 1 stays on disk", async () => {
    const res = await uploadTo(agents.finance, `/api/documents/${documentId}/versions`, {}, {
      buffer: pdfBytes("v2"),
      name: "v2.pdf",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ documentId, versionNumber: 2 });

    const versions = await versionsOf(documentId);
    expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
    expect(versions[0]!.storage_key).not.toBe(versions[1]!.storage_key);

    const onDisk = await listUploadedFiles();
    for (const v of versions) {
      expect(onDisk).toContain(v.storage_key);
    }
  });

  it("the detail and history show the new version as current", async () => {
    const detail = await agents.finance.get(`/api/documents/${documentId}`);
    const history = await agents.finance.get(`/api/documents/${documentId}/versions`);

    expect(detail.body.currentVersion).toBe(2);
    expect(detail.body.originalName).toBe("v2.pdf");
    expect(history.body.items.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });

  it("an admin may add a version to someone else's document", async () => {
    const res = await uploadTo(agents.admin, `/api/documents/${documentId}/versions`, {}, {
      buffer: pdfBytes("admin version"),
      name: "admin.pdf",
    });

    expect(res.status).toBe(201);
    expect(res.body.versionNumber).toBe(3);
  });

  it("a user who can see the document but did not upload it gets 403", async () => {
    await expectRejectedWithoutFile(
      () => uploadTo(agents.legal, `/api/documents/${documentId}/versions`),
      403,
      "FORBIDDEN",
    );
  });

  it("a user who cannot see the document gets 404", async () => {
    const hidden = await insertDocument({
      title: "Finance only",
      uploaderId: world.users.finance,
      visibility: "restricted",
      departmentIds: [world.departments.finance],
    });

    await expectRejectedWithoutFile(
      () => uploadTo(agents.hr, `/api/documents/${hidden}/versions`),
      404,
      "NOT_FOUND",
    );
  });

  it("an unknown document gives 404 and a malformed id gives 400", async () => {
    await expectRejectedWithoutFile(
      () => uploadTo(agents.admin, `/api/documents/${UNKNOWN_ID}/versions`),
      404,
      "NOT_FOUND",
    );
    await expectRejectedWithoutFile(
      () => uploadTo(agents.admin, "/api/documents/not-a-uuid/versions"),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("applies the same file type check to new versions", async () => {
    await expectRejectedWithoutFile(
      () =>
        uploadTo(agents.finance, `/api/documents/${documentId}/versions`, {}, {
          buffer: Buffer.from("not a pdf"),
          name: "v4.pdf",
        }),
      415,
      "UNSUPPORTED_FILE_TYPE",
    );
  });

  it("gives simultaneous uploads distinct, gap-free version numbers", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Race" });
    const raceId = res.body.documentId;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        uploadTo(agents.finance, `/api/documents/${raceId}/versions`, {}, {
          buffer: pdfBytes(`race ${i}`),
          name: `race-${i}.pdf`,
        }),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = results.map((r) => r.body.versionNumber).sort();
    expect(numbers).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("a failed database write leaves no orphan file", () => {
  // A trigger makes every version insert fail, which simulates the database
  // breaking after the file has already been written to disk.
  beforeAll(async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_version_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated database failure';
      END;
      $$ LANGUAGE plpgsql
    `);
  });

  afterEach(async () => {
    await pool.query("DROP TRIGGER IF EXISTS test_fail_version_insert ON document_versions");
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.query("DROP FUNCTION IF EXISTS test_fail_version_insert()");
  });

  async function breakVersionInserts() {
    await pool.query(`
      CREATE TRIGGER test_fail_version_insert BEFORE INSERT ON document_versions
      FOR EACH ROW EXECUTE FUNCTION test_fail_version_insert()
    `);
    // The 500 is expected, so keep its log out of the test output
    vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("on a first upload: 500, no file and no half-created document", async () => {
    await breakVersionInserts();

    await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, "/api/documents", { title: "Doomed upload" }),
      500,
      "INTERNAL_ERROR",
    );

    const docs = await pool.query("SELECT 1 FROM documents WHERE title = 'Doomed upload'");
    expect(docs.rowCount).toBe(0);
  });

  it("on a new version: 500, no file and the version count is unchanged", async () => {
    const res = await uploadTo(agents.finance, "/api/documents", { title: "Survivor" });
    const documentId = res.body.documentId;
    await breakVersionInserts();

    await expectRejectedWithoutFile(
      () => uploadTo(agents.finance, `/api/documents/${documentId}/versions`),
      500,
      "INTERNAL_ERROR",
    );

    expect(await versionsOf(documentId)).toHaveLength(1);
  });
});

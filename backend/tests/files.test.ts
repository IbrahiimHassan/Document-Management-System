import { createHash } from "node:crypto";
import { appendFile, unlink } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { uploadDir } from "../src/config/upload.js";
import { strToU8, unzipSync, zipSync } from "fflate";
import { makeDocx, makeXlsx } from "../src/files/sampleFiles.js";
import {
  clearUploads,
  createUser,
  insertDocument,
  loginAs,
  pdfBytes,
  resetDb,
  seedWorld,
  uploadTo,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "admin2" | "finance" | "legal" | "hr", Agent>;

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

beforeAll(async () => {
  await resetDb();
  await clearUploads();
  world = await seedWorld();
  await createUser({ name: "Second Admin", email: "admin2@example.com", role: "admin", departmentId: world.departments.hr });
  agents = {
    admin: await loginAs("admin@example.com"),
    admin2: await loginAs("admin2@example.com"),
    finance: await loginAs("finance@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

async function upload(agent: Agent, fields: Record<string, string>, buffer: Buffer, name = "file.pdf") {
  const res = await uploadTo(agent, "/api/documents", fields, { buffer, name });
  expect(res.status).toBe(201);
  return res.body.documentId as string;
}

async function storageKeyOf(documentId: string, versionNumber: number): Promise<string> {
  const result = await pool.query<{ storage_key: string }>(
    "SELECT storage_key FROM document_versions WHERE document_id = $1 AND version_number = $2",
    [documentId, versionNumber],
  );
  return result.rows[0]!.storage_key;
}

describe("GET /api/documents/:id/preview", () => {
  let pdfDoc: string;
  let pdf: Buffer;

  beforeAll(async () => {
    pdf = pdfBytes("Preview me");
    pdfDoc = await upload(agents.finance, { title: "Previewable" }, pdf);
  });

  it("sends the current PDF inline, with strict headers", async () => {
    const res = await agents.hr.get(`/api/documents/${pdfDoc}/preview`).buffer(true);

    expect(res.status).toBe(200);
    expect(sha(res.body)).toBe(sha(pdf));
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("records a preview of the current version", async () => {
    await agents.legal.get(`/api/documents/${pdfDoc}/preview`);

    const result = await pool.query(
      "SELECT version_number FROM document_audit_events WHERE document_id = $1 AND user_id = $2 AND action = 'preview'",
      [pdfDoc, world.users.legal],
    );
    expect(result.rows).toEqual([{ version_number: 1 }]);
  });

  it("shows a Word file as a read-only web page with strict headers", async () => {
    const docx = await upload(agents.finance, { title: "Word file" }, makeDocx(["Vendor Contract", "Payment within 45 days."]), "contract.docx");

    const res = await agents.hr.get(`/api/documents/${docx}/preview`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain("<p>Payment within 45 days.</p>");
    expect(res.text).toContain("contract.docx");
    // No scripts may run, both from the header and from the page itself (it's opened as a blob: URL)
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(res.text).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`);
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("shows a spreadsheet as a table, with every sheet", async () => {
    const xlsx = await upload(agents.finance, { title: "Budget" }, makeXlsx("Q3 Forecast", [["Department", "Budget"], ["Legal", 800000]]), "budget.xlsx");

    const res = await agents.hr.get(`/api/documents/${xlsx}/preview`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("<h2>Q3 Forecast</h2>");
    expect(res.text).toContain("<td>Legal</td><td>800000</td>");
  });

  it("escapes everything taken from the file, so it can't inject markup", async () => {
    const xlsx = await upload(agents.finance, { title: "Hostile" }, makeXlsx("<b>sheet</b>", [['<script>alert("x")</script>', "<img src=x onerror=alert(1)>"]]), "hostile.xlsx");
    const docx = await upload(agents.finance, { title: "Hostile doc" }, makeDocx(["<script>alert(1)</script>"]), "hostile.docx");

    const sheet = (await agents.hr.get(`/api/documents/${xlsx}/preview`)).text;
    const word = (await agents.hr.get(`/api/documents/${docx}/preview`)).text;

    for (const html of [sheet, word]) {
      expect(html).not.toMatch(/<script>alert|<img src=x/);
    }
    expect(sheet).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(sheet).toContain("<h2>&lt;b&gt;sheet&lt;/b&gt;</h2>");
  });

  it("keeps ordinary links but neutralises javascript: links in Word files", async () => {
    // makeDocx plus two hyperlinks, one of them hostile
    const parts = unzipSync(new Uint8Array(makeDocx(["Links"])));
    parts["word/_rels/document.xml.rels"] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/policy" TargetMode="External"/>' +
        "</Relationships>",
    );
    parts["word/document.xml"] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
        '<w:p><w:hyperlink r:id="rId1"><w:r><w:t>evil</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:hyperlink r:id="rId2"><w:r><w:t>policy</w:t></w:r></w:hyperlink></w:p>' +
        "</w:body></w:document>",
    );
    const id = await upload(agents.finance, { title: "Links" }, Buffer.from(zipSync(parts)), "links.docx");

    const html = (await agents.hr.get(`/api/documents/${id}/preview`)).text;

    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="#">evil</a>');
    expect(html).toContain('<a href="https://example.com/policy">policy</a>');
  });

  it("answers 422 with a clear message when a Word file can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parts = unzipSync(new Uint8Array(makeDocx(["x"])));
    parts["word/document.xml"] = strToU8("this is not XML <<<");
    const id = await upload(agents.finance, { title: "Broken" }, Buffer.from(zipSync(parts)), "broken.docx");

    const res = await agents.hr.get(`/api/documents/${id}/preview`);

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({ code: "PREVIEW_FAILED", message: "This file can't be previewed. Download it to open it." });
    vi.restoreAllMocks();
  });

  it("refuses to unpack a zip bomb (a small file that expands hugely)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parts = unzipSync(new Uint8Array(makeDocx(["Looks harmless"])));
    // 30 MB of zeros compresses to a few KB
    parts["word/media/huge.bin"] = new Uint8Array(30 * 1024 * 1024);
    const bomb = Buffer.from(zipSync(parts, { level: 9 }));
    expect(bomb.length).toBeLessThan(200_000);
    const id = await upload(agents.finance, { title: "Bomb" }, bomb, "bomb.docx");

    const res = await agents.hr.get(`/api/documents/${id}/preview`);

    expect(res.status).toBe(422);
    vi.restoreAllMocks();
  });

  it("answers 404 for a hidden document and 401 without a login", async () => {
    const hidden = await upload(
      agents.finance,
      { title: "Finance PDF", visibility: "restricted", departmentIds: world.departments.finance },
      pdfBytes("finance pdf"),
    );

    expect((await agents.hr.get(`/api/documents/${hidden}/preview`)).status).toBe(404);
    expect((await request(app).get(`/api/documents/${pdfDoc}/preview`)).status).toBe(401);
  });

  it("answers 404 when the file is missing on disk", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = await insertDocument({ title: "No file", uploaderId: world.users.finance });

    expect((await agents.finance.get(`/api/documents/${missing}/preview`)).status).toBe(404);
    vi.restoreAllMocks();
  });

  it("sends downloads with the same no-store cache header", async () => {
    const res = await agents.hr.get(`/api/documents/${pdfDoc}/download`);

    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
});

describe("GET /api/documents/:id/integrity", () => {
  let doc: string;

  beforeAll(async () => {
    doc = await upload(agents.finance, { title: "Checked" }, pdfBytes("integrity v1"));
    await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, { buffer: pdfBytes("integrity v2"), name: "v2.pdf" });
  });

  it("reports every version intact right after upload", async () => {
    const res = await agents.hr.get(`/api/documents/${doc}/integrity`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("intact");
    expect(res.body.versions).toMatchObject([
      { versionNumber: 2, status: "intact" },
      { versionNumber: 1, status: "intact" },
    ]);
    expect(res.body.versions[0].actual).toBe(res.body.versions[0].expected);
  });

  it("notices a file changed on disk after upload", async () => {
    await appendFile(path.join(uploadDir, await storageKeyOf(doc, 1)), "tampered");

    const res = await agents.hr.get(`/api/documents/${doc}/integrity`);

    expect(res.body.status).toBe("problem");
    expect(res.body.versions).toMatchObject([
      { versionNumber: 2, status: "intact" },
      { versionNumber: 1, status: "modified" },
    ]);
    expect(res.body.versions[1].actual).not.toBe(res.body.versions[1].expected);
  });

  it("notices a file that disappeared", async () => {
    await unlink(path.join(uploadDir, await storageKeyOf(doc, 2)));

    const res = await agents.hr.get(`/api/documents/${doc}/integrity`);

    expect(res.body.versions[0]).toMatchObject({ versionNumber: 2, status: "missing", actual: null });
  });

  it("answers 404 for a hidden document", async () => {
    const hidden = await insertDocument({
      title: "Hidden",
      uploaderId: world.users.finance,
      visibility: "restricted",
      departmentIds: [world.departments.finance],
    });

    expect((await agents.hr.get(`/api/documents/${hidden}/integrity`)).status).toBe(404);
  });
});

describe("duplicate files", () => {
  let publicBytes: Buffer;
  let publicDoc: string;
  let financeBytes: Buffer;

  beforeAll(async () => {
    publicBytes = pdfBytes("shared handbook");
    publicDoc = await upload(agents.finance, { title: "Shared Handbook" }, publicBytes);
    financeBytes = pdfBytes("finance secret");
    await upload(
      agents.finance,
      { title: "Finance Secret", visibility: "restricted", departmentIds: world.departments.finance },
      financeBytes,
    );
  });

  const lookup = (agent: Agent, checksum: string) => agent.get(`/api/documents/duplicates?checksum=${checksum}`);

  it("finds a document whose current file has the same bytes", async () => {
    const res = await lookup(agents.legal, sha(publicBytes));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ id: publicDoc, title: "Shared Handbook", versionNumber: 1 }]);
  });

  it("never mentions documents the user can't see", async () => {
    expect((await lookup(agents.hr, sha(financeBytes))).body.items).toEqual([]);
    expect((await lookup(agents.finance, sha(financeBytes))).body.items).toHaveLength(1);
  });

  it("returns nothing for an unknown file", async () => {
    expect((await lookup(agents.hr, sha(Buffer.from("never uploaded")))).body.items).toEqual([]);
  });

  it("accepts upper-case hex and rejects anything that isn't a SHA-256", async () => {
    expect((await lookup(agents.legal, sha(publicBytes).toUpperCase())).body.items).toHaveLength(1);
    expect((await lookup(agents.legal, "abc")).status).toBe(400);
    expect((await lookup(agents.legal, "z".repeat(64))).status).toBe(400);
    expect((await agents.legal.get("/api/documents/duplicates")).status).toBe(400);
  });

  it("stops matching once the file is replaced by a new version", async () => {
    const bytes = pdfBytes("replace me");
    const doc = await upload(agents.finance, { title: "Replaced" }, bytes);
    await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, { buffer: pdfBytes("replacement"), name: "r.pdf" });

    expect((await lookup(agents.finance, sha(bytes))).body.items).toEqual([]);
  });

  it("refuses a new version identical to the current one with 409, storing nothing", async () => {
    const res = await uploadTo(agents.finance, `/api/documents/${publicDoc}/versions`, {}, {
      buffer: publicBytes,
      name: "same.pdf",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/identical to the current version \(v1\)/);
    expect((await agents.finance.get(`/api/documents/${publicDoc}`)).body.currentVersion).toBe(1);
  });

  it("allows going back to an older file as a new version", async () => {
    const v1 = pdfBytes("back and forth v1");
    const doc = await upload(agents.finance, { title: "Back and forth" }, v1);
    await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, { buffer: pdfBytes("back and forth v2"), name: "v2.pdf" });

    const res = await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, { buffer: v1, name: "v1-again.pdf" });

    expect(res.status).toBe(201);
    expect(res.body.versionNumber).toBe(3);
  });
});

describe("lastDownloadedVersion: has the file changed since I downloaded it?", () => {
  let doc: string;

  beforeAll(async () => {
    doc = await upload(agents.finance, { title: "Price List" }, pdfBytes("price list v1"));
  });

  const inList = async (agent: Agent) =>
    (await agent.get("/api/documents?q=Price")).body.items.find((d: { id: string }) => d.id === doc);

  it("is null before the user ever downloaded it", async () => {
    expect((await inList(agents.hr)).lastDownloadedVersion).toBeNull();
    expect((await agents.hr.get(`/api/documents/${doc}`)).body.lastDownloadedVersion).toBeNull();
  });

  it("shows the version downloaded, and falls behind when a new version arrives", async () => {
    await agents.hr.get(`/api/documents/${doc}/download`);
    expect(await inList(agents.hr)).toMatchObject({ lastDownloadedVersion: 1, currentVersion: 1 });

    await uploadTo(agents.finance, `/api/documents/${doc}/versions`, {}, { buffer: pdfBytes("price list v2"), name: "v2.pdf" });

    expect(await inList(agents.hr)).toMatchObject({ lastDownloadedVersion: 1, currentVersion: 2 });
    expect((await agents.hr.get(`/api/documents/${doc}`)).body).toMatchObject({ lastDownloadedVersion: 1, currentVersion: 2 });
  });

  it("is personal: another user's downloads don't count", async () => {
    expect((await inList(agents.legal)).lastDownloadedVersion).toBeNull();
  });

  it("is personal even for admins, who share cached search results", async () => {
    await agents.admin.get("/api/documents?q=Price"); // cached for all admins
    await agents.admin.get(`/api/documents/${doc}/download`);

    expect((await inList(agents.admin)).lastDownloadedVersion).toBe(2);
    expect((await inList(agents.admin2)).lastDownloadedVersion).toBeNull();
  });

  it("updates at once after a download, even though the search page is cached", async () => {
    await inList(agents.legal); // cache the page
    await agents.legal.get(`/api/documents/${doc}/download`);

    expect((await inList(agents.legal)).lastDownloadedVersion).toBe(2);
  });
});

describe("GET /api/documents/audience: who could open it", () => {
  // 5 users: Admin (Finance), Second Admin (HR), Finance Manager, Legal Employee, HR Employee
  const audience = (agent: Agent, query: string) => agent.get(`/api/documents/audience?${query}`);

  it("is everyone for a public document", async () => {
    expect((await audience(agents.legal, "visibility=public")).body).toEqual({ userCount: 5 });
  });

  it("is admins, the uploader and the chosen departments for a restricted one", async () => {
    // Legal Employee picking HR: the 2 admins + themselves + HR Employee
    const res = await audience(agents.legal, `visibility=restricted&departmentIds=${world.departments.hr}`);

    expect(res.body).toEqual({ userCount: 4 });
  });

  it("counts each person once even when they match several ways", async () => {
    // Finance Manager picking Finance: Admin is an admin AND in Finance; the manager is uploader AND in Finance
    const res = await audience(agents.finance, `visibility=restricted&departmentIds=${world.departments.finance}`);

    expect(res.body).toEqual({ userCount: 3 });
  });

  it("is just admins and the uploader with no department chosen", async () => {
    expect((await audience(agents.legal, "visibility=restricted")).body).toEqual({ userCount: 3 });
  });

  it("rejects malformed department ids with 400 and needs a login", async () => {
    expect((await audience(agents.legal, "visibility=restricted&departmentIds=nope")).status).toBe(400);
    expect((await request(app).get("/api/documents/audience")).status).toBe(401);
  });
});

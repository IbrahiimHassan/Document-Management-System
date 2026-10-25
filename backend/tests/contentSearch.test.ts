import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/config/database.js";
import { makeDocx, makeXlsx } from "../src/files/sampleFiles.js";
import { MAX_TEXT_CHARS, cleanText, extractText } from "../src/files/textExtraction.js";
import { toPrefixQuery } from "../src/repositories/documentRepository.js";
import { clearUploads, loginAs, pdfBytes, resetDb, seedWorld, uploadTo } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("text extraction", () => {
  it("reads the text of a PDF", async () => {
    const text = await extractText(pdfBytes("Audit Report", ["The reconciliation was late."]), PDF);

    expect(text).toContain("Audit Report");
    expect(text).toContain("The reconciliation was late.");
  });

  it("reads the paragraphs of a Word document, decoding XML characters", async () => {
    const text = await extractText(makeDocx(["Contract", "Fees & <penalties> apply"]), DOCX);

    expect(text).toBe("Contract\nFees & <penalties> apply");
  });

  it("reads the sheet name and text cells of a spreadsheet", async () => {
    const text = await extractText(makeXlsx("Forecast", [["Region", "Total"], ["Alexandria", 1200]]), XLSX);

    expect(text).toContain("Forecast");
    expect(text).toContain("Alexandria");
  });

  it("returns null instead of failing for a broken file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await extractText(Buffer.from("%PDF-1.4\n% not really\n%%EOF\n"), PDF)).toBeNull();
    expect(await extractText(Buffer.from("PK\u0003\u0004 broken zip"), DOCX)).toBeNull();

    vi.restoreAllMocks();
  });

  it("removes control characters (PostgreSQL rejects \\0) and caps the length", () => {
    expect(cleanText("a\u0000b\u0002c\u0003d   e\n\n\nf")).toBe("a b c d e\nf");
    expect(cleanText("x".repeat(MAX_TEXT_CHARS + 10))).toHaveLength(MAX_TEXT_CHARS);
  });
});

describe("turning search text into a safe full-text query", () => {
  it("requires every word and matches word beginnings", () => {
    expect(toPrefixQuery("Reconcil Invoices")).toBe("reconcil:* & invoices:*");
  });

  it("keeps only letters and digits, so tsquery syntax can't be injected", () => {
    expect(toPrefixQuery("a' | !b & (c:*) <-> d")).toBe("a:* & b:* & c:* & d:*");
    expect(toPrefixQuery("'; DROP TABLE documents; --")).toBe("drop:* & table:* & documents:*");
    expect(toPrefixQuery("!!! ---")).toBeNull();
  });

  it("keeps non-English letters", () => {
    expect(toPrefixQuery("عقد التوريد")).toBe("عقد:* & التوريد:*");
  });
});

let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "legal" | "hr", Agent>;
let audit: string;
let handbook: string;

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

  // Restricted to Finance; its words appear only inside the file
  const auditRes = await uploadTo(agents.finance, "/api/documents", {
    title: "Annual Findings",
    visibility: "restricted",
    departmentIds: world.departments.finance,
  }, {
    buffer: pdfBytes("Internal audit", [
      "The monthly bank reconciliation was completed late in four months.",
      "Access to the payment system was not removed in time.",
    ]),
    name: "findings.pdf",
  });
  audit = auditRes.body.documentId;

  // Public, with a Word file
  const handbookRes = await uploadTo(agents.finance, "/api/documents", { title: "Staff Handbook" }, {
    buffer: makeDocx(["Handbook", "Overtime must be approved in advance by your manager."]),
    name: "handbook.docx",
  });
  handbook = handbookRes.body.documentId;

  // Public, with a spreadsheet
  await uploadTo(agents.legal, "/api/documents", { title: "Travel Costs" }, {
    buffer: makeXlsx("Costs", [["Item", "Amount"], ["Hotel reimbursement", 900]]),
    name: "costs.xlsx",
  });
});

afterAll(async () => {
  await clearUploads();
  await pool.end();
});

const titles = (body: { items: { title: string }[] }) => body.items.map((d) => d.title).sort();
const search = (agent: Agent, q: string) => agent.get(`/api/documents?q=${encodeURIComponent(q)}`);

describe("searching inside files", () => {
  it("stores the extracted text with the version", async () => {
    const result = await pool.query<{ content_text: string }>(
      "SELECT content_text FROM document_versions WHERE document_id = $1",
      [handbook],
    );
    expect(result.rows[0]!.content_text).toContain("Overtime must be approved");
  });

  it.each([
    ["a PDF", "reconciliation", "Annual Findings"],
    ["a Word document", "overtime", "Staff Handbook"],
    ["a spreadsheet", "reimbursement", "Travel Costs"],
  ])("finds %s by a word that is only inside the file", async (_label, word, title) => {
    const res = await search(agents.admin, word);

    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual([title]);
  });

  it("matches the start of a word, so results appear while typing", async () => {
    expect(titles((await search(agents.admin, "reconcil")).body)).toEqual(["Annual Findings"]);
  });

  it("matches other forms of the same word (approved -> approve)", async () => {
    expect(titles((await search(agents.admin, "approve")).body)).toEqual(["Staff Handbook"]);
  });

  it("needs every word to appear", async () => {
    expect(titles((await search(agents.admin, "overtime manager")).body)).toEqual(["Staff Handbook"]);
    expect(titles((await search(agents.admin, "overtime reconciliation")).body)).toEqual([]);
  });

  it("still finds documents by part of the title", async () => {
    expect(titles((await search(agents.admin, "handb")).body)).toEqual(["Staff Handbook"]);
  });

  it("returns a snippet with the matching words marked", async () => {
    const res = await search(agents.admin, "reconciliation");
    const snippet = res.body.items[0].snippet as { text: string; match: boolean }[];

    expect(snippet.filter((part) => part.match).map((part) => part.text.toLowerCase())).toContain("reconciliation");
    expect(snippet.map((part) => part.text).join("")).toContain("monthly bank reconciliation was completed");
  });

  it("has no snippet when only the title matched", async () => {
    const res = await search(agents.admin, "Staff");

    expect(res.body.items[0].snippet).toBeNull();
  });

  it("never reveals a restricted document through its contents", async () => {
    // HR and Legal can't see the Finance-only findings, so a word from inside it finds nothing
    for (const agent of [agents.hr, agents.legal]) {
      const res = await search(agent, "reconciliation");
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    }
    expect(titles((await search(agents.finance, "reconciliation")).body)).toEqual(["Annual Findings"]);
  });

  it("searches only the current version: replaced text stops matching", async () => {
    await uploadTo(agents.finance, `/api/documents/${audit}/versions`, {}, {
      buffer: pdfBytes("Internal audit", ["All findings were resolved by the end of the year."]),
      name: "findings-v2.pdf",
    });

    expect(titles((await search(agents.finance, "reconciliation")).body)).toEqual([]);
    expect(titles((await search(agents.finance, "resolved")).body)).toEqual(["Annual Findings"]);
  });

  it("says in the details whether the file's text could be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unreadable = await uploadTo(agents.finance, "/api/documents", { title: "Scanned" }, {
      buffer: Buffer.from("%PDF-1.4\n% an image-only scan we can't read\n%%EOF\n"),
      name: "scan.pdf",
    });
    vi.restoreAllMocks();

    expect(unreadable.status).toBe(201);
    expect((await agents.finance.get(`/api/documents/${handbook}`)).body.hasSearchableText).toBe(true);
    expect((await agents.finance.get(`/api/documents/${unreadable.body.documentId}`)).body.hasSearchableText).toBe(false);
  });

  it.each([
    "'; DROP TABLE documents; --",
    "reconciliation' OR '1'='1",
    "a & | ! ( ) : * <-> \\",
    "%_%",
  ])("handles hostile search text safely: %s", async (q) => {
    const res = await search(agents.hr, q);

    expect(res.status).toBe(200);
    expect(res.body.items.every((doc: { title: string }) => doc.title !== "Annual Findings")).toBe(true);
  });
});

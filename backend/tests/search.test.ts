import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/config/database.js";
import { insertDocument, loginAs, resetDb, seedWorld } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

let agents: Record<"admin" | "hr", Agent>;

// 12 numbered reports, plus a few documents for the filter and injection checks
const REPORT_COUNT = 12;
const TOTAL_PUBLIC = REPORT_COUNT + 4;

beforeAll(async () => {
  await resetDb();
  const world = await seedWorld();

  for (let i = 1; i <= REPORT_COUNT; i++) {
    const id = await insertDocument({
      title: `Monthly Report ${String(i).padStart(2, "0")}`,
      uploaderId: world.users.finance,
    });
    // Report 12 is the most recently updated, Report 01 the oldest
    await pool.query("UPDATE documents SET updated_at = now() - make_interval(days => $2) WHERE id = $1", [
      id,
      100 - i,
    ]);
  }

  await insertDocument({ title: "Budget 2026", uploaderId: world.users.finance, tags: ["finance", "budget"] });
  await insertDocument({ title: "Budget Draft", uploaderId: world.users.legal, tags: ["budget"] });
  await insertDocument({ title: "100% Done", uploaderId: world.users.hr });
  await insertDocument({ title: "snake_case notes", uploaderId: world.users.hr });

  // Hidden from HR: only Finance may see it
  await insertDocument({
    title: "Secret Salaries",
    uploaderId: world.users.finance,
    visibility: "restricted",
    departmentIds: [world.departments.finance],
    tags: ["budget"],
  });

  agents = {
    admin: await loginAs("admin@example.com"),
    hr: await loginAs("hr@example.com"),
  };
});

afterAll(async () => {
  await pool.end();
});

const titles = (body: { items: { title: string }[] }) => body.items.map((d) => d.title);

describe("pagination", () => {
  it("defaults to page 1 with 10 items", async () => {
    const res = await agents.hr.get("/api/documents");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: TOTAL_PUBLIC, totalPages: 2 });
    expect(res.body.items).toHaveLength(10);
  });

  it("pages do not overlap and together cover every document", async () => {
    const page1 = await agents.hr.get("/api/documents?q=report&limit=5&page=1");
    const page2 = await agents.hr.get("/api/documents?q=report&limit=5&page=2");
    const page3 = await agents.hr.get("/api/documents?q=report&limit=5&page=3");

    const all = [...titles(page1.body), ...titles(page2.body), ...titles(page3.body)];
    expect(page3.body.items).toHaveLength(2);
    expect(new Set(all).size).toBe(REPORT_COUNT);
    expect(page1.body.totalPages).toBe(3);
  });

  it("sorts by most recently updated first", async () => {
    const res = await agents.hr.get("/api/documents?q=report&limit=3");

    expect(titles(res.body)).toEqual(["Monthly Report 12", "Monthly Report 11", "Monthly Report 10"]);
  });

  it("a page past the end is empty but keeps the real total", async () => {
    const res = await agents.hr.get("/api/documents?page=99");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(TOTAL_PUBLIC);
  });

  it("accepts the maximum limit of 50", async () => {
    const res = await agents.hr.get("/api/documents?limit=50");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(TOTAL_PUBLIC);
    expect(res.body.totalPages).toBe(1);
  });

  it("reports 0 pages when nothing matches", async () => {
    const res = await agents.hr.get("/api/documents?q=nothing-matches-this");

    expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it.each([
    ["page=0"],
    ["page=-1"],
    ["page=1.5"],
    ["page=abc"],
    ["limit=0"],
    ["limit=51"],
    ["limit=ten"],
  ])("rejects %s with 400", async (query) => {
    const res = await agents.hr.get(`/api/documents?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("filters", () => {
  it("matches part of the title, ignoring case and surrounding spaces", async () => {
    const res = await agents.hr.get("/api/documents?q=%20%20BUDGET%20");

    expect(titles(res.body).sort()).toEqual(["Budget 2026", "Budget Draft"]);
  });

  it("requires every listed tag, not just one of them", async () => {
    const one = await agents.hr.get("/api/documents?tags=budget");
    const both = await agents.hr.get("/api/documents?tags=budget,finance");

    expect(titles(one.body).sort()).toEqual(["Budget 2026", "Budget Draft"]);
    expect(titles(both.body)).toEqual(["Budget 2026"]);
  });

  it("matches tags in any letter case", async () => {
    const res = await agents.hr.get("/api/documents?tags=BUDGET,Finance");

    expect(titles(res.body)).toEqual(["Budget 2026"]);
  });

  it("filters by part of the uploader's name", async () => {
    const res = await agents.hr.get("/api/documents?uploader=legal");

    expect(titles(res.body)).toEqual(["Budget Draft"]);
  });

  it("combines filters with AND", async () => {
    const res = await agents.hr.get("/api/documents?q=budget&uploader=finance");

    expect(titles(res.body)).toEqual(["Budget 2026"]);
  });

  it("returns the summary fields the UI needs", async () => {
    const res = await agents.hr.get("/api/documents?q=budget%202026");

    expect(res.body.items[0]).toMatchObject({
      title: "Budget 2026",
      visibility: "public",
      uploaderName: "Finance Manager",
      tags: ["budget", "finance"],
      currentVersion: 1,
      mimeType: "application/pdf",
    });
  });

  it.each([
    ["q", "x".repeat(201)],
    ["uploader", "x".repeat(201)],
    ["tags", "a,b,c,d,e,f,g,h,i,j,k"],
  ])("rejects an oversized %s filter with 400", async (key, value) => {
    const res = await agents.hr.get(`/api/documents?${key}=${value}`);

    expect(res.status).toBe(400);
  });
});

describe("search input is treated as text, never as SQL", () => {
  const attacks = [
    "' OR '1'='1",
    "' OR 1=1 --",
    "'; DROP TABLE documents; --",
    "\" OR \"\"=\"",
    "%' UNION SELECT id, email FROM users --",
  ];

  it.each(attacks)("q=%s returns nothing and does not fail", async (attack) => {
    const res = await agents.hr.get("/api/documents").query({ q: attack });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it.each(attacks)("uploader=%s returns nothing and does not fail", async (attack) => {
    const res = await agents.hr.get("/api/documents").query({ uploader: attack });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it.each(attacks)("tags=%s returns nothing and does not fail", async (attack) => {
    const res = await agents.hr.get("/api/documents").query({ tags: attack });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("an injection attempt cannot reveal a hidden document", async () => {
    const res = await agents.hr.get("/api/documents").query({ q: "Secret' OR '1'='1" });

    expect(JSON.stringify(res.body)).not.toContain("Secret Salaries");
  });

  it("the documents table survives the DROP TABLE attempt", async () => {
    const res = await pool.query("SELECT count(*)::int AS n FROM documents");

    expect(res.rows[0].n).toBe(TOTAL_PUBLIC + 1);
  });

  it("% is a literal character, not a wildcard", async () => {
    const res = await agents.hr.get("/api/documents").query({ q: "%" });

    expect(titles(res.body)).toEqual(["100% Done"]);
  });

  it("_ is a literal character, not a wildcard", async () => {
    const res = await agents.hr.get("/api/documents").query({ q: "_" });

    expect(titles(res.body)).toEqual(["snake_case notes"]);
  });

  it("a lone backslash does not break the query", async () => {
    const res = await agents.hr.get("/api/documents").query({ q: "\\" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

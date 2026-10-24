import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/config/database.js";
import { insertDocument, loginAs, resetDb, seedWorld } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";

let agents: Record<"admin" | "finance" | "legal" | "hr", Agent>;
let docs: Record<"public" | "financeOnly" | "legalOnly" | "noDepartments", string>;

beforeAll(async () => {
  await resetDb();
  const world = await seedWorld();

  docs = {
    // Public, uploaded by the Finance manager
    public: await insertDocument({
      title: "Public Policy",
      uploaderId: world.users.finance,
      tags: ["policy"],
    }),
    // Restricted to the Finance department, uploaded by the Finance manager
    financeOnly: await insertDocument({
      title: "Finance Budget",
      uploaderId: world.users.finance,
      visibility: "restricted",
      departmentIds: [world.departments.finance],
      tags: ["budget"],
    }),
    // Restricted to Legal, uploaded by the Legal employee
    legalOnly: await insertDocument({
      title: "Legal Contract",
      uploaderId: world.users.legal,
      visibility: "restricted",
      departmentIds: [world.departments.legal],
      tags: ["contract"],
    }),
    // Restricted with no departments: only its uploader and admins may see it
    noDepartments: await insertDocument({
      title: "Private Note",
      uploaderId: world.users.finance,
      visibility: "restricted",
    }),
  };

  agents = {
    admin: await loginAs("admin@example.com"),
    finance: await loginAs("finance@example.com"),
    legal: await loginAs("legal@example.com"),
    hr: await loginAs("hr@example.com"),
  };
});

afterAll(async () => {
  await pool.end();
});

const userNames = ["admin", "finance", "legal", "hr"] as const;
const docNames = ["public", "financeOnly", "legalOnly", "noDepartments"] as const;

// Who may see which document (true = 200, false = 404)
const canSee: Record<keyof typeof agents, Record<keyof typeof docs, boolean>> = {
  admin: { public: true, financeOnly: true, legalOnly: true, noDepartments: true },
  finance: { public: true, financeOnly: true, legalOnly: false, noDepartments: true },
  legal: { public: true, financeOnly: false, legalOnly: true, noDepartments: false },
  hr: { public: true, financeOnly: false, legalOnly: false, noDepartments: false },
};

describe("who can open which document", () => {
  for (const user of userNames) {
    for (const doc of docNames) {
      const allowed = canSee[user][doc];
      const expected = allowed ? 200 : 404;

      it(`${user} ${allowed ? "can" : "cannot"} open "${doc}" (detail)`, async () => {
        const res = await agents[user].get(`/api/documents/${docs[doc]}`);
        expect(res.status).toBe(expected);
      });

      it(`${user} ${allowed ? "can" : "cannot"} read the versions of "${doc}"`, async () => {
        const res = await agents[user].get(`/api/documents/${docs[doc]}/versions`);
        expect(res.status).toBe(expected);
      });
    }
  }
});

describe("hidden documents look like missing ones", () => {
  it("returns the same body for a hidden document and an unknown id", async () => {
    const hidden = await agents.hr.get(`/api/documents/${docs.financeOnly}`);
    const missing = await agents.hr.get(`/api/documents/${UNKNOWN_ID}`);

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it("does the same for the versions endpoint", async () => {
    const hidden = await agents.hr.get(`/api/documents/${docs.financeOnly}/versions`);
    const missing = await agents.hr.get(`/api/documents/${UNKNOWN_ID}/versions`);

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it("does not reveal the restricted title in the error", async () => {
    const res = await agents.hr.get(`/api/documents/${docs.financeOnly}`);

    expect(JSON.stringify(res.body)).not.toContain("Finance Budget");
  });
});

describe("the list only contains documents the user may see", () => {
  const titles = (body: { items: { title: string }[] }) => body.items.map((d) => d.title).sort();

  it("admin sees all four", async () => {
    const res = await agents.admin.get("/api/documents");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  it("the Finance manager sees public, finance-only and the note they uploaded", async () => {
    const res = await agents.finance.get("/api/documents");

    expect(titles(res.body)).toEqual(["Finance Budget", "Private Note", "Public Policy"]);
  });

  it("Legal sees public and legal-only", async () => {
    const res = await agents.legal.get("/api/documents");

    expect(titles(res.body)).toEqual(["Legal Contract", "Public Policy"]);
  });

  it("HR sees only the public document", async () => {
    const res = await agents.hr.get("/api/documents");

    expect(titles(res.body)).toEqual(["Public Policy"]);
  });

  it("totals and pages count only visible documents", async () => {
    const res = await agents.legal.get("/api/documents?limit=1");

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.totalPages).toBe(2);
  });
});

describe("search and filters cannot reveal hidden documents", () => {
  it("a title search finds a document for an allowed user", async () => {
    const res = await agents.admin.get("/api/documents?q=budget");

    expect(res.body.total).toBe(1);
  });

  it("the same title search returns nothing for HR", async () => {
    const res = await agents.hr.get("/api/documents?q=budget");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("a tag filter returns nothing for HR", async () => {
    const res = await agents.hr.get("/api/documents?tags=budget");

    expect(res.body.total).toBe(0);
  });

  it("an uploader filter still hides restricted documents from HR", async () => {
    const res = await agents.hr.get("/api/documents?uploader=Finance");

    expect(res.body.items.map((d: { title: string }) => d.title)).toEqual(["Public Policy"]);
  });
});

describe("bad and missing ids", () => {
  it("rejects a malformed id with 400", async () => {
    const res = await agents.admin.get("/api/documents/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed id on the versions endpoint", async () => {
    const res = await agents.admin.get("/api/documents/not-a-uuid/versions");

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown id, even for an admin", async () => {
    const res = await agents.admin.get(`/api/documents/${UNKNOWN_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
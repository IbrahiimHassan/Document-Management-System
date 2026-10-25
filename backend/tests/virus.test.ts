import { createHash } from "node:crypto";
import net from "node:net";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import { pool } from "../src/config/database.js";
import { makeDocx } from "../src/files/sampleFiles.js";
import { scanBuffer } from "../src/files/virusScanner.js";
import {
  clearUploads,
  listUploadedFiles,
  loginAs,
  pdfBytes,
  resetDb,
  seedWorld,
  uploadTo,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>;

// The EICAR test file: a harmless string every antivirus reports as malware.
// Assembled at runtime so this source file itself never contains it (antivirus
// software on a developer's machine would otherwise quarantine the test).
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-", "TEST-FILE!$H+H*"].join("");

// A stand-in for clamd that speaks the same INSTREAM protocol. It reports
// EICAR as found and remembers every file it was sent.
interface FakeClamd {
  port: number;
  scanned: Buffer[];
  mode: "normal" | "silent";
  close: () => Promise<void>;
}

function startFakeClamd(): Promise<FakeClamd> {
  const fake: FakeClamd = { port: 0, scanned: [], mode: "normal", close: async () => {} };

  const server = net.createServer((socket) => {
    let data = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      if (fake.mode === "silent") return; // accepts the connection, never answers
      data = Buffer.concat([data, chunk]);

      if (data.toString("latin1").startsWith("zPING\0")) {
        socket.end("PONG\0");
        return;
      }

      const header = "zINSTREAM\0";
      if (data.length < header.length) return;
      const parts: Buffer[] = [];
      let offset = header.length;
      while (offset + 4 <= data.length) {
        const size = data.readUInt32BE(offset);
        if (size === 0) {
          const file = Buffer.concat(parts);
          fake.scanned.push(file);
          socket.end(file.includes(EICAR) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (offset + 4 + size > data.length) return; // wait for the rest of the chunk
        parts.push(data.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      fake.port = (server.address() as net.AddressInfo).port;
      fake.close = () =>
        new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        });
      resolve(fake);
    });
  });
}

// A port nothing listens on: connecting fails at once
async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const original = { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT, timeout: env.CLAMAV_TIMEOUT_MS };

let clamd: FakeClamd;
let world: Awaited<ReturnType<typeof seedWorld>>;
let agents: Record<"admin" | "finance" | "hr", Agent>;

beforeAll(async () => {
  await resetDb();
  await clearUploads();
  world = await seedWorld();
  agents = {
    admin: await loginAs("admin@example.com"),
    finance: await loginAs("finance@example.com"),
    hr: await loginAs("hr@example.com"),
  };
  clamd = await startFakeClamd();
});

// Each test file runs in its own process, so changing env here affects only this file
beforeEach(() => {
  env.CLAMAV_HOST = "127.0.0.1";
  env.CLAMAV_PORT = clamd.port;
  env.CLAMAV_TIMEOUT_MS = 2000;
  clamd.mode = "normal";
  clamd.scanned = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  env.CLAMAV_HOST = original.host;
  env.CLAMAV_PORT = original.port;
  env.CLAMAV_TIMEOUT_MS = original.timeout;
  await clamd.close();
  await clearUploads();
  await pool.end();
});

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

async function documentCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM documents");
  return Number(result.rows[0]!.count);
}

// A real PDF (so it passes the file type check) carrying the EICAR string
function infectedPdf(): Buffer {
  return Buffer.concat([pdfBytes("Quarterly report"), Buffer.from(`\n${EICAR}\n`)]);
}

describe("the clamd client", () => {
  it("sends the whole file, split into chunks, and reads a clean result", async () => {
    // Bigger than one 64 KB chunk, so several chunks are sent
    const big = Buffer.concat([pdfBytes("big"), Buffer.alloc(200_000, "a")]);

    expect(await scanBuffer(big)).toEqual({ clean: true });
    expect(sha(clamd.scanned[0]!)).toBe(sha(big));
  });

  it("reads the malware name from an infected result", async () => {
    expect(await scanBuffer(Buffer.from(EICAR))).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
  });
});

describe("uploads with the virus scanner on", () => {
  it("accepts and stores a clean file after scanning it", async () => {
    const bytes = pdfBytes("clean report");

    const res = await uploadTo(agents.finance, "/api/documents", { title: "Clean" }, { buffer: bytes, name: "clean.pdf" });

    expect(res.status).toBe(201);
    expect(clamd.scanned.map(sha)).toEqual([sha(bytes)]);
  });

  it("refuses an infected file with 422 and stores nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const filesBefore = await listUploadedFiles();
    const docsBefore = await documentCount();

    const res = await uploadTo(agents.finance, "/api/documents", { title: "Infected" }, {
      buffer: infectedPdf(),
      name: "report.pdf",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VIRUS_DETECTED");
    expect(res.body.error.message).toContain("Eicar-Test-Signature");
    expect(await listUploadedFiles()).toEqual(filesBefore);
    expect(await documentCount()).toBe(docsBefore);
  });

  // A Word file is a compressed zip, which real ClamAV unpacks; this fake only
  // reads raw bytes. So the check is that the exact file is sent to the scanner.
  it("scans Word files too", async () => {
    const bytes = makeDocx(["Invoice", "Payment due in 30 days"]);

    const res = await uploadTo(agents.finance, "/api/documents", { title: "Invoice" }, {
      buffer: bytes,
      name: "invoice.docx",
    });

    expect(res.status).toBe(201);
    expect(clamd.scanned.map(sha)).toEqual([sha(bytes)]);
  });

  it("refuses an infected new version and keeps the current one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const created = await uploadTo(agents.finance, "/api/documents", { title: "Policy" }, {
      buffer: pdfBytes("policy v1"),
      name: "policy.pdf",
    });
    const id = created.body.documentId;
    const filesBefore = await listUploadedFiles();

    const res = await uploadTo(agents.finance, `/api/documents/${id}/versions`, {}, {
      buffer: infectedPdf(),
      name: "policy-v2.pdf",
    });

    expect(res.status).toBe(422);
    expect(await listUploadedFiles()).toEqual(filesBefore);
    expect((await agents.finance.get(`/api/documents/${id}`)).body.currentVersion).toBe(1);
  });

  it("checks permissions before scanning: a refused version upload is never sent to the scanner", async () => {
    const created = await uploadTo(agents.finance, "/api/documents", { title: "Not yours" }, {
      buffer: pdfBytes("not yours"),
      name: "a.pdf",
    });
    clamd.scanned = [];

    const res = await uploadTo(agents.hr, `/api/documents/${created.body.documentId}/versions`, {}, {
      buffer: pdfBytes("hr attempt"),
      name: "b.pdf",
    });

    expect(res.status).toBe(403);
    expect(clamd.scanned).toEqual([]);
  });
});

describe("when the scanner can't be reached, uploads are refused (never stored unscanned)", () => {
  it("answers 503 when nothing is listening", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.CLAMAV_PORT = await unusedPort();
    const filesBefore = await listUploadedFiles();
    const docsBefore = await documentCount();

    const res = await uploadTo(agents.finance, "/api/documents", { title: "Unscanned" }, {
      buffer: pdfBytes("unscanned"),
      name: "u.pdf",
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SCANNER_UNAVAILABLE");
    expect(await listUploadedFiles()).toEqual(filesBefore);
    expect(await documentCount()).toBe(docsBefore);
  });

  it("answers 503 when the scanner accepts the connection but never replies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clamd.mode = "silent";
    env.CLAMAV_TIMEOUT_MS = 300;

    const res = await uploadTo(agents.finance, "/api/documents", { title: "Hung" }, {
      buffer: pdfBytes("hung"),
      name: "h.pdf",
    });

    expect(res.status).toBe(503);
  });
});

describe("the health check reports the scanner", () => {
  it("as connected when clamd answers PING", async () => {
    expect((await request(app).get("/api/health")).body.virusScanner).toBe("connected");
  });

  it("as unavailable when it doesn't (the API itself stays healthy)", async () => {
    env.CLAMAV_PORT = await unusedPort();

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.virusScanner).toBe("unavailable");
  });

  it("as disabled when no scanner is configured", async () => {
    env.CLAMAV_HOST = undefined;

    expect((await request(app).get("/api/health")).body.virusScanner).toBe("disabled");
  });
});

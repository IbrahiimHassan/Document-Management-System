// Shows the virus scanner working end to end, through the real upload API.
//
//   npm run demo:virus                              (app on http://localhost:3000)
//   BASE_URL=http://localhost:3100 npm run demo:virus
//
// It uploads two Word files built in memory: a clean one, and one hiding the
// EICAR test file (a harmless string every antivirus reports as malware).
// Nothing infected is ever written to disk, so Windows Defender won't interfere.
import { strToU8, zipSync } from "fflate";
import { makeDocx } from "../src/files/sampleFiles.js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL ?? "hr@example.com";
const PASSWORD = process.env.DEMO_PASSWORD ?? "password123";

// Assembled at runtime so this file itself never contains the EICAR string
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-", "TEST-FILE!$H+H*"].join("");

// A valid Word document with one extra part inside the zip: the EICAR file
function infectedDocx(): Buffer {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        head +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
      ),
      "_rels/.rels": strToU8(
        head +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      ),
      "word/document.xml": strToU8(
        head +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          "<w:body><w:p><w:r><w:t>Invoice</w:t></w:r></w:p></w:body></w:document>",
      ),
      "word/media/payload.bin": strToU8(EICAR),
    }),
  );
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json() as Promise<{ virusScanner?: string }>);
  console.log(`Virus scanner: ${health.virusScanner}`);
  if (health.virusScanner !== "connected") {
    console.log("The scanner isn't ready. Uploads will be refused with 503 until it is (first start takes a few minutes).");
  }

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`Login as ${EMAIL} failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  console.log(`Logged in as ${EMAIL}\n`);

  async function upload(title: string, file: Buffer): Promise<void> {
    const form = new FormData();
    form.append("title", title);
    form.append("file", new Blob([new Uint8Array(file)]), "invoice.docx");
    const res = await fetch(`${BASE_URL}/api/documents`, { method: "POST", headers: { cookie }, body: form });
    const body = (await res.json()) as { documentId?: string; error?: { code: string; message: string } };
    const outcome = body.error ? `${body.error.code}: ${body.error.message}` : `stored as ${body.documentId}`;
    console.log(`${title.padEnd(30)} -> ${res.status} ${outcome}`);
  }

  await upload("Virus demo: clean invoice", makeDocx(["Invoice", "Payment due in 30 days."]));
  await upload("Virus demo: infected invoice", infectedDocx());
  console.log('\nExpected: the clean file is stored (201); the infected one is refused (422 VIRUS_DETECTED).');
  console.log('The clean file is now a normal document titled "Virus demo: clean invoice"; delete it when you are done.');
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

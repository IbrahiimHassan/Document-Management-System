import { strFromU8, unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { decodeXml } from "./textExtraction.js";

// Browsers can show PDFs but not Word or Excel files, so those are turned into a
// simple read-only web page. Everything taken from the file is escaped, and the
// page carries its own Content-Security-Policy: no scripts, no outside requests.

// A DOCX or XLSX is a zip, and a tiny zip can claim to unpack into gigabytes.
// fflate never unpacks more than an entry declares, so the declared sizes are
// capped here before anything is unpacked.
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

const MAX_SHEETS = 20;
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;

export class PreviewFailedError extends Error {}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unzipChecked(buffer: Buffer, wanted: (name: string) => boolean = () => true): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        if (!wanted(entry.name)) return false;
        total += entry.originalSize;
        if (entry.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
          throw new PreviewFailedError("The file unpacks to more than the preview allows");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PreviewFailedError) throw error;
    throw new PreviewFailedError(`Not a readable zip: ${(error as Error).message}`);
  }
}

const STYLES = `
  body { margin: 0; background: #f3f6f5; color: #14221e; font: 15px/1.6 system-ui, sans-serif; }
  main { max-width: 860px; margin: 24px auto; padding: 40px 48px; background: #fff; border: 1px solid #dbe3e0; border-radius: 12px; }
  main.wide { max-width: none; margin: 24px; padding: 24px; }
  header { margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #dbe3e0; }
  header p { margin: 0; color: #52625c; font-size: 13px; }
  header h1 { margin: 2px 0 0; font-size: 20px; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; font-size: 13px; }
  td, th { border: 1px solid #dbe3e0; padding: 4px 8px; vertical-align: top; }
  th { background: #f3f6f5; color: #52625c; font-weight: 600; }
  .sheet { margin-bottom: 32px; overflow-x: auto; }
  .sheet h2 { font-size: 16px; margin: 0 0 8px; }
  .note { color: #8a5a00; font-size: 13px; }
  a { color: #0f6b57; }
`;

function page(title: string, kind: string, body: string, wide = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main${wide ? ' class="wide"' : ""}>
<header><p>Preview of a ${kind}</p><h1>${escapeHtml(title)}</h1></header>
${body}
</main>
</body>
</html>`;
}

// Only ordinary links survive; "javascript:" and the like become harmless
function safeLinks(html: string): string {
  return html.replace(/href="([^"]*)"/gi, (match, url: string) =>
    /^(https?:|mailto:|#)/i.test(decodeXml(url).trim()) ? match : 'href="#"',
  );
}

export async function renderDocx(buffer: Buffer, title: string): Promise<string> {
  // Unpacked with the size checks, then packed again without compression, so
  // the converter can't be fed a zip bomb
  const safeCopy = Buffer.from(zipSync(unzipChecked(buffer), { level: 0 }));

  let html: string;
  try {
    // mammoth escapes the document's text and writes images as data: URLs
    ({ value: html } = await mammoth.convertToHtml({ buffer: safeCopy }));
  } catch (error) {
    throw new PreviewFailedError(`Could not read the Word file: ${(error as Error).message}`);
  }

  const body = html.trim() ? safeLinks(html) : '<p class="note">This document has no text to show.</p>';
  return page(title, "Word document", body);
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const letter of ref.replace(/\d+$/, "").toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeXml(match[1]!) : undefined;
}

// All <t> text inside an element, ignoring phonetic guides (<rPh>)
function textOf(xml: string): string {
  return (xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? [])
    .map((t) => decodeXml(t.replace(/<[^>]+>/g, "")))
    .join("");
}

interface Sheet {
  name: string;
  rows: Map<number, Map<number, string>>;
  lastRow: number;
  lastColumn: number;
  truncated: boolean;
}

function readSheet(name: string, xml: string, shared: string[]): Sheet {
  const sheet: Sheet = { name, rows: new Map(), lastRow: -1, lastColumn: -1, truncated: false };

  for (const [, attrs, inner] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attribute(attrs!, "r");
    if (!ref || inner === undefined) continue;
    const row = Number(ref.match(/\d+$/)?.[0]) - 1;
    const column = columnIndex(ref);
    if (!(row >= 0) || column < 0) continue;
    if (row >= MAX_ROWS || column >= MAX_COLUMNS) {
      sheet.truncated = true;
      continue;
    }

    const type = attribute(attrs!, "t");
    const raw = inner.match(/<v>([^<]*)<\/v>/)?.[1];
    let value: string;
    if (type === "s") value = shared[Number(raw)] ?? "";
    else if (type === "inlineStr") value = textOf(inner);
    else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
    else value = raw !== undefined ? decodeXml(raw) : "";
    if (value === "") continue;

    if (!sheet.rows.has(row)) sheet.rows.set(row, new Map());
    sheet.rows.get(row)!.set(column, value);
    sheet.lastRow = Math.max(sheet.lastRow, row);
    sheet.lastColumn = Math.max(sheet.lastColumn, column);
  }
  return sheet;
}

function sheetTable(sheet: Sheet): string {
  if (sheet.lastRow < 0) {
    return `<section class="sheet"><h2>${escapeHtml(sheet.name)}</h2><p class="note">This sheet is empty.</p></section>`;
  }

  const columns = Array.from({ length: sheet.lastColumn + 1 }, (_, c) => c);
  const head = `<tr><th></th>${columns.map((c) => `<th>${columnName(c)}</th>`).join("")}</tr>`;
  const body: string[] = [];
  for (let r = 0; r <= sheet.lastRow; r++) {
    const cells = sheet.rows.get(r);
    body.push(
      `<tr><th>${r + 1}</th>${columns.map((c) => `<td>${escapeHtml(cells?.get(c) ?? "")}</td>`).join("")}</tr>`,
    );
  }
  const note = sheet.truncated
    ? `<p class="note">Showing the first ${MAX_ROWS} rows and ${MAX_COLUMNS} columns. Download the file to see everything.</p>`
    : "";
  return `<section class="sheet"><h2>${escapeHtml(sheet.name)}</h2>${note}<table>${head}${body.join("")}</table></section>`;
}

// Cell values as stored: text, numbers and formula results. Number formats
// (dates, currencies) aren't applied, so a date shows as Excel's day number.
export function renderXlsx(buffer: Buffer, title: string): string {
  const files = unzipChecked(
    buffer,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  );
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new PreviewFailedError("The spreadsheet has no workbook");

  const shared = (read("xl/sharedStrings.xml")?.match(/<si>[\s\S]*?<\/si>/g) ?? []).map(textOf);

  // Sheet name -> relationship id -> file inside the zip
  const targets = new Map<string, string>();
  for (const rel of read("xl/_rels/workbook.xml.rels")?.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attribute(rel, "Id");
    const target = attribute(rel, "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets: Sheet[] = [];
  for (const tag of (workbook.match(/<sheet\b[^>]*>/g) ?? []).slice(0, MAX_SHEETS)) {
    const name = attribute(tag, "name") ?? "Sheet";
    const path = targets.get(attribute(tag, "r:id") ?? "");
    const xml = path ? read(path) : undefined;
    if (xml) sheets.push(readSheet(name, xml, shared));
  }
  if (sheets.length === 0) throw new PreviewFailedError("The spreadsheet has no readable sheets");

  return page(title, "spreadsheet", sheets.map(sheetTable).join(""), true);
}

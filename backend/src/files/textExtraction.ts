import { unzipSync, strFromU8 } from "fflate";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

// Enough for a long report, and far below PostgreSQL's 1 MB tsvector limit
export const MAX_TEXT_CHARS = 200_000;

const TIMEOUT_MS = 15_000;

// A DOCX or XLSX is a zip. A tiny zip can claim to unpack into gigabytes
// (a "zip bomb"), so entries larger than this are never unpacked.
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeChar(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

function unzip(buffer: Buffer, wanted: (name: string) => boolean): Record<string, string> {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (entry) => wanted(entry.name) && entry.originalSize <= MAX_ENTRY_BYTES,
  });
  const result: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    result[name] = strFromU8(bytes);
  }
  return result;
}

// Word keeps the text in <w:t> elements; every </w:p> ends a paragraph
function docxText(buffer: Buffer): string {
  const parts = unzip(buffer, (name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  const order = Object.keys(parts).sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));

  return order
    .map((name) =>
      parts[name]!
        .replace(/<w:tab\/>/g, " ")
        .replace(/<\/w:p>/g, "\n")
        .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|\n/g)
        ?.map((piece) => (piece === "\n" ? "\n" : decodeXml(piece.replace(/<[^>]+>/g, ""))))
        .join("") ?? "",
    )
    .join("\n");
}

// Excel keeps most text in sharedStrings.xml and some inline in each sheet (<is><t>)
function xlsxText(buffer: Buffer): string {
  const parts = unzip(
    buffer,
    (name) => name === "xl/sharedStrings.xml" || name === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  const texts: string[] = [];
  const sheetNames = parts["xl/workbook.xml"]?.match(/<sheet\s[^>]*name="([^"]*)"/g) ?? [];
  for (const tag of sheetNames) {
    texts.push(decodeXml(tag.replace(/^.*name="([^"]*)".*$/, "$1")));
  }
  for (const [name, xml] of Object.entries(parts)) {
    if (name === "xl/workbook.xml") continue;
    for (const match of xml.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []) {
      texts.push(decodeXml(match.replace(/<[^>]+>/g, "")));
    }
  }
  return texts.join("\n");
}

async function pdfText(buffer: Buffer): Promise<string> {
  // A copy: pdf.js may take over (detach) the bytes it is given, and the
  // original buffer still has to be written to disk afterwards
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
  try {
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } finally {
    // Frees the parser's memory
    await pdf.loadingTask.destroy();
  }
}

// Control characters are removed (PostgreSQL rejects \0, and the search
// highlighter uses two of them as markers); runs of spaces are collapsed.
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// Returns the searchable text of a file, or null when there is none (a scanned
// PDF, a broken file). Never throws: a file we can't read is still a valid upload,
// it just can't be found by its contents.
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    let raw: string;
    if (mimeType === PDF) raw = await withTimeout(pdfText(buffer));
    else if (mimeType === DOCX) raw = docxText(buffer);
    else if (mimeType === XLSX) raw = xlsxText(buffer);
    else return null;

    const text = cleanText(raw);
    return text.length > 0 ? text : null;
  } catch (error) {
    console.warn(`Text extraction failed (${mimeType}): ${(error as Error)?.message ?? error}`);
    return null;
  }
}

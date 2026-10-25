import net from "node:net";
import { env } from "../config/env.js";
import { ScannerUnavailableError, VirusDetectedError } from "../errors/AppError.js";

// Talks to the ClamAV daemon (clamd) over TCP with its INSTREAM command:
// the file is sent as chunks, each prefixed with its length as 4 bytes, and a
// zero-length chunk marks the end. clamd answers "stream: OK" or
// "stream: <name of the malware> FOUND". The "z" prefix makes it end replies with \0.

const CHUNK_BYTES = 64 * 1024;

export type ScannerStatus = "connected" | "unavailable" | "disabled";

export type ScanResult = { clean: true } | { clean: false; signature: string };

export function isEnabled(): boolean {
  return Boolean(env.CLAMAV_HOST);
}

// Sends one command and returns clamd's reply (without the trailing \0)
function talk(write: (socket: net.Socket) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    const received: Buffer[] = [];
    let settled = false;

    function finish(error: Error | null, reply?: string) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(reply!);
    }

    socket.setTimeout(env.CLAMAV_TIMEOUT_MS);
    socket.on("connect", () => write(socket));
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk);
      const all = Buffer.concat(received);
      const end = all.indexOf(0);
      if (end !== -1) finish(null, all.subarray(0, end).toString("utf8").trim());
    });
    socket.on("end", () => {
      const reply = Buffer.concat(received).toString("utf8").replace(/\0/g, "").trim();
      if (reply) finish(null, reply);
      else finish(new Error("clamd closed the connection without answering"));
    });
    socket.on("timeout", () => finish(new Error(`clamd did not answer within ${env.CLAMAV_TIMEOUT_MS} ms`)));
    socket.on("error", (error) => finish(error));
  });
}

export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const reply = await talk((socket) => {
    socket.write("zINSTREAM\0");
    for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
      const chunk = buffer.subarray(offset, offset + CHUNK_BYTES);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.length);
      socket.write(size);
      socket.write(chunk);
    }
    socket.write(Buffer.alloc(4));
  });

  // "stream: OK" | "stream: Eicar-Test-Signature FOUND" | "... ERROR"
  const body = reply.replace(/^stream:\s*/, "");
  if (body === "OK") return { clean: true };
  if (body.endsWith(" FOUND")) return { clean: false, signature: body.slice(0, -" FOUND".length) };
  throw new Error(`Unexpected clamd reply: ${reply}`);
}

// Throws unless the file is known to be clean. When the scanner is configured
// but unreachable, the upload is refused: an unscanned file is never stored.
export async function assertClean(buffer: Buffer, fileName: string): Promise<void> {
  if (!isEnabled()) return;

  let result: ScanResult;
  try {
    result = await scanBuffer(buffer);
  } catch (error) {
    console.error("Virus scan failed:", (error as Error)?.message ?? error);
    throw new ScannerUnavailableError();
  }

  if (!result.clean) {
    console.warn(`Blocked upload "${fileName}": ${result.signature}`);
    throw new VirusDetectedError(
      `The file was flagged as malware (${result.signature}) and was not saved`,
    );
  }
}

// For the health check: is clamd answering right now?
export async function status(): Promise<ScannerStatus> {
  if (!isEnabled()) return "disabled";
  try {
    const reply = await talk((socket) => socket.write("zPING\0"));
    return reply === "PONG" ? "connected" : "unavailable";
  } catch {
    return "unavailable";
  }
}

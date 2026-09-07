import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newSecret } from "./crypto-security";
import { nid } from "./id";
import type { Attachment, AttachmentKind } from "./types";
import { MAX_FILE_BYTES } from "./types";

const BLOB_ROOT = join(process.cwd(), ".data", "blobs");
const KEY_ROOT = join(process.cwd(), ".data", "swarm-keys");

export function swarmCryptoKey(swarmId: string) {
  mkdirSync(KEY_ROOT, { recursive: true });
  const path = join(KEY_ROOT, swarmId);
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    const secret = newSecret();
    writeFileSync(path, secret, { mode: 0o600 });
    return secret;
  }
}

export function classifyAttachment(name: string, mime: string): AttachmentKind {
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(name)) return "video";
  if (/kb|knowledge/i.test(name)) return "kb";
  if (/skill/i.test(name) || name.endsWith(".md")) return "skill";
  return "document";
}

export function saveAttachment(swarmId: string, file: { name: string; type: string; bytes: Buffer }): Attachment {
  if (file.bytes.length > MAX_FILE_BYTES) {
    throw new Error("Файл больше 32 МБ. Для своего роя режьте или кладите в MAG S3.");
  }
  const id = nid("file-");
  const dir = join(BLOB_ROOT, swarmId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, id), file.bytes);
  return {
    id,
    kind: classifyAttachment(file.name, file.type || "application/octet-stream"),
    name: file.name.slice(0, 180),
    mime: file.type || "application/octet-stream",
    size: file.bytes.length,
  };
}

export function readAttachment(swarmId: string, id: string) {
  return readFileSync(join(BLOB_ROOT, swarmId, id));
}

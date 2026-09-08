import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { compareSync, hashSync } from "bcryptjs";

export function hashPassword(password: string) {
  return hashSync(password, 12);
}

export function verifyPassword(password: string, passwordHash: string) {
  if (!passwordHash || passwordHash === "!") return false;
  return compareSync(password, passwordHash);
}

export function hashAgentKey(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function newAgentKey() {
  return `hive_${randomBytes(24).toString("hex")}`;
}

export function newPeerKey() {
  return `hive_peer_${randomBytes(24).toString("hex")}`;
}

export function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newSecret() {
  return randomBytes(32).toString("hex");
}

export function requestIp(request: Request) {
  const real = request.headers.get("x-real-ip")?.trim().replace(/^::ffff:/, "") ?? "";
  if (real && !real.includes(",") && !real.includes(" ")) return real;
  return "ip";
}

export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (process.env.NODE_ENV !== "production") return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host");
  if (!host) throw new Error("forbidden");
  if (new URL(origin).host !== host) throw new Error("forbidden origin");
}

/** Cookie-формы входа: без Origin с улицы не принимаем (curl/бот). hive-node сюда не ходит. */
export function assertBrowserOrigin(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  if (!request.headers.get("origin")) throw new Error("forbidden origin");
  assertSameOrigin(request);
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function stripFederationBody(body: string, maxLen: number) {
  const cleaned = body
    .replace(/\b10\.\d+\.\d+\.\d+\b/g, "[ip]")
    .replace(/\b(?:ssh|wg|wireguard|privatekey|overlay)\b/gi, "[redacted]")
    .replace(/hive_(?:peer_)?[a-f0-9]+/gi, "[key]")
    .slice(0, maxLen);
  return cleaned.trim();
}

export function encryptSecret(plaintext: string, keyHex: string) {
  const iv = randomBytes(12);
  const key = Buffer.from(keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptSecret(payload: { iv: string; ciphertext: string; tag: string }, keyHex: string) {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

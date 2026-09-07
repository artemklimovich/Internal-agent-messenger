import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

export function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newSecret() {
  return randomBytes(32).toString("hex");
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
    .replace(/hive_[a-f0-9]+/gi, "[key]")
    .slice(0, maxLen);
  return cleaned.trim();
}

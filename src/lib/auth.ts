import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newSecret } from "./crypto-security";
import { getStore } from "./store";
import type { SessionUser } from "./types";

const COOKIE = "hive_session";

function sessionSecret() {
  if (process.env.HIVE_SESSION_SECRET) {
    return process.env.HIVE_SESSION_SECRET;
  }
  const path = join(process.cwd(), ".data", "session-secret");
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    const secret = newSecret();
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(path, secret, { mode: 0o600 });
    return secret;
  }
}

function key() {
  return new TextEncoder().encode(sessionSecret());
}

export async function signSession(user: SessionUser) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    swarmId: user.swarmId,
    swarmName: user.swarmName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());
}

export async function setSessionCookie(user: SessionUser) {
  const token = await signSession(user);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const id = String(payload.sub ?? "");
    const user = getStore().userById(id);
    if (!user || user.disabled) return null;
    const swarm = getStore().swarmByOwner(id);
    if (!swarm) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role === "system" ? "user" : user.role,
      swarmId: swarm.id,
      swarmName: swarm.name,
    };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
  return session;
}

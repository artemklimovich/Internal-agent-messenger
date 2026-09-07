import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encryptSecret, decryptSecret } from "./crypto-security";
import { swarmCryptoKey } from "./blobs";
import { isLiveOverlayIp, overlayHubIp, readLiveWireguard } from "./live-wg";
import { wgKeyPair } from "./tunnels";
import { resolvePolicy } from "./types";
import type { Swarm, Tunnel } from "./types";

export const HUB_OVERLAY_IP = "10.42.0.1";
export const OVERLAY_NET = "10.42.0.0/24";
export const WG_LISTEN_PORT = 51820;

const WG_ROOT = join(process.cwd(), ".data", "wg");

export function overlayEndpoint() {
  const fromEnv = process.env.HIVE_WG_ENDPOINT?.trim();
  if (fromEnv) return fromEnv;
  const url = process.env.HIVE_PUBLIC_URL || process.env.HIVE_HUB_URL || "";
  try {
    if (url) return `${new URL(url).hostname}:${WG_LISTEN_PORT}`;
  } catch {
    /* ignore */
  }
  return `hive-hub:${WG_LISTEN_PORT}`;
}

export function isOverlayIp(ip: string) {
  return isLiveOverlayIp(ip);
}

export function clientIp(request: Request) {
  if (process.env.HIVE_TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.replace(/^::ffff:/, "");
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real.replace(/^::ffff:/, "");
  }
  return request.headers.get("x-real-ip")?.replace(/^::ffff:/, "") || "";
}

export function assertOverlayClient(request: Request, swarm: Swarm | undefined) {
  if (!swarm || !resolvePolicy(swarm).overlayOnly) return;
  const bind = process.env.HIVE_BIND?.trim();
  if (bind && (bind === HUB_OVERLAY_IP || bind === overlayHubIp())) return;
  if (process.env.NODE_ENV !== "production") return;
  const ip = clientIp(request);
  if (isOverlayIp(ip)) return;
  throw new Error("forbidden");
}

function hubKeyPath(swarmId: string) {
  mkdirSync(WG_ROOT, { recursive: true });
  return join(WG_ROOT, `${swarmId}-hub.json`);
}

function agentKeyPath(swarmId: string, agentId: string) {
  mkdirSync(join(WG_ROOT, swarmId), { recursive: true });
  return join(WG_ROOT, swarmId, `${agentId.replace(/[/:]/g, "_")}.json`);
}

export function hubWgPublic(swarmId: string) {
  const pair = loadOrCreateHubPair(swarmId);
  return pair.publicKey;
}

function loadOrCreateHubPair(swarmId: string) {
  const path = hubKeyPath(swarmId);
  const cryptoKey = swarmCryptoKey(swarmId);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      publicKey: string;
      privateEnc: { iv: string; ciphertext: string; tag: string };
    };
    return { publicKey: parsed.publicKey, privateKey: decryptSecret(parsed.privateEnc, cryptoKey) };
  } catch {
    const pair = wgKeyPair();
    writeFileSync(
      path,
      JSON.stringify({
        publicKey: pair.publicKey,
        privateEnc: encryptSecret(pair.privateKey, cryptoKey),
      }),
      { mode: 0o600 },
    );
    return { publicKey: pair.publicKey, privateKey: pair.privateKey };
  }
}

export function loadOrCreateAgentPair(swarmId: string, agentId: string) {
  const path = agentKeyPath(swarmId, agentId);
  const cryptoKey = swarmCryptoKey(swarmId);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      publicKey: string;
      privateEnc: { iv: string; ciphertext: string; tag: string };
    };
    return { publicKey: parsed.publicKey, privateKey: decryptSecret(parsed.privateEnc, cryptoKey) };
  } catch {
    const pair = wgKeyPair();
    writeFileSync(
      path,
      JSON.stringify({
        publicKey: pair.publicKey,
        privateEnc: encryptSecret(pair.privateKey, cryptoKey),
      }),
      { mode: 0o600 },
    );
    return { publicKey: pair.publicKey, privateKey: pair.privateKey };
  }
}

export function hubWireguardConf(swarmId: string, tunnels: Tunnel[]) {
  const hub = loadOrCreateHubPair(swarmId);
  const lines = [
    `# MAG Hive hub — только свой рой. HTTP слушайте на ${HUB_OVERLAY_IP}:43147`,
    `# UDP ${WG_LISTEN_PORT} должен быть доступен с улицы (иначе NAT не зайдёт).`,
    `[Interface]`,
    `Address = ${HUB_OVERLAY_IP}/24`,
    `ListenPort = ${WG_LISTEN_PORT}`,
    `PrivateKey = ${hub.privateKey}`,
    ``,
  ];
  for (const tunnel of tunnels) {
    if (!tunnel.wireguard?.publicKey) continue;
    lines.push(`[Peer]`);
    lines.push(`# ${tunnel.agentId}`);
    lines.push(`PublicKey = ${tunnel.wireguard.publicKey}`);
    lines.push(`AllowedIPs = ${tunnel.overlayIp}/32`);
    lines.push(``);
  }
  return lines.join("\n");
}

export function agentWireguardConf(swarmId: string, tunnel: Tunnel) {
  const agent = loadOrCreateAgentPair(swarmId, tunnel.agentId);
  const hubPub = hubWgPublic(swarmId);
  return [
    `# MAG Hive agent — HIVE_HUB_URL=http://${HUB_OVERLAY_IP}:43147`,
    `[Interface]`,
    `Address = ${tunnel.overlayIp}/24`,
    `PrivateKey = ${agent.privateKey}`,
    ``,
    `[Peer]`,
    `# hive hub`,
    `PublicKey = ${hubPub}`,
    `AllowedIPs = ${OVERLAY_NET}`,
    `Endpoint = ${overlayEndpoint()}`,
    `PersistentKeepalive = 25`,
    ``,
  ].join("\n");
}

export function overlayHubUrl() {
  const port = process.env.HIVE_PORT || "43147";
  const live = readLiveWireguard();
  return `http://${live?.hubIp || HUB_OVERLAY_IP}:${port}`;
}

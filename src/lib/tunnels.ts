import { generateKeyPairSync, randomBytes } from "node:crypto";
import { recommendedPath } from "./tunnel-path";
import type { Member, Tunnel } from "./types";

export { recommendedPath };

export function wgKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });
  return {
    publicKey: Buffer.from(pubDer).subarray(-32).toString("base64"),
    privateKey: Buffer.from(privDer).subarray(-32).toString("base64"),
    psk: randomBytes(32).toString("base64"),
  };
}

export function nextOverlayIp(existing: Tunnel[]): string {
  const used = new Set(existing.map((t) => t.overlayIp));
  for (let i = 1; i < 254; i++) {
    const ip = `10.42.0.${i}`;
    if (!used.has(ip)) return ip;
  }
  return `10.42.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
}

export function nextReversePort(existing: Tunnel[]): number {
  const used = new Set(
    existing.map((t) => t.ssh?.reversePort).filter((n): n is number => Boolean(n)),
  );
  let port = 22001;
  while (used.has(port)) port += 1;
  return port;
}

export function hubSshHost() {
  const fromEnv = process.env.HIVE_SSH_HOST?.trim();
  if (fromEnv) return fromEnv;
  const url = process.env.HIVE_PUBLIC_URL || process.env.HIVE_HUB_URL || "";
  try {
    if (url) return new URL(url).hostname;
  } catch {
    /* ignore */
  }
  return "hive-hub";
}

export function reverseWakeUrl(tunnel: Tunnel): string | null {
  if (!tunnel.ssh) return null;
  return `http://127.0.0.1:${tunnel.ssh.reversePort}/hive/wake`;
}

export function sshReverseCommand(tunnel: Tunnel): string | null {
  if (!tunnel.ssh) return null;
  const wake = tunnel.ssh.wakePort ?? 18790;
  const host = hubSshHost();
  const user = process.env.HIVE_SSH_USER?.trim() || tunnel.ssh.user;
  return `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R ${tunnel.ssh.reversePort}:127.0.0.1:${wake} ${user}@${host}`;
}

export function wireguardPeerConfig(self: Tunnel, peers: Tunnel[], privateKey?: string): string {
  const lines = [
    `[Interface]`,
    `Address = ${self.overlayIp}/24`,
    `ListenPort = ${self.wireguard?.listenPort ?? 51820}`,
    `PrivateKey = ${privateKey ?? "<wg genkey on the node>"}`,
    ``,
  ];
  for (const peer of peers) {
    if (peer.agentId === self.agentId || !peer.wireguard) continue;
    lines.push(`[Peer]`);
    lines.push(`# ${peer.agentId}`);
    lines.push(`PublicKey = ${peer.wireguard.publicKey}`);
    lines.push(`AllowedIPs = ${peer.overlayIp}/32`);
    if (peer.wireguard.endpoint) lines.push(`Endpoint = ${peer.wireguard.endpoint}`);
    lines.push(`PersistentKeepalive = 25`);
    lines.push(``);
  }
  return lines.join("\n");
}

export function tunnelSummary(member: Member | undefined, tunnel: Tunnel) {
  return {
    handle: member?.handle ?? tunnel.agentId,
    overlayIp: tunnel.overlayIp,
    kind: tunnel.kind,
    status: tunnel.status,
    path: recommendedPath(tunnel),
  };
}

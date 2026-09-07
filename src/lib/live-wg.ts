import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import type { LinkStatus, Member, Tunnel } from "./types";

export type LiveWgPeer = {
  ip: string;
  handshakeAt: number;
  rx: number;
  tx: number;
  status: LinkStatus;
};

export type LiveWgSnapshot = {
  iface: string;
  hubIp: string;
  net: string;
  listenPort: number;
  peers: LiveWgPeer[];
  adopted: true;
};

const FRESH_MS = 180_000;
const DUMP_TTL_MS = 30_000;
let cached: { at: number; snap: LiveWgSnapshot | null } = { at: 0, snap: null };

function firstV4(text: string): string | null {
  const match = text.match(/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  return match?.[1] ?? null;
}

function cidrHost(cidr: string): string | null {
  const match = cidr.trim().match(/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3})\/\d+$/);
  return match?.[1] ?? null;
}

function parseHandleMap(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.HIVE_WG_MAP?.trim() || "";
  for (const part of raw.split(/[,;\s]+/)) {
    const [handle, ip] = part.split("=").map((item) => item.trim());
    if (handle && ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) map.set(handle.replace(/^@/, ""), ip);
  }
  return map;
}

function preferredIface(): string {
  return process.env.HIVE_WG_IFACE?.trim() || "";
}

function hubIpFromIface(iface: string): string | null {
  try {
    const text = execFileSync("ip", ["-4", "-o", "addr", "show", "dev", iface], {
      encoding: "utf8",
      timeout: 2000,
    });
    return firstV4(text);
  } catch {
    return null;
  }
}

function detectHubIp(): { iface: string; hubIp: string } | null {
  const envIp = process.env.HIVE_WG_HUB_IP?.trim();
  const wanted = preferredIface();
  if (envIp && /^\d+\.\d+\.\d+\.\d+$/.test(envIp)) return { iface: wanted, hubIp: envIp };
  const fromWanted = hubIpFromIface(wanted);
  if (fromWanted) return { iface: wanted, hubIp: fromWanted };
  try {
    const text = execFileSync("ip", ["-4", "-o", "addr"], { encoding: "utf8", timeout: 2000 });
    for (const line of text.split("\n")) {
      if (!/\bwg/.test(line)) continue;
      const iface = line.split(/\s+/)[1];
      const ip = firstV4(line);
      if (iface && ip) return { iface, hubIp: ip };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function wgDump(): string {
  const args = ["show", "all", "dump"];
  try {
    return execFileSync("sudo", ["-n", "wg", ...args], { encoding: "utf8", timeout: 2500, maxBuffer: 64_000 });
  } catch {
    try {
      return execFileSync("wg", args, { encoding: "utf8", timeout: 2500, maxBuffer: 64_000 });
    } catch {
      return "";
    }
  }
}

function netFromHub(hubIp: string): string {
  const parts = hubIp.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function readLiveWireguard(force = false): LiveWgSnapshot | null {
  if (!force && Date.now() - cached.at < DUMP_TTL_MS) return cached.snap;
  const hub = detectHubIp();
  if (!hub) {
    cached = { at: Date.now(), snap: null };
    return null;
  }
  const dump = wgDump();
  const peers: LiveWgPeer[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const line of dump.split("\n")) {
    const cols = line.trim().split("\t");
    if (cols.length < 9) continue;
    if (cols[0] !== hub.iface) continue;
    const allowed = cols[4];
    const handshake = Number(cols[5] || 0);
    const ip = cidrHost(allowed.split(",")[0] || "");
    if (!ip) continue;
    const age = handshake > 0 ? now - handshake : 1e9;
    peers.push({
      ip,
      handshakeAt: handshake > 0 ? handshake * 1000 : 0,
      rx: Number(cols[6] || 0),
      tx: Number(cols[7] || 0),
      status: handshake > 0 && age <= FRESH_MS / 1000 ? "up" : "down",
    });
  }
  const snap: LiveWgSnapshot = {
    iface: hub.iface,
    hubIp: hub.hubIp,
    net: process.env.HIVE_WG_NET?.trim() || netFromHub(hub.hubIp),
    listenPort: Number(process.env.HIVE_WG_PORT || 51820),
    peers,
    adopted: true,
  };
  cached = { at: Date.now(), snap };
  return snap;
}

export function isLiveOverlayIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "127.0.0.1" || clean === "::1") return true;
  if (/^10\.42\.0\.([1-9]\d?|1\d\d|2[0-4]\d|25[0-4])$/.test(clean)) return true;
  const snap = readLiveWireguard();
  if (snap) {
    const prefix = snap.net.replace(/\.0\/24$/, ".");
    if (clean.startsWith(prefix)) return true;
  }
  return /^10\.66\.66\.\d+$/.test(clean);
}

export function overlayHubIp(): string {
  return readLiveWireguard()?.hubIp || process.env.HIVE_WG_HUB_IP?.trim() || "10.42.0.1";
}

function ipForHandle(handle: string, member: Member | undefined, snap: LiveWgSnapshot): string | null {
  const mapped = parseHandleMap().get(handle);
  if (mapped) return mapped;
  if (handle === "main" || handle === "orchestrator") return snap.hubIp;
  const existing = member?.webhookUrl?.match(/https?:\/\/(\d+\.\d+\.\d+\.\d+)/)?.[1];
  if (existing && snap.peers.some((peer) => peer.ip === existing)) return existing;
  return null;
}

export function adoptLiveTunnels(input: {
  members: Member[];
  tunnels: Tunnel[];
}): { changed: boolean; live: LiveWgSnapshot | null } {
  const snap = readLiveWireguard();
  if (!snap) return { changed: false, live: null };
  let changed = false;
  const used = new Set<string>();
  const byAgent = new Map(input.members.map((member) => [member.id, member]));
  const unmatchedUp = snap.peers.filter((peer) => peer.status === "up");

  for (const tunnel of input.tunnels) {
    const member = byAgent.get(tunnel.agentId);
    if (!member || member.simulated || member.peerHubId) continue;
    let ip = ipForHandle(member.handle, member, snap);
    if (!ip && tunnel.overlayIp && snap.peers.some((peer) => peer.ip === tunnel.overlayIp)) ip = tunnel.overlayIp;
    if (!ip) {
      const leftover = unmatchedUp.find((peer) => !used.has(peer.ip));
      if (leftover && (member.os === "windows" || member.handle === "office")) ip = leftover.ip;
    }
    if (!ip) continue;
    used.add(ip);
    const peer = snap.peers.find((item) => item.ip === ip);
    const onHub = ip === snap.hubIp;
    const status: LinkStatus = onHub ? "up" : peer?.status ?? "down";
    const wakePort = tunnel.ssh?.wakePort ?? 18790;
    const notes = onHub
      ? `Подхвачен ${snap.iface}: хаб ${snap.hubIp}. Wake на localhost, тот же контур что и админка.`
      : `Подхвачен ${snap.iface}: ${ip} (${status}). Звезда через хаб — до соседа не напрямую, пока AllowedIPs/forward не разрешат hop.`;

    if (tunnel.overlayIp !== ip) {
      tunnel.overlayIp = ip;
      changed = true;
    }
    if (tunnel.status !== status) {
      tunnel.status = status;
      changed = true;
    }
    tunnel.kind = tunnel.ssh ? "both" : "wireguard";
    tunnel.notes = notes;
    tunnel.wireguard = {
      publicKey: tunnel.wireguard?.publicKey || "adopted",
      listenPort: snap.listenPort,
      allowedIps: `${ip}/32`,
      lastHandshakeAt: peer?.handshakeAt || (onHub ? Date.now() : undefined),
      fallback: false,
    };
    const overlayWake = onHub ? null : `http://${ip}:${wakePort}/hive/wake`;
    if (overlayWake && member.webhookUrl !== overlayWake) {
      member.webhookUrl = overlayWake;
      changed = true;
    }
  }
  return { changed, live: snap };
}

export function wgInstallHint(): string {
  const confs = [];
  try {
    if (existsSync("/etc/wireguard")) {
      for (const name of readdirSync("/etc/wireguard")) {
        if (name.endsWith(".conf")) confs.push(name.replace(/\.conf$/, ""));
      }
    }
  } catch {
    /* ignore */
  }
  if (confs.length) return `На хабе уже есть WireGuard: ${confs.join(", ")}. Hive подхватывает живой интерфейс, второй overlay 10.42 не нужен.`;
  return "Вместе с нодой: пакет wireguard, интерфейс в /etc/wireguard, затем HIVE_WG_IFACE=имя. Если WG уже стоит — Hive его находит и рисует карту.";
}


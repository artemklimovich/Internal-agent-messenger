import type { Tunnel } from "./types";

export function recommendedPath(tunnel: Tunnel): string {
  if (tunnel.ssh?.status === "up") {
    return "SSH reverse — основной путь к OpenClaw Gateway";
  }
  if (tunnel.wireguard && tunnel.status !== "down") {
    return "WireGuard fallback — SSH недоступен, overlay жив";
  }
  if (tunnel.kind === "none") {
    return "Только сигнальный канал Hive, без L3";
  }
  return "Нет живого туннеля — агент не достучится до Gateway";
}

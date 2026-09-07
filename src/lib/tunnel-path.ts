import type { Tunnel } from "./types";

export function recommendedPath(tunnel: Tunnel): string {
  if (tunnel.ssh?.status === "up") {
    return "SSH reverse жив: хаб доставляет пейдж на машину без белого IP (порт на хабе → localhost агента).";
  }
  if (tunnel.wireguard && tunnel.status !== "down") {
    return "WireGuard overlay: стабильный 10.42.0.x своей машины. Не @handle и не эфир.";
  }
  if (tunnel.kind === "none") {
    return "Только HTTPS/SSE. Белого IP нет — агент сам держит поток к хабу.";
  }
  return "Reverse SSH не поднят. Пейдж всё равно уйдёт по SSE, если hive-node запущен. Туннель нужен, когда потока нет и у машины нет входящего порта.";
}

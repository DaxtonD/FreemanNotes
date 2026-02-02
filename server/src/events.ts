import type { WebSocket } from 'ws';

const connections = new Map<number, Set<WebSocket>>();

export function registerConnection(userId: number, ws: WebSocket) {
  const set = connections.get(userId) || new Set<WebSocket>();
  set.add(ws);
  connections.set(userId, set);
}

export function removeConnection(userId: number, ws: WebSocket) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

export function notifyUser(userId: number, type: string, payload: any) {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ type, payload });
  for (const ws of set) {
    try { ws.send(msg); } catch {}
  }
}

// Prefisso di rete usato per le chiavi anonime (SDD §6.1): IPv4 intero, IPv6 /64.
// L'IP non esce mai da questa funzione e dall'HMAC che segue: non viene salvato né loggato.

export function ipPrefix(ip: string): string | null {
  const v4 = parseV4(ip.startsWith("::ffff:") ? ip.slice(7) : ip);
  if (v4 !== null) return v4;
  const groups = expandV6(ip);
  return groups === null ? null : `${groups.slice(0, 4).join(":")}::/64`;
}

function parseV4(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
  }
  return parts.map(Number).join(".");
}

function expandV6(ip: string): string[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(ip) || ip.split("::").length > 2) return null;
  const [head = "", tail] = ip.split("::");
  const h = head === "" ? [] : head.split(":");
  const t = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = 8 - h.length - t.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const all = [...h, ...Array<string>(tail === undefined ? 0 : missing).fill("0"), ...t];
  if (all.some((g) => g.length === 0 || g.length > 4)) return null;
  return all.map((g) => g.toLowerCase().padStart(4, "0"));
}

// Small IP helpers for enumerating an IP range in the UI. IPv4 is fully supported
// (enumerated); IPv6 ranges are far too large to list, so callers should detect v6
// and show a notice instead of enumerating.

export function isV6(addr: string): boolean {
  return (addr.split('/')[0] ?? '').includes(':');
}

/** "10.0.0.5/24" -> "24" (mask part), or '' if none. */
export function maskOf(addr: string): string {
  const i = addr.indexOf('/');
  return i >= 0 ? addr.slice(i + 1) : '';
}

/** Strip any /mask. */
export function bare(addr: string): string {
  return (addr.split('/')[0] ?? '').trim();
}

export function ipToBig(addr: string): bigint | null {
  const s = bare(addr);
  return s.includes(':') ? v6ToBig(s) : v4ToBig(s);
}

function v4ToBig(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) + BigInt(v);
  }
  return n;
}

function v6ToBig(s: string): bigint | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0]!.split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const tail = halves[1] ? halves[1]!.split(':') : [];
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** Render an IPv4 integer back to dotted-quad. */
export function bigToV4(n: bigint): string {
  return [24n, 16n, 8n, 0n].map((sh) => Number((n >> sh) & 255n)).join('.');
}

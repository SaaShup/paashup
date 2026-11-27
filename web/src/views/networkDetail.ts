// Presentation config + helpers for the Docker network's `subnet` field (the IP range
// requested for the network, see the agent's IPAM.Config[0].Subnet). Kept framework-free
// so it can be unit-tested without mounting a component.

/** A ready-made private-network CIDR offered on the "Subnet" select. */
export interface SubnetPreset {
  value: string;
  family: 4 | 6;
}

/**
 * Common private ranges. Includes Docker's own default address pool (172.16.0.0/12,
 * carved into 172.16.0.0/16 .. 172.31.0.0/16 — what Docker hands out itself when no
 * subnet is requested) alongside a few ranges outside it, so there's always something
 * to offer even once every /16 of the default pool is taken on a host. The form filters
 * this list against the chosen host's other networks, so an already-used block (very
 * likely somewhere in 172.16.0.0/12 on a host with a few auto-assigned networks) simply
 * doesn't show up rather than being offered and then rejected as a duplicate.
 */
export const SUBNET_PRESETS: SubnetPreset[] = [
  ...Array.from({ length: 16 }, (_, i): SubnetPreset => ({ value: `172.${16 + i}.0.0/16`, family: 4 })),
  { value: '10.10.0.0/16', family: 4 },
  { value: '10.20.0.0/16', family: 4 },
  { value: '10.30.0.0/16', family: 4 },
  { value: '192.168.100.0/24', family: 4 },
  { value: '192.168.200.0/24', family: 4 },
  { value: 'fd00:1::/64', family: 6 },
  { value: 'fd00:2::/64', family: 6 },
  { value: 'fd00:dead:beef::/64', family: 6 },
];

const IPV4_CIDR =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\/(3[0-2]|[12]?\d)$/;

// The usual "every way to write an IPv6 address" pattern (full, :: compression, etc.),
// plus a /0-128 prefix length.
const IPV6_CIDR =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01]\d|[1-9]?\d)$/;

/** The IP family a (trimmed, non-empty) CIDR string looks like, from its separator. */
export function subnetFamily(v: string): 4 | 6 | null {
  const s = v.trim();
  if (!s) return null;
  return s.includes(':') ? 6 : 4;
}

/** "172.30.0.1" -> 2886860801 (unsigned 32-bit). */
function ipv4ToUint(addr: string): number {
  return addr.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

/**
 * "fd00:1::" -> its 128-bit value, or null if it isn't a well-formed IPv6 address
 * (one "::" at most, exactly 8 groups once expanded, each a valid hex hextet).
 */
function ipv6ToBigint(addr: string): bigint | null {
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/**
 * Whether `v` is a syntactically valid CIDR, IPv4 or IPv6 (e.g. "172.30.0.0/16", "fd00::/64"),
 * AND its address is the network's actual base address — no host bits set (Docker silently
 * ignores an IPAM subnet that isn't, e.g. "172.30.0.1/16", and auto-picks one from its own
 * default pool instead, which is worse than just rejecting it up front).
 */
export function isValidSubnet(v: string): boolean {
  const s = v.trim();
  const [addr, prefixStr] = s.split('/');
  if (addr === undefined || prefixStr === undefined) return false;
  const prefix = Number(prefixStr);
  if (IPV4_CIDR.test(s)) {
    if (prefix === 32) return true;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToUint(addr) & ~mask) >>> 0 === 0;
  }
  if (IPV6_CIDR.test(s)) {
    if (prefix === 128) return true;
    const value = ipv6ToBigint(addr);
    if (value === null) return false;
    const hostBits = BigInt(128 - prefix);
    const mask = (1n << hostBits) - 1n;
    return (value & mask) === 0n;
  }
  return false;
}

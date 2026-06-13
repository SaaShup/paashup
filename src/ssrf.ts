// SSRF egress guard for user-configured outbound requests (webhooks, netbox-migrate).
// By default it blocks cloud-metadata / link-local targets — the highest-value SSRF
// (e.g. 169.254.169.254 IAM creds) — while still allowing loopback/private hosts so
// internal webhooks and dev keep working. Set PB_SSRF_BLOCK_PRIVATE=1 to also block
// loopback, RFC1918, and ULA ranges for a hardened, internet-only egress posture.
import dns from 'node:dns/promises';
import net from 'node:net';

const META_IPS = new Set([
  '169.254.169.254', // AWS/GCP/Azure/OpenStack metadata
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba metadata
]);

function isBlockedIp(ip: string, blockPrivate: boolean): boolean {
  if (META_IPS.has(ip)) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 169 && b === 254) return true; // link-local (covers metadata)
    if (!blockPrivate) return false;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low.startsWith('fe80') || low.startsWith('fec0')) return true; // link-local
    if (low === 'fd00:ec2::254') return true; // AWS IMDS over IPv6
    if (!blockPrivate) return false;
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
    return false;
  }
  return false;
}

/**
 * Throw if `raw` is not a safe outbound target: only http(s) is allowed, and the host
 * (every resolved address) must not be a blocked range. Resolving hostnames also defends
 * against DNS-rebinding for the initial request. Call before each fetch (and on every
 * redirect / follow-up URL).
 */
export async function assertAllowedUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`blocked URL scheme: ${u.protocol}`);
  }
  const blockPrivate = process.env.PB_SSRF_BLOCK_PRIVATE === '1';
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    try {
      ips = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new Error(`cannot resolve host: ${host}`);
    }
  }
  for (const ip of ips) {
    if (isBlockedIp(ip, blockPrivate)) {
      throw new Error(`blocked address (SSRF guard): ${host} -> ${ip}`);
    }
  }
}

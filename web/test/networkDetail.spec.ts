// Coverage for the Docker network subnet helpers: syntactic CIDR validation plus the
// "must be the network's actual base address" check — Docker silently replaces a subnet
// with host bits set (e.g. "172.30.0.1/16") with one from its own default pool instead of
// rejecting it, which is worse than catching it in the form up front.
import { describe, it, expect } from 'vitest';
import { SUBNET_PRESETS, isValidSubnet, subnetFamily } from '../src/views/networkDetail';

describe('subnetFamily', () => {
  it('reads the family from the separator', () => {
    expect(subnetFamily('172.30.0.0/16')).toBe(4);
    expect(subnetFamily('fd00:1::/64')).toBe(6);
  });
  it('is null for blank input', () => {
    expect(subnetFamily('')).toBeNull();
    expect(subnetFamily('   ')).toBeNull();
  });
});

describe('isValidSubnet', () => {
  it('accepts a proper IPv4 network address', () => {
    expect(isValidSubnet('172.30.0.0/16')).toBe(true);
    expect(isValidSubnet('10.0.0.0/8')).toBe(true);
    expect(isValidSubnet('0.0.0.0/0')).toBe(true);
    expect(isValidSubnet('192.168.1.5/32')).toBe(true); // /32: every address is its own network
  });
  it('rejects an IPv4 CIDR with host bits set, even though the syntax is valid', () => {
    expect(isValidSubnet('172.35.0.1/16')).toBe(false); // the exact case that confused Docker
    expect(isValidSubnet('10.0.0.1/8')).toBe(false);
  });
  it('accepts a proper IPv6 network address', () => {
    expect(isValidSubnet('fd00:1::/64')).toBe(true);
    expect(isValidSubnet('fd00::/8')).toBe(true);
    expect(isValidSubnet('::1/128')).toBe(true); // /128: every address is its own network
  });
  it('rejects an IPv6 CIDR with host bits set', () => {
    expect(isValidSubnet('fd00:1::1/64')).toBe(false);
  });
  it('rejects garbage and malformed input', () => {
    expect(isValidSubnet('not-an-ip/16')).toBe(false);
    expect(isValidSubnet('172.30.0.0')).toBe(false); // no prefix length
    expect(isValidSubnet('172.300.0.0/16')).toBe(false); // out-of-range octet
    expect(isValidSubnet('')).toBe(false);
  });
});

describe('SUBNET_PRESETS', () => {
  it('covers every /16 of Docker\'s own default pool (172.16.0.0/12)', () => {
    const v4 = SUBNET_PRESETS.filter((p) => p.family === 4).map((p) => p.value);
    for (let i = 16; i <= 31; i++) expect(v4).toContain(`172.${i}.0.0/16`);
  });
  it('every preset is itself a valid network address', () => {
    for (const p of SUBNET_PRESETS) expect(isValidSubnet(p.value)).toBe(true);
  });
  it('includes ranges outside Docker\'s default pool too, for when it\'s exhausted', () => {
    const values = SUBNET_PRESETS.map((p) => p.value);
    expect(values).toContain('10.10.0.0/16');
    expect(values).toContain('192.168.100.0/24');
    expect(values.some((v) => subnetFamily(v) === 6)).toBe(true);
  });
});

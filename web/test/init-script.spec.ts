import { describe, it, expect } from 'vitest';
import { isValidDefault, parseVariables, setDefault } from '../src/initScript';

// The web copy of the variable reader must agree with the server's (src/initscripts.ts):
// the form shows the variables while the script is typed, the server stores them on save.
describe('parseVariables', () => {
  it('reads the ${NAME:-default} of a script, nested ones included, in order', () => {
    const script = [
      '#!/bin/bash',
      'BASE_DOMAIN="${1:-${BASE_DOMAIN:-daily.paashup.cloud}}"',
      'PRIVATE_IFACE="${PRIVATE_IFACE:-ens4}"',
      'AGENT_IMAGE="saashup/netbox-docker-agent:v1.23.0"',
    ].join('\n');
    expect(parseVariables(script)).toEqual([
      { name: 'BASE_DOMAIN', default: 'daily.paashup.cloud' },
      { name: 'PRIVATE_IFACE', default: 'ens4' },
    ]);
  });

  it('reads an empty default, a default holding braces and a repeated variable', () => {
    expect(parseVariables('#!/bin/sh\nA="${A:-}"')).toEqual([{ name: 'A', default: '' }]);
    expect(parseVariables('#!/bin/sh\nO="${ORIGINS:-https://${BASE_DOMAIN}}"')).toEqual([
      { name: 'ORIGINS', default: 'https://${BASE_DOMAIN}' },
    ]);
    expect(parseVariables('#!/bin/sh\na="${X:-1}"\nb="${X:-2}"')).toEqual([
      { name: 'X', default: '1' },
    ]);
  });

  it('ignores comments, literals, positional parameters and unclosed braces', () => {
    expect(parseVariables('#!/bin/sh\n  # ${C:-x}\nfoo=bar\necho "${1:-a}"')).toEqual([]);
    expect(parseVariables('#!/bin/sh\necho "${OPEN:-never closed')).toEqual([]);
    expect(parseVariables('')).toEqual([]);
  });
});

describe('isValidDefault', () => {
  it('accepts values whose braces balance', () => {
    expect(isValidDefault('')).toBe(true);
    expect(isValidDefault('a.b')).toBe(true);
    expect(isValidDefault('${Z}')).toBe(true);
    expect(isValidDefault('https://${BASE_DOMAIN}/x')).toBe(true);
  });

  it('refuses a value that would close or leave open the ${…}', () => {
    expect(isValidDefault('a}')).toBe(false);
    expect(isValidDefault('${Z')).toBe(false);
    expect(isValidDefault('}{')).toBe(false);
  });
});

describe('setDefault', () => {
  const script = [
    '#!/bin/bash',
    '# ${D:-commented}',
    'A="${1:-${D:-a.b}}"',
    'B="${D:-a.b}"',
    'C="${C:-x}"',
  ].join('\n');

  it('rewrites the default everywhere the variable is declared, and nothing else', () => {
    expect(setDefault(script, 'D', 'new.io')).toBe(
      [
        '#!/bin/bash',
        '# ${D:-commented}',
        'A="${1:-${D:-new.io}}"',
        'B="${D:-new.io}"',
        'C="${C:-x}"',
      ].join('\n'),
    );
  });

  it('accepts an empty default and one that holds another variable', () => {
    expect(parseVariables(setDefault(script, 'C', ''))).toContainEqual({ name: 'C', default: '' });
    expect(parseVariables(setDefault(script, 'C', '${Z:-q}'))).toEqual([
      { name: 'D', default: 'a.b' },
      { name: 'C', default: '${Z:-q}' },
      { name: 'Z', default: 'q' },
    ]);
  });

  it('leaves the script alone for a variable it does not declare', () => {
    expect(setDefault(script, 'NOPE', 'x')).toBe(script);
  });

  it('round-trips: the parsed default is the one that was set', () => {
    for (const value of ['', 'plain', 'with space', '/path/to:thing', 'https://x.y/${Z}']) {
      const changed = setDefault(script, 'C', value);
      expect(parseVariables(changed).find((v) => v.name === 'C')?.default).toBe(value);
    }
  });
});

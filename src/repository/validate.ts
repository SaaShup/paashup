import type { TableMeta } from '../model/meta-types.js';
import { ValidationError } from '../errors.js';
import { customFieldsFor } from '../customfields/registry.js';
import { checkScript, parseVariables } from '../initscripts.js';

/** `<type> <base64> [comment]` on one line, for the key types OpenSSH and OpenStack accept. */
export const SSH_PUBLIC_KEY =
  /^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [^\r\n]*)?$/;

/**
 * What Nova accepts as a keypair name (compute API up to 2.91; 2.92 also allows "." and
 * "@"): letters, digits, "_", "-" and inner spaces. Keys are checked against it when created
 * so any of them can be registered as a keypair when a VM is launched with it.
 */
export const NOVA_KEYPAIR_NAME = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/;

/** Field-keyed error messages, NetBox-style: { name: ["This field is required."] }. */
export type FieldErrors = Record<string, string[] | Record<string, string[]>>;

/**
 * Validate a create/update body against the table metadata before touching the DB,
 * so clients get clear field-level errors instead of opaque constraint failures.
 * `partial` (PATCH) skips the required-field check.
 */
export function validateWrite(
  meta: TableMeta,
  data: Record<string, unknown>,
  partial: boolean,
): void {
  const errors: FieldErrors = {};
  const add = (field: string, msg: string) => ((errors[field] ??= []) as string[]).push(msg);
  const byName = new Map(meta.columns.map((c) => [c.name, c]));
  const relNames = new Set(meta.relations.map((r) => r.name));

  if (!partial) {
    for (const col of meta.columns) {
      if (col.writable && col.required && data[col.name] === undefined) {
        add(col.name, 'This field is required.');
      }
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || relNames.has(key)) continue; // relations validated separately
    const col = byName.get(key);
    if (!col || !col.writable) continue; // unknown / read-only keys are ignored

    if (value === null) {
      if (!col.nullable) add(key, 'This field may not be null.');
      continue;
    }
    if (col.enum) {
      if (!col.enum.some((v) => v === value)) {
        add(key, `"${value}" is not a valid choice.`);
      }
      continue;
    }
    switch (col.tsKind) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value))
          add(key, 'A valid number is required.');
        break;
      case 'boolean':
        if (typeof value !== 'boolean') add(key, 'Must be a valid boolean.');
        break;
      case 'string':
        if (typeof value !== 'string') add(key, 'Not a valid string.');
        else if (col.maxLength && value.length > col.maxLength)
          add(key, `Ensure this value has at most ${col.maxLength} characters.`);
        break;
      case 'json':
        break; // any JSON value is acceptable
    }
  }

  // gateway must be a valid IP, and within [start_address, end_address] when both
  // bounds are present (paashup extension to IP ranges).
  if (byName.has('gateway') && typeof data.gateway === 'string' && data.gateway.trim() !== '') {
    const gw = ipToInt(data.gateway);
    if (gw === null) {
      add('gateway', 'Enter a valid IPv4 or IPv6 address.');
    } else {
      const lo = typeof data.start_address === 'string' ? ipToInt(data.start_address) : null;
      const hi = typeof data.end_address === 'string' ? ipToInt(data.end_address) : null;
      if (lo !== null && hi !== null && (gw < lo || gw > hi)) {
        add('gateway', 'Gateway must be an address within the range.');
      }
    }
  }

  // dhcp_relays must be a list of valid IP addresses (paashup extension).
  if (byName.has('dhcp_relays') && data.dhcp_relays != null) {
    const v = data.dhcp_relays;
    if (!Array.isArray(v)) {
      add('dhcp_relays', 'Expected a list of IP addresses.');
    } else {
      v.forEach((item, i) => {
        if (typeof item !== 'string' || ipToInt(item) === null) {
          add('dhcp_relays', `Entry ${i + 1} ("${String(item)}") is not a valid IP address.`);
        }
      });
    }
  }

  // A new SSH key must have a name Nova accepts, so it can be used to launch a VM.
  if (
    meta.table === 'virtualization_ssh_key' &&
    !partial &&
    typeof data.name === 'string' &&
    !NOVA_KEYPAIR_NAME.test(data.name)
  ) {
    add(
      'name',
      'Use only letters, digits, "-", "_" and spaces (no leading or trailing space): this is what OpenStack accepts as a keypair name.',
    );
  }

  // An SSH key holds the *public* half only, on a single line, in OpenSSH format.
  if (meta.table === 'virtualization_ssh_key' && typeof data.public_key === 'string') {
    const key = data.public_key.trim();
    if (/PRIVATE KEY/.test(key)) {
      add('public_key', 'This looks like a private key. Only the public key is stored.');
    } else if (!SSH_PUBLIC_KEY.test(key)) {
      add('public_key', 'Not a valid OpenSSH public key (e.g. "ssh-ed25519 AAAA… comment").');
    } else {
      data.public_key = key; // stored without surrounding whitespace
    }
  }

  // An init script's variables are derived from its content, never taken from the client;
  // the featured and secret ones are kept only if the script declares them.
  if (meta.table === 'virtualization_init_script') {
    delete data.variables;
    let names: string[] | null = null;
    if (typeof data.content === 'string') {
      const problem = checkScript(data.content);
      if (problem) add('content', problem);
      const vars = parseVariables(data.content);
      data.variables = vars;
      names = vars.map((v) => v.name);
    }
    for (const field of ['featured_variables', 'secret_variables']) {
      if (!partial && data[field] === undefined) data[field] = [];
      const list = data[field];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list) || list.some((n) => typeof n !== 'string')) {
        add(field, 'Expected a list of variable names.');
      } else if (names) {
        // the content decides what the variables are: a name it no longer declares is dropped
        data[field] = list.filter((n) => names!.includes(n as string));
      }
    }
  }

  const cfErrors = validateCustomFields(meta.table, data.custom_fields, partial);
  if (cfErrors) errors.custom_fields = cfErrors;

  if (Object.keys(errors).length) {
    throw new ValidationError('Validation failed', errors);
  }
}

/** Parse an IPv4/IPv6 address (optionally with a /mask) to a comparable integer. */
function ipToInt(addr: string): bigint | null {
  const s = addr.split('/')[0]!.trim();
  return s.includes(':') ? ipv6ToInt(s) : ipv4ToInt(s);
}

function ipv4ToInt(s: string): bigint | null {
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

function ipv6ToInt(s: string): bigint | null {
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

/** Validate the `custom_fields` payload against registered definitions. */
function validateCustomFields(
  table: string,
  value: unknown,
  partial: boolean,
): Record<string, string[]> | undefined {
  const defs = customFieldsFor(table);
  if (!defs.length) return undefined;
  const provided =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const errors: Record<string, string[]> = {};
  const add = (name: string, msg: string) => (errors[name] ??= []).push(msg);
  const defined = new Set(defs.map((d) => d.name));

  for (const key of Object.keys(provided)) {
    if (!defined.has(key)) add(key, 'Unknown custom field.');
  }
  for (const def of defs) {
    const present = def.name in provided && provided[def.name] !== null;
    if (!partial && def.required && !present && def.default === undefined) {
      add(def.name, 'This field is required.');
    }
    if (!(def.name in provided) || provided[def.name] === null) continue;
    const v = provided[def.name];
    if (def.type === 'integer' && (typeof v !== 'number' || !Number.isInteger(v)))
      add(def.name, 'A valid integer is required.');
    else if (def.type === 'boolean' && typeof v !== 'boolean')
      add(def.name, 'Must be a valid boolean.');
    else if (def.type === 'text' && typeof v !== 'string') add(def.name, 'Not a valid string.');
    else if (def.type === 'select' && !(def.choices ?? []).includes(v as string))
      add(def.name, `"${v}" is not a valid choice.`);
  }
  return Object.keys(errors).length ? errors : undefined;
}

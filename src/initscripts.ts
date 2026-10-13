// Init scripts: shell scripts handed to a new VM (OpenStack `user_data`, run by cloud-init
// at first boot). A script declares its adjustable variables the way plain shell does,
// `${NAME:-default}`.
export interface ScriptVariable {
  name: string;
  /** The default as written in the script (may itself contain `${…}`). */
  default: string;
}

/** Nova rejects user_data above 65535 bytes once base64-encoded. */
export const MAX_USER_DATA_BASE64 = 65535;

const OPENER = /\$\{([A-Za-z_][A-Za-z0-9_]*):-/g;

/** The `${NAME:-default}` variables of a script, in order of first appearance. */
export function parseVariables(content: string): ScriptVariable[] {
  const found = new Map<string, ScriptVariable>();
  const lines = content.split('\n');
  let offset = 0;
  const commented: [number, number][] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('#')) commented.push([offset, offset + line.length]);
    offset += line.length + 1;
  }
  for (const m of content.matchAll(OPENER)) {
    const at = m.index!;
    if (commented.some(([a, b]) => at >= a && at < b)) continue;
    const name = m[1]!;
    if (found.has(name)) continue;
    const start = at + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
    }
    if (depth !== 0) continue; // unterminated: not a variable
    found.set(name, { name, default: content.slice(start, i - 1) });
  }
  return [...found.values()];
}

/** Why a script can't be used for a VM, or null when it can. */
export function checkScript(content: string): string | null {
  if (!content.startsWith('#!'))
    return 'The script must start with a shebang line, e.g. "#!/bin/bash".';
  if (content.includes('\0')) return 'The script contains a NUL character.';
  if (Math.ceil(Buffer.byteLength(content) / 3) * 4 > MAX_USER_DATA_BASE64)
    return 'The script is too large (OpenStack accepts about 48 KB).';
  return null;
}

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export function renderScript(
  content: string,
  values: Record<string, string>,
): { script: string; changed: Record<string, string> } {
  const vars = new Map(parseVariables(content).map((v) => [v.name, v]));
  const lines: string[] = [];
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const v = vars.get(name);
    if (!v) throw new Error(`The script has no variable "${name}".`);
    if (typeof value !== 'string') throw new Error(`Variable "${name}" must be a string.`);
    if (value.includes('\0')) throw new Error(`Variable "${name}" contains a NUL character.`);
    if (value === v.default) continue;
    lines.push(`export ${name}=${shellQuote(value)}`);
    changed[name] = value;
  }
  if (!lines.length) return { script: content, changed };
  const nl = content.indexOf('\n');
  const script =
    nl === -1
      ? `${content}\n${lines.join('\n')}\n`
      : `${content.slice(0, nl + 1)}${lines.join('\n')}\n${content.slice(nl + 1)}`;
  return { script, changed };
}

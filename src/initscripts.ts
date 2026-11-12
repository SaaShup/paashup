// Init scripts: shell scripts handed to a new VM (OpenStack `user_data`, run by cloud-init
// at first boot). A script declares its adjustable variables the way plain shell does,
// `${NAME:-default}`.
//
// A script may also be a MIME multipart document (a `text/cloud-config` part alongside a
// `text/x-shellscript` part), cloud-init's own way to combine a declarative `#cloud-config`
// (e.g. disk_setup/mounts, processed early) with a shell script (processed last).
// `${NAME:-default}` works the same way in both: the shell part still relies on bash's own
// expansion for values left at their default (as before), but the cloud-config part is plain
// YAML that cloud-init never expands, so its variables are always substituted literally.
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

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The top-level `Content-Type: multipart/mixed; boundary="…"` header, searched near the start. */
const MULTIPART_RE = /^content-type:\s*multipart\/mixed[^\n]*?boundary="?([^";\r\n]+)"?/im;

const isMultipart = (content: string): boolean => MULTIPART_RE.test(content.slice(0, 1000));

interface MimePart {
  /** This part's own header block, e.g. `Content-Type: text/x-shellscript; charset="us-ascii"`. */
  header: string;
  body: string;
}

interface MimeDoc {
  /** The top-level headers (Content-Type, MIME-Version), kept as written. */
  preamble: string;
  boundary: string;
  parts: MimePart[];
}

/** Split a multipart user_data document into its parts; null when it isn't well-formed MIME. */
function parseMultipart(content: string): MimeDoc | null {
  const m = content.slice(0, 1000).match(MULTIPART_RE);
  if (!m) return null;
  const boundary = m[1]!;
  const delim = new RegExp(`\\r?\\n--${escapeRegExp(boundary)}(?:--)?[ \\t]*\\r?\\n?`);
  const sections = content.split(delim);
  if (sections.length < 2) return null;
  const [preamble, ...rest] = sections;
  const trailing = rest[rest.length - 1];
  const raws = trailing !== undefined && trailing.trim() === '' ? rest.slice(0, -1) : rest;
  const parts: MimePart[] = [];
  for (const raw of raws) {
    const sep = raw.match(/\r?\n\r?\n/);
    if (!sep || sep.index == null) return null;
    parts.push({ header: raw.slice(0, sep.index), body: raw.slice(sep.index + sep[0].length) });
  }
  if (!parts.length) return null;
  return { preamble: preamble!, boundary, parts };
}

function serializeMultipart(doc: MimeDoc): string {
  const marker = `--${doc.boundary}`;
  const blocks = doc.parts.map((p) => `${p.header}\n\n${p.body}`);
  return `${doc.preamble}\n${marker}\n${blocks.join(`\n${marker}\n`)}\n${marker}--\n`;
}

function partContentType(header: string): string {
  const m = header.match(/^content-type:\s*([^;\r\n]+)/im);
  return m ? m[1]!.trim().toLowerCase() : '';
}

/** Why a script can't be used for a VM, or null when it can. */
export function checkScript(content: string): string | null {
  if (content.includes('\0')) return 'The script contains a NUL character.';
  if (Math.ceil(Buffer.byteLength(content) / 3) * 4 > MAX_USER_DATA_BASE64)
    return 'The script is too large (OpenStack accepts about 48 KB).';
  if (isMultipart(content)) {
    const doc = parseMultipart(content);
    if (!doc) return 'This multipart user_data could not be parsed: check its MIME boundary.';
    const shellParts = doc.parts.filter((p) => partContentType(p.header) === 'text/x-shellscript');
    if (!shellParts.length) {
      return 'A multipart script needs a "text/x-shellscript" part.';
    }
    if (shellParts.some((p) => !p.body.startsWith('#!'))) {
      return 'Each "text/x-shellscript" part must start with a shebang line, e.g. "#!/bin/bash".';
    }
    const configParts = doc.parts.filter((p) => partContentType(p.header) === 'text/cloud-config');
    if (configParts.some((p) => !p.body.trimStart().startsWith('#cloud-config'))) {
      return 'Each "text/cloud-config" part must start with "#cloud-config".';
    }
    return null;
  }
  if (!content.startsWith('#!'))
    return 'The script must start with a shebang line, e.g. "#!/bin/bash".';
  return null;
}

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** A shell part: unchanged, except `export NAME=value` injected for each changed variable
 *  (one left at its default still reads it via its own `${NAME:-default}`, as today). */
function renderShellPart(content: string, changed: Record<string, string>): string {
  const lines = Object.entries(changed).map(
    ([name, value]) => `export ${name}=${shellQuote(value)}`,
  );
  if (!lines.length) return content;
  const nl = content.indexOf('\n');
  return nl === -1
    ? `${content}\n${lines.join('\n')}\n`
    : `${content.slice(0, nl + 1)}${lines.join('\n')}\n${content.slice(nl + 1)}`;
}

/** A cloud-config (or any non-shell) part: every `${NAME:-default}` replaced by its resolved
 *  value, literally — cloud-init's YAML never expands this syntax the way bash does. */
function renderLiteralPart(content: string, values: Record<string, string>): string {
  const commented: [number, number][] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('#')) commented.push([offset, offset + line.length]);
    offset += line.length + 1;
  }
  let out = '';
  let last = 0;
  for (const m of content.matchAll(OPENER)) {
    const at = m.index!;
    if (commented.some(([a, b]) => at >= a && at < b)) continue;
    const name = m[1]!;
    const start = at + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
    }
    if (depth !== 0) continue; // unterminated: left as written
    const def = content.slice(start, i - 1);
    out += content.slice(last, at) + (values[name] ?? def);
    last = i;
  }
  return out + content.slice(last);
}

export function renderScript(
  content: string,
  values: Record<string, string>,
): { script: string; changed: Record<string, string> } {
  const vars = new Map(parseVariables(content).map((v) => [v.name, v]));
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const v = vars.get(name);
    if (!v) throw new Error(`The script has no variable "${name}".`);
    if (typeof value !== 'string') throw new Error(`Variable "${name}" must be a string.`);
    if (value.includes('\0')) throw new Error(`Variable "${name}" contains a NUL character.`);
    if (value !== v.default) changed[name] = value;
  }

  const doc = isMultipart(content) ? parseMultipart(content) : null;
  if (doc) {
    const parts = doc.parts.map((p) => {
      if (partContentType(p.header) !== 'text/x-shellscript') {
        return { ...p, body: renderLiteralPart(p.body, values) };
      }
      // only export what this part actually declares: another part's variable would just be
      // noise in a script that never reads it.
      const here = new Set(parseVariables(p.body).map((v) => v.name));
      const changedHere = Object.fromEntries(Object.entries(changed).filter(([n]) => here.has(n)));
      return { ...p, body: renderShellPart(p.body, changedHere) };
    });
    return { script: serializeMultipart({ ...doc, parts }), changed };
  }

  return { script: renderShellPart(content, changed), changed };
}

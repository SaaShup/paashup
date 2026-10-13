// The adjustable variables of an init script, `${NAME:-default}`, as the form shows them while
// the script is being typed. Mirror of parseVariables in src/initscripts.ts (the server
// derives the stored list the same way on every save).

export interface ScriptVariable {
  name: string;
  default: string;
}

const OPENER = /\$\{([A-Za-z_][A-Za-z0-9_]*):-/g;

export function parseVariables(content: string): ScriptVariable[] {
  const found = new Map<string, ScriptVariable>();
  const commented: [number, number][] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
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
    if (depth !== 0) continue;
    found.set(name, { name, default: content.slice(start, i - 1) });
  }
  return [...found.values()];
}

/** The closing brace matching an already-open `${`, scanning from `from`; -1 if unbalanced. */
function closeOf(content: string, from: number): number {
  let depth = 1;
  for (let i = from; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Whether `value` can sit in a `${NAME:-value}` (its braces balance). */
export const isValidDefault = (value: string): boolean => closeOf(`${value}}`, 0) === value.length;

/** The script with the default of `name` replaced by `value`, wherever it is declared. */
export function setDefault(content: string, name: string, value: string): string {
  let out = '';
  let last = 0;
  const skip: [number, number][] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('#')) skip.push([offset, offset + line.length]);
    offset += line.length + 1;
  }
  for (const m of content.matchAll(OPENER)) {
    const at = m.index!;
    if (m[1] !== name || skip.some(([a, b]) => at >= a && at < b)) continue;
    const start = at + m[0].length;
    const end = closeOf(content, start);
    if (end < 0 || start < last) continue;
    out += content.slice(last, start) + value;
    last = end;
  }
  return out + content.slice(last);
}

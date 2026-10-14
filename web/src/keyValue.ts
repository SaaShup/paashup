// Key → value pairs as the metadata editor handles them: a list of rows being typed, turned
// into the object the API takes (and back).

export interface Pair {
  key: string;
  value: string;
}

export const toPairs = (obj: Record<string, unknown> | null | undefined): Pair[] =>
  Object.entries(obj ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') }));

/**
 * The rows as an object. Fully empty rows are ignored; a row with a value but no key, or a
 * key given twice, is an error (`error` says which) rather than silently dropped.
 */
export function fromPairs(pairs: readonly Pair[]): {
  value: Record<string, string>;
  error: string;
} {
  const value: Record<string, string> = {};
  for (const { key, value: v } of pairs) {
    const k = key.trim();
    if (!k) {
      if (v.trim()) return { value, error: `A value has no key ("${v.slice(0, 20)}").` };
      continue;
    }
    if (k in value) return { value, error: `The key "${k}" is given twice.` };
    value[k] = v;
  }
  return { value, error: '' };
}

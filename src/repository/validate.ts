import type { TableMeta } from '../model/meta-types.js';
import { ValidationError } from '../errors.js';

/** Field-keyed error messages, NetBox-style: { name: ["This field is required."] }. */
export type FieldErrors = Record<string, string[]>;

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
  const add = (field: string, msg: string) => (errors[field] ??= []).push(msg);
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

  if (Object.keys(errors).length) {
    throw new ValidationError('Validation failed', errors);
  }
}

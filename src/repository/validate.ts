import type { TableMeta } from '../model/meta-types.js';
import { ValidationError } from '../errors.js';
import { customFieldsFor } from '../customfields/registry.js';

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

  const cfErrors = validateCustomFields(meta.table, data.custom_fields, partial);
  if (cfErrors) errors.custom_fields = cfErrors;

  if (Object.keys(errors).length) {
    throw new ValidationError('Validation failed', errors);
  }
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

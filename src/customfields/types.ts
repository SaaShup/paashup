/** NetBox-style custom fields: extra, admin/plugin-defined fields attached to
 * existing object types and stored in each entity's `custom_fields` JSON column. */
export type CustomFieldType = 'text' | 'integer' | 'boolean' | 'select';

export interface CustomField {
  /** Entity table names this field applies to (e.g. ["dcim_device", "dcim_site"]). */
  readonly tables: readonly string[];
  /** Key under `custom_fields`. */
  readonly name: string;
  readonly type: CustomFieldType;
  readonly label?: string;
  readonly required?: boolean;
  /** Value used in API output when unset. */
  readonly default?: unknown;
  /** Allowed values for `type: 'select'`. */
  readonly choices?: readonly string[];
}

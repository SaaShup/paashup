import { api } from './client.js';

// Cached OpenAPI doc + helpers to drive forms from the schema.
let cached: Promise<Record<string, any>> | null = null;
export function getSchemaDoc(): Promise<Record<string, any>> {
  return (cached ??= api.schema() as unknown as Promise<Record<string, any>>);
}

export type FieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'fk'
  | 'json'
  | 'iplist';

export interface FieldDef {
  name: string;
  kind: FieldKind;
  required: boolean;
  nullable: boolean;
  maxLength?: number;
  choices?: (string | number)[];
  /** For `fk`: the target model name (e.g. "Manufacturer"). */
  targetModel?: string;
  /** Prefill an empty value with window.location.origin when creating (x-default-origin). */
  defaultOrigin?: boolean;
}

function refName(s: any): string | undefined {
  if (!s) return undefined;
  if (s.$ref) return String(s.$ref).split('/').pop();
  if (s.allOf?.[0]?.$ref) return String(s.allOf[0].$ref).split('/').pop();
  return undefined;
}

/** Build form field definitions for a model from its `<Model>Request` schema,
 *  using the read schema to recognise foreign keys (nested-brief refs). */
export async function formFields(model: string): Promise<FieldDef[]> {
  const doc = await getSchemaDoc();
  const req = doc.components.schemas[`${model}Request`];
  const read = doc.components.schemas[model];
  if (!req) return [];
  const required = new Set<string>(req.required ?? []);
  const out: FieldDef[] = [];
  for (const [name, raw] of Object.entries<any>(req.properties ?? {})) {
    if (raw['x-form-hidden']) continue; // writable via API but not a user input (e.g. agent-set ImageID)
    const p = raw.allOf ? { ...raw.allOf[0], nullable: raw.nullable } : raw;
    const briefRef = refName(read?.properties?.[name]);
    let kind: FieldKind = 'text';
    let choices: (string | number)[] | undefined;
    let targetModel: string | undefined;
    if (briefRef?.endsWith('Brief')) {
      kind = 'fk';
      targetModel = briefRef.slice(0, -'Brief'.length);
    } else if (p.enum) {
      kind = 'select';
      choices = p.enum;
    } else if (p.type === 'array' && p.items?.enum) {
      kind = 'multiselect'; // array whose items are a fixed choice list (e.g. object_types)
      choices = p.items.enum;
    } else if (p.type === 'boolean') kind = 'boolean';
    else if (p.type === 'integer' || p.type === 'number') kind = 'number';
    else if (name === 'dhcp_relays')
      kind = 'iplist'; // friendly one-IP-per-line editor
    else if (p.type === 'object' || p.type === 'array') kind = 'json';
    out.push({
      name,
      kind,
      required: required.has(name),
      nullable: !!p.nullable,
      maxLength: p.maxLength,
      choices,
      targetModel,
      defaultOrigin: !!raw['x-default-origin'],
    });
  }
  return out;
}

/** model name -> collection endpoint, from the `Paginated<Model>List` responses. */
export async function modelEndpoints(): Promise<Record<string, string>> {
  const doc = await getSchemaDoc();
  const map: Record<string, string> = {};
  for (const [path, ops] of Object.entries<any>(doc.paths)) {
    const ref = refName(ops.get?.responses?.['200']?.content?.['application/json']?.schema);
    if (ref?.startsWith('Paginated') && ref.endsWith('List')) {
      map[ref.slice('Paginated'.length, -'List'.length)] = path;
    }
  }
  return map;
}

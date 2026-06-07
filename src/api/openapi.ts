// Generate an OpenAPI 3.0 document from the runtime table registry (core + plugin
// entities), describing exactly what the API serves: NetBox-shaped reads (url,
// display, nested-brief FKs, {value,label} choices, relation arrays, computed
// fields) and write request bodies. Served at /api/schema/.
import type { ColumnMeta, TableMeta } from '../model/meta-types.js';
import { allTables } from '../model/registry.js';

type Schema = Record<string, unknown>;

const NETBOX_VERSION = '4.6.2';

const BRIEF_FIELDS = [
  'name',
  'slug',
  'description',
  'model',
  'rd',
  'prefix',
  'address',
  'vid',
  'asn',
  'ssid',
  'username',
  'label',
];

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
// OpenAPI 3.0: a $ref can't carry sibling keywords, so wrap nullable refs in allOf.
const nullable = (s: Schema, isNull: boolean): Schema => {
  if (!isNull) return s;
  if ('$ref' in s) return { allOf: [s], nullable: true };
  return { ...s, nullable: true };
};

/** OpenAPI type node for a scalar column. */
function scalarSchema(col: ColumnMeta): Schema {
  if (col.tsKind === 'boolean') return { type: 'boolean' };
  if (col.tsKind === 'json') return { type: 'object', additionalProperties: true };
  if (col.tsKind === 'number') {
    return col.references || col.name.endsWith('_id') ? { type: 'integer' } : { type: 'number' };
  }
  return { type: 'string', ...(col.maxLength ? { maxLength: col.maxLength } : {}) };
}

/** Choice value type from the enum's values (numeric vs string). */
function enumValueSchema(col: ColumnMeta): Schema {
  const numeric = (col.enum ?? []).every((v) => typeof v === 'number');
  return { type: numeric ? 'integer' : 'string', enum: [...(col.enum ?? [])] };
}

/** Read-side property for a column (what the serializer emits). */
function readProperty(col: ColumnMeta): Schema {
  if (col.references) return nullable(ref(`${col.references}Brief`), col.nullable);
  if (col.enum) {
    return nullable(
      {
        type: 'object',
        properties: { value: enumValueSchema(col), label: { type: 'string' } },
        required: ['value', 'label'],
      },
      col.nullable,
    );
  }
  return nullable(scalarSchema(col), col.nullable);
}

/** Write-side property for a column. */
function writeProperty(col: ColumnMeta): Schema {
  if (col.references) return nullable({ type: 'integer' }, col.nullable);
  if (col.enum) return nullable(enumValueSchema(col), col.nullable);
  return nullable(scalarSchema(col), col.nullable);
}

function genericGroups(meta: TableMeta): string[] {
  const set = new Set<string>();
  for (const c of meta.columns) if (c.genericRel) set.add(c.genericRel);
  return [...set];
}

function briefSchema(meta: TableMeta): Schema {
  const props: Schema = {
    id: { type: 'integer', readOnly: true },
    url: { type: 'string', format: 'uri', readOnly: true },
    display: { type: 'string', readOnly: true },
  };
  for (const c of meta.columns) {
    if (BRIEF_FIELDS.includes(c.name)) props[c.name] = nullable(scalarSchema(c), c.nullable);
  }
  return { type: 'object', properties: props, required: ['id', 'url', 'display'] };
}

function readSchema(meta: TableMeta): Schema {
  const props: Schema = {
    id: { type: 'integer', readOnly: true },
    url: { type: 'string', format: 'uri', readOnly: true },
    display: { type: 'string', readOnly: true },
    display_url: { type: 'string', format: 'uri', readOnly: true },
  };
  for (const c of meta.columns) props[c.name] = readProperty(c);
  // generic relation accessors (nested object, resolved by the serializer)
  for (const accessor of genericGroups(meta)) {
    props[accessor] = {
      type: 'object',
      additionalProperties: true,
      nullable: true,
      readOnly: true,
    };
  }
  // M2M / tags as arrays of briefs
  for (const rel of meta.relations) {
    props[rel.name] = { type: 'array', items: ref(`${rel.target}Brief`) };
  }
  // computed read-only fields
  const hasIp = meta.columns.some((c) => ['prefix', 'address', 'start_address'].includes(c.name));
  if (hasIp) {
    props.family = {
      type: 'object',
      properties: { value: { type: 'integer', enum: [4, 6] }, label: { type: 'string' } },
      readOnly: true,
    };
  }
  if (meta.columns.some((c) => c.name === 'parent' && c.references === meta.model)) {
    props.children = { type: 'integer', readOnly: true };
    props._depth = { type: 'integer', readOnly: true };
  }
  for (const c of meta.counts) props[c.name] = { type: 'integer', readOnly: true };
  return { type: 'object', properties: props, required: ['id', 'url', 'display'] };
}

function writeSchema(meta: TableMeta, patched: boolean): Schema {
  const props: Schema = {};
  const required: string[] = [];
  for (const c of meta.columns) {
    if (!c.writable) continue;
    props[c.name] = writeProperty(c);
    if (!patched && c.required && !c.nullable) required.push(c.name);
  }
  for (const rel of meta.relations) {
    props[rel.name] = {
      type: 'array',
      items: { oneOf: [{ type: 'integer' }, { type: 'object', additionalProperties: true }] },
    };
  }
  return { type: 'object', properties: props, ...(required.length ? { required } : {}) };
}

const listParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Page size.' },
  { name: 'offset', in: 'query', schema: { type: 'integer' }, description: 'Pagination offset.' },
  {
    name: 'ordering',
    in: 'query',
    schema: { type: 'string' },
    description: 'Comma-separated fields; prefix `-` for descending.',
  },
  { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Free-text search.' },
];

/** Build the full OpenAPI document for everything currently in the registry. */
export function buildOpenApi(): Schema {
  const schemas: Schema = {};
  const paths: Schema = {};

  for (const meta of allTables()) {
    const M = meta.model;
    schemas[`${M}Brief`] = briefSchema(meta);
    schemas[M] = readSchema(meta);
    schemas[`Paginated${M}List`] = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        next: { type: 'string', format: 'uri', nullable: true },
        previous: { type: 'string', format: 'uri', nullable: true },
        results: { type: 'array', items: ref(M) },
      },
      required: ['count', 'results'],
    };
    if (!meta.readOnly) {
      schemas[`${M}Request`] = writeSchema(meta, false);
      schemas[`Patched${M}Request`] = writeSchema(meta, true);
    }

    const tag = meta.section;
    const json = (s: Schema) => ({ content: { 'application/json': { schema: s } } });
    const list: Schema = {
      get: {
        operationId: `${meta.table}_list`,
        tags: [tag],
        parameters: listParams,
        responses: { 200: { description: '', ...json(ref(`Paginated${M}List`)) } },
      },
    };
    if (!meta.readOnly) {
      (list as Schema).post = {
        operationId: `${meta.table}_create`,
        tags: [tag],
        requestBody: { required: true, ...json(ref(`${M}Request`)) },
        responses: { 201: { description: '', ...json(ref(M)) } },
      };
    }
    paths[meta.endpoint] = list;

    const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }];
    const detail: Schema = {
      parameters: idParam,
      get: {
        operationId: `${meta.table}_retrieve`,
        tags: [tag],
        responses: { 200: { description: '', ...json(ref(M)) }, 404: { description: 'Not found' } },
      },
    };
    if (!meta.readOnly) {
      (detail as Schema).put = {
        operationId: `${meta.table}_update`,
        tags: [tag],
        requestBody: { required: true, ...json(ref(`${M}Request`)) },
        responses: { 200: { description: '', ...json(ref(M)) } },
      };
      (detail as Schema).patch = {
        operationId: `${meta.table}_partial_update`,
        tags: [tag],
        requestBody: { ...json(ref(`Patched${M}Request`)) },
        responses: { 200: { description: '', ...json(ref(M)) } },
      };
      (detail as Schema).delete = {
        operationId: `${meta.table}_destroy`,
        tags: [tag],
        responses: { 204: { description: 'No response body' } },
      };
    }
    paths[`${meta.endpoint}{id}/`] = detail;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'paas2box REST API',
      version: NETBOX_VERSION,
      description:
        'NetBox-compatible API (DCIM, IPAM, Virtualization) — generated from the live registry.',
    },
    paths,
    components: {
      schemas,
      securitySchemes: {
        tokenAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Token <key>',
        },
      },
    },
    security: [{ tokenAuth: [] }],
  };
}

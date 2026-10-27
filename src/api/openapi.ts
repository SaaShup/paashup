// Generate an OpenAPI 3.0 document from the runtime table registry (core + plugin
// entities), describing exactly what the API serves: NetBox-shaped reads (url,
// display, nested-brief FKs, {value,label} choices, relation arrays, computed
// fields) and write request bodies. Served at /api/schema/.
import type { ColumnMeta, TableMeta } from '../model/meta-types.js';
import { allTables } from '../model/registry.js';
import { NETBOX_VERSION } from '../version.js';

type Schema = Record<string, unknown>;

const BRIEF_FIELDS = [
  'name',
  'endpoint', // DockerHost — kept in sync with the serializer's brief fields
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

/**
 * Multi-select of object-type strings — an array whose items enumerate every
 * object type currently registered. Drives the webhook `object_types` picker.
 */
function objectTypeChoiceSchema(): Schema {
  const types = allTables()
    .map((m) => m.objectType)
    .sort();
  return { type: 'array', items: { type: 'string', enum: types } };
}

/** Multi-select over a fixed choice list (e.g. the webhook `events` field). */
function arrayEnumSchema(col: ColumnMeta): Schema {
  const values = col.arrayEnum ?? [];
  const numeric = values.every((v) => typeof v === 'number');
  return { type: 'array', items: { type: numeric ? 'integer' : 'string', enum: [...values] } };
}

/** Read-side property for a column (what the serializer emits). */
function readProperty(col: ColumnMeta): Schema {
  if (col.objectTypeChoices) return objectTypeChoiceSchema();
  if (col.arrayEnum) return arrayEnumSchema(col);
  if (col.references) return nullable(ref(`${col.references}Brief`), col.nullable);
  if (col.enum) {
    if (col.plainValue) return nullable(enumValueSchema(col), col.nullable);
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
  if (col.objectTypeChoices) return objectTypeChoiceSchema();
  if (col.arrayEnum) return arrayEnumSchema(col);
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
    // Vendor hints: `x-form-hidden` omits the field from the UI form (e.g. agent-set
    // ImageID); `x-default-origin` lets the form prefill it from window.location.origin.
    props[c.name] = {
      ...writeProperty(c),
      ...(c.formHidden ? { 'x-form-hidden': true } : {}),
      ...(c.defaultFromOrigin ? { 'x-default-origin': true } : {}),
    };
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

/**
 * Per-field filter query params for a list endpoint — what the repository's `buildWhere`
 * accepts: the pk, each scalar/enum column by name, and FK columns by `<field>_id` (the
 * related object's id). Enum columns advertise their choices. JSON columns aren't filterable.
 * Lookups are also supported by suffixing a field, e.g. `name__ic`, `host_id__in`,
 * `<field>__n` / `__gt` / `__gte` / `__lt` / `__lte` / `__empty` (not enumerated here).
 */
function filterParams(meta: TableMeta): Schema[] {
  const param = (name: string, schema: Schema, field: string): Schema => ({
    name,
    in: 'query',
    required: false,
    schema,
    description: `Filter by ${field}.`,
  });
  const out: Schema[] = [
    {
      name: 'id',
      in: 'query',
      required: false,
      schema: { type: 'integer' },
      description: 'Filter by primary key.',
    },
  ];
  for (const c of meta.columns) {
    if (c.tsKind === 'json') continue; // not simply filterable
    if (c.references)
      out.push(param(`${c.name}_id`, { type: 'integer' }, `${c.name} (related id)`));
    else if (c.enum) out.push(param(c.name, enumValueSchema(c), c.name));
    else out.push(param(c.name, scalarSchema(c), c.name));
  }
  return out;
}

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
        parameters: [...listParams, ...filterParams(meta)],
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

  // Non-CRUD routes that aren't derived from the entity registry (system/health, SSO
  // login, self-service API keys, Docker agent actions) — documented by hand.
  addCustomEndpoints(paths, schemas);

  return {
    openapi: '3.0.3',
    info: {
      title: 'paashup REST API',
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

/**
 * Hand-written path/schema definitions for the non-CRUD endpoints that aren't generated
 * from the registry: system/health, SSO login (public — `security: []`), self-service
 * API keys, and the Docker agent proxy actions. Mutates `paths`/`schemas` in place.
 */
function addCustomEndpoints(paths: Schema, schemas: Schema): void {
  const json = (s: Schema) => ({ content: { 'application/json': { schema: s } } });
  const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }];
  const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });

  Object.assign(schemas, {
    Status: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        version: { type: 'string' },
        'node-version': { type: 'string' },
        plugins: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['status', 'version'],
    },
    PluginList: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, version: { type: 'string' } },
            required: ['name', 'version'],
          },
        },
      },
      required: ['results'],
    },
    OidcConfig: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        issuer: str({ nullable: true }),
        client_id: str({ nullable: true }),
        audience: str({ nullable: true }),
        login_required: { type: 'boolean' },
      },
    },
    AuthProviders: {
      type: 'object',
      properties: {
        login_required: { type: 'boolean' },
        providers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              kind: { type: 'string' },
              issuer: { type: 'string' },
              client_id: { type: 'string' },
              scopes: { type: 'array', items: { type: 'string' } },
              authorization_endpoint: str({ nullable: true }),
            },
          },
        },
      },
    },
    OidcExchangeRequest: {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        code: { type: 'string' },
        code_verifier: { type: 'string' },
        redirect_uri: { type: 'string' },
      },
      required: ['provider', 'code', 'redirect_uri'],
    },
    OidcExchangeResult: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        token_id: { type: 'integer' },
        username: { type: 'string' },
        write_enabled: { type: 'boolean' },
        expires: str({ format: 'date-time', nullable: true }),
      },
    },
    APIToken: {
      type: 'object',
      description:
        'A static API token. On create the full `key` is returned once; every other read masks it (e.g. ••••a1b2, with `last4` kept).',
      properties: {
        id: { type: 'integer', readOnly: true },
        description: { type: 'string' },
        write_enabled: { type: 'boolean' },
        expires: str({ format: 'date-time', nullable: true }),
        created: str({ format: 'date-time', nullable: true, readOnly: true }),
        last_used: str({ format: 'date-time', nullable: true, readOnly: true }),
        key: str({ readOnly: true }),
        last4: str({ readOnly: true }),
      },
      required: ['id', 'key'],
    },
    APITokenRequest: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        expires: str({ format: 'date-time', nullable: true }),
        write_enabled: { type: 'boolean', default: true },
      },
    },
    PaginatedAPITokenList: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        next: str({ nullable: true }),
        previous: str({ nullable: true }),
        results: { type: 'array', items: ref('APIToken') },
      },
      required: ['count', 'results'],
    },
    AgentActionResult: {
      type: 'object',
      properties: { success: { type: 'boolean' }, payload: {} },
      required: ['success'],
    },
  });

  // ---- system / health (public) ----
  paths['/api/status/'] = {
    get: {
      tags: ['system'],
      operationId: 'status_retrieve',
      security: [],
      summary: 'Service status/health (public, no DB).',
      responses: { 200: { description: '', ...json(ref('Status')) } },
    },
  };
  paths['/api/plugins/'] = {
    get: {
      tags: ['system'],
      operationId: 'plugins_list',
      security: [],
      summary: 'Loaded plugins (name + version).',
      responses: { 200: { description: '', ...json(ref('PluginList')) } },
    },
  };
  paths['/api/schema/'] = {
    get: {
      tags: ['system'],
      operationId: 'schema_retrieve',
      security: [],
      summary: 'This OpenAPI 3.0 document.',
      responses: {
        200: { description: '', ...json({ type: 'object', additionalProperties: true }) },
      },
    },
  };

  // ---- SSO login (public) ----
  paths['/api/auth/oidc-config/'] = {
    get: {
      tags: ['auth'],
      operationId: 'auth_oidc_config',
      security: [],
      summary: 'OIDC config for the SPA (back-compat; prefer /api/auth/providers/).',
      responses: { 200: { description: '', ...json(ref('OidcConfig')) } },
    },
  };
  paths['/api/auth/providers/'] = {
    get: {
      tags: ['auth'],
      operationId: 'auth_providers',
      security: [],
      summary: 'Configured SSO providers for the login buttons.',
      responses: { 200: { description: '', ...json(ref('AuthProviders')) } },
    },
  };
  paths['/api/auth/oidc/exchange/'] = {
    post: {
      tags: ['auth'],
      operationId: 'auth_oidc_exchange',
      security: [],
      summary: 'Exchange an OIDC authorization code for a paashup token.',
      requestBody: { required: true, ...json(ref('OidcExchangeRequest')) },
      responses: {
        200: { description: '', ...json(ref('OidcExchangeResult')) },
        400: { description: 'provider, code and redirect_uri are required' },
      },
    },
  };

  // ---- self-service API keys (auth required) ----
  paths['/api/users/tokens/'] = {
    get: {
      tags: ['users'],
      operationId: 'tokens_list',
      summary: "List the caller's API keys (key masked).",
      responses: {
        200: { description: '', ...json(ref('PaginatedAPITokenList')) },
        403: { description: 'Authentication required' },
      },
    },
    post: {
      tags: ['users'],
      operationId: 'tokens_create',
      summary: 'Create an API key — the full `key` is returned once.',
      requestBody: { ...json(ref('APITokenRequest')) },
      responses: {
        201: { description: '', ...json(ref('APIToken')) },
        403: { description: 'Authentication required, or token is read-only' },
      },
    },
  };
  paths['/api/users/tokens/{id}/'] = {
    parameters: idParam,
    delete: {
      tags: ['users'],
      operationId: 'tokens_destroy',
      summary: 'Revoke one of your API keys.',
      responses: { 204: { description: 'No response body' }, 404: { description: 'Not found' } },
    },
  };

  // ---- Docker agent proxy actions (only when the docker plugin is loaded) ----
  const host = schemas['DockerHost'] as { properties?: Record<string, Schema> } | undefined;
  if (!host) return; // docker not registered → skip its custom routes
  paths['/api/plugins/docker/images/{id}/force_pull/'] = {
    parameters: idParam,
    post: {
      tags: ['plugins'],
      operationId: 'docker_image_force_pull',
      summary: "Ask the host's agent to (re)pull the image.",
      responses: {
        200: { description: '', ...json(ref('AgentActionResult')) },
        404: { description: 'Not found' },
        502: { description: 'Agent error' },
      },
    },
  };
  paths['/api/plugins/docker/containers/{id}/logs/'] = {
    parameters: idParam,
    get: {
      tags: ['plugins'],
      operationId: 'docker_container_logs',
      summary: "Fetch the container's logs from the agent.",
      responses: {
        200: { description: '', ...json({ type: 'string' }) },
        404: { description: 'Not found' },
        502: { description: 'Agent error' },
      },
    },
  };
  paths['/api/plugins/docker/containers/{id}/exec/'] = {
    parameters: idParam,
    post: {
      tags: ['plugins'],
      operationId: 'docker_container_exec',
      summary: 'Exec a command in the container via the agent.',
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          properties: { cmd: { type: 'array', items: { type: 'string' } } },
          required: ['cmd'],
        }),
      },
      responses: {
        200: { description: '', ...json({ type: 'object', additionalProperties: true }) },
        404: { description: 'Not found' },
        502: { description: 'Agent error' },
      },
    },
  };

  // The Docker host create response carries a one-time agent token (see routes/hosts.ts).
  if (host.properties && !host.properties.token) {
    host.properties.token = {
      type: 'object',
      nullable: true,
      readOnly: true,
      description:
        'Static API token minted for the host agent — present only in the create response, never on reads.',
      properties: { key: { type: 'string' } },
    };
  }
}

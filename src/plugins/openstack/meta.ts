// Table metadata for the OpenStack plugin. One entity is registered (→ automatic
// NetBox-shaped CRUD): Cloud, one set of Keystone credentials for an OpenStack project.
import type { ColumnMeta, TableMeta } from '../../model/meta-types.js';

export const T = {
  cloud: 'plugin_openstack_cloud',
  server: 'plugin_openstack_server',
  region: 'plugin_openstack_region',
  volume: 'plugin_openstack_volume',
} as const;

const TAGS = { name: 'tags', kind: 'tags', target: 'Tag', targetTable: 'extras_tag' } as const;

/** custom_fields / created / last_updated, shared by every NetBoxModel-derived entity. */
const NETBOX_COLS: ColumnMeta[] = [
  {
    name: 'custom_fields',
    column: 'custom_fields',
    tsKind: 'json',
    nullable: false,
    writable: true,
    required: false,
  },
  {
    name: 'created',
    column: 'created',
    tsKind: 'string',
    nullable: true,
    writable: false,
    required: false,
  },
  {
    name: 'last_updated',
    column: 'last_updated',
    tsKind: 'string',
    nullable: true,
    writable: false,
    required: false,
  },
];

const CLOUD_STATE = {
  enum: ['created', 'refreshing', 'connected', 'error'],
  enumLabels: {
    created: 'Created',
    refreshing: 'Refreshing',
    connected: 'Connected',
    error: 'Error',
  },
} as const;
const CLOUD_OPERATION = {
  enum: ['none', 'refresh'],
  enumLabels: { none: 'None', refresh: 'Refresh' },
} as const;

const str = (
  name: string,
  required: boolean,
  maxLength: number,
  extra: Partial<ColumnMeta> = {},
): ColumnMeta => ({
  name,
  column: name,
  tsKind: 'string',
  nullable: !required,
  writable: true,
  required,
  maxLength,
  ...extra,
});

const cloudMeta: TableMeta = {
  model: 'OpenStackCloud',
  table: T.cloud,
  section: 'plugins',
  endpoint: '/api/plugins/openstack/clouds/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.openstackcloud',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    str('name', true, 255),
    str('auth_url', true, 1024),
    str('username', true, 255),
    str('password', true, 255),
    { ...str('user_domain_name', false, 255), nullable: false },
    // Optional: empty means the user's default project (filled in once discovered).
    { ...str('project_name', false, 255), nullable: false },
    { ...str('project_domain_name', false, 255), nullable: false },
    {
      name: 'state',
      column: 'state',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...CLOUD_STATE,
    },
    str('error', false, 4096),
    {
      name: 'operation',
      column: 'operation',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...CLOUD_OPERATION,
    },
    {
      name: 'last_synced',
      column: 'last_synced',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
    ...NETBOX_COLS,
  ],
};

export const ENTITY_METAS: TableMeta[] = [cloudMeta];
export const META = { cloud: cloudMeta } as const;

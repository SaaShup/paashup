// Table metadata for the Cloudflare plugin, ported from
// SaaShup/netbox-cloudflare-plugin (netbox_cloudflare_plugin/models.py).
//
// Two entities are registered (→ automatic NetBox-shaped CRUD):
//   ZoneAccount  — a Cloudflare DNS zone + API token
//   DnsRecord    — an A/CNAME record in a zone (synced to Cloudflare on write)
// Models are namespaced `Cloudflare*` and object types `plugins.cloudflare<model>`
// to stay collision-free in the shared registry.
import type { ColumnMeta, TableMeta } from '../../model/meta-types.js';

export const T = {
  zoneAccount: 'plugin_cloudflare_zoneaccount',
  dnsRecord: 'plugin_cloudflare_dnsrecord',
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

const RECORD_TYPE = { enum: ['CNAME', 'A'], enumLabels: { CNAME: 'CNAME', A: 'A' } } as const;

const zoneAccountMeta: TableMeta = {
  model: 'CloudflareZoneAccount',
  table: T.zoneAccount,
  section: 'plugins',
  endpoint: '/api/plugins/cloudflare/dns/accounts/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.cloudflarezoneaccount',
  readOnly: false,
  relations: [TAGS],
  counts: [{ name: 'record_count', table: T.dnsRecord, column: 'zone_id' }],
  columns: [
    {
      name: 'zone_name',
      column: 'zone_name',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 255,
    },
    {
      name: 'zone_id',
      column: 'zone_id',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 255,
    },
    {
      name: 'token',
      column: 'token',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 255,
    },
    ...NETBOX_COLS,
  ],
};

const dnsRecordMeta: TableMeta = {
  model: 'CloudflareDnsRecord',
  table: T.dnsRecord,
  section: 'plugins',
  endpoint: '/api/plugins/cloudflare/dns/records/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.cloudflarednsrecord',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'zone',
      column: 'zone_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'CloudflareZoneAccount',
    },
    {
      name: 'record_id',
      column: 'record_id',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 32,
    },
    {
      name: 'name',
      column: 'name',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 255,
    },
    {
      name: 'type',
      column: 'type',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...RECORD_TYPE,
    },
    {
      name: 'content',
      column: 'content',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 255,
    },
    {
      name: 'ttl',
      column: 'ttl',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'proxied',
      column: 'proxied',
      tsKind: 'boolean',
      nullable: false,
      writable: true,
      required: false,
    },
    ...NETBOX_COLS,
  ],
};

export const ENTITY_METAS: TableMeta[] = [zoneAccountMeta, dnsRecordMeta];
export const META = { zoneAccount: zoneAccountMeta, dnsRecord: dnsRecordMeta } as const;

// Table metadata for the Docker plugin entities, ported from
// SaaShup/netbox-docker-plugin (netbox_docker_plugin/models/*.py).
//
// Six top-level entities are registered with paasbox (→ automatic NetBox-shaped
// CRUD). The nine container child tables are NOT registered (the source exposes them
// only nested under a container); their shape lives in `CHILD_TABLES` and is handled
// by the container custom routes. Model names are namespaced `Docker*` and object
// types `plugins.docker<model>` to stay collision-free in the shared registry
// (core DCIM already has a `Device` model, for instance).
import type { ColumnMeta, TableMeta } from '../../model/meta-types.js';

/** Physical table names (all prefixed `plugin_docker_`). */
export const T = {
  host: 'plugin_docker_host',
  registry: 'plugin_docker_registry',
  image: 'plugin_docker_image',
  volume: 'plugin_docker_volume',
  network: 'plugin_docker_network',
  container: 'plugin_docker_container',
  port: 'plugin_docker_port',
  label: 'plugin_docker_label',
  env: 'plugin_docker_env',
  logDriverOption: 'plugin_docker_log_driver_option',
  mount: 'plugin_docker_mount',
  bind: 'plugin_docker_bind',
  networkSetting: 'plugin_docker_network_setting',
  device: 'plugin_docker_device',
  sysctl: 'plugin_docker_sysctl',
  vmSshKey: 'plugin_docker_vm_ssh_key',
} as const;

const TAGS = { name: 'tags', kind: 'tags', target: 'Tag', targetTable: 'extras_tag' } as const;

/** created / last_updated / custom_fields, shared by every NetBoxModel-derived entity. */
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

const HOST_STATE = {
  enum: ['created', 'deleted', 'running', 'error', 'refreshing'],
  enumLabels: {
    created: 'Created',
    deleted: 'Deleted',
    running: 'Running',
    error: 'Error',
    refreshing: 'Refreshing',
  },
} as const;
const HOST_OPERATION = {
  enum: ['refresh', 'none'],
  enumLabels: { refresh: 'Refresh', none: 'None' },
} as const;
const CONTAINER_STATE = {
  enum: ['created', 'restarting', 'running', 'paused', 'exited', 'dead', 'none'],
  enumLabels: {
    created: 'Created',
    restarting: 'Restarting',
    running: 'Running',
    paused: 'Paused',
    exited: 'Exited',
    dead: 'Dead',
    none: 'None',
  },
} as const;
const CONTAINER_OPERATION = {
  enum: ['create', 'start', 'restart', 'stop', 'pause', 'unpause', 'recreate', 'kill', 'none'],
  enumLabels: {
    create: 'Create',
    start: 'Start',
    restart: 'Restart',
    stop: 'Stop',
    pause: 'Pause',
    unpause: 'Unpause',
    recreate: 'Recreate',
    kill: 'Kill',
    none: 'None',
  },
} as const;
const RESTART_POLICY = {
  enum: ['no', 'on-failure', 'always', 'unless-stopped'],
  enumLabels: {
    no: 'no',
    'on-failure': 'on-failure',
    always: 'always',
    'unless-stopped': 'unless-stopped',
  },
} as const;
const NETWORK_DRIVER = {
  enum: ['bridge', 'host', 'none'],
  enumLabels: { bridge: 'Bridge', host: 'Host', none: 'None' },
} as const;
const NETWORK_STATE = {
  enum: ['creating', 'created'],
  enumLabels: { creating: 'Creating', created: 'Created' },
} as const;
const VOLUME_DRIVER = { enum: ['local'], enumLabels: { local: 'local' } } as const;

const hostMeta: TableMeta = {
  model: 'DockerHost',
  table: T.host,
  section: 'plugins',
  endpoint: '/api/plugins/docker/hosts/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockerhost',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'endpoint',
      column: 'endpoint',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 1024,
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
      name: 'state',
      column: 'state',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...HOST_STATE,
      plainValue: true, // the Docker agent consumes state as a bare string
    },
    {
      name: 'netbox_base_url',
      column: 'netbox_base_url',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 1024,
      defaultFromOrigin: true, // default to the request origin when omitted (issue #33)
    },
    {
      name: 'agent_version',
      column: 'agent_version',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 32,
    },
    {
      name: 'docker_api_version',
      column: 'docker_api_version',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 32,
    },
    {
      name: 'operation',
      column: 'operation',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...HOST_OPERATION,
      plainValue: true, // the Docker agent consumes operation as a bare string
    },
    // The machine this docker engine runs on — a core Device or VirtualMachine
    // (mutually exclusive). FK briefs resolve via the shared model registry.
    {
      name: 'device',
      column: 'device_id',
      tsKind: 'string', // dcim_device has a UUID string PK
      nullable: true,
      writable: true,
      required: false,
      references: 'Device',
    },
    {
      name: 'virtual_machine',
      column: 'virtual_machine_id',
      tsKind: 'number',
      nullable: true,
      writable: true,
      required: false,
      references: 'VirtualMachine',
    },
    ...NETBOX_COLS,
  ],
};

const registryMeta: TableMeta = {
  model: 'DockerRegistry',
  table: T.registry,
  section: 'plugins',
  endpoint: '/api/plugins/docker/registries/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockerregistry',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'host',
      column: 'host_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerHost',
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
      name: 'serveraddress',
      column: 'serveraddress',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 200,
    },
    {
      name: 'username',
      column: 'username',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 2048,
    },
    {
      name: 'password',
      column: 'password',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 512,
    },
    {
      name: 'email',
      column: 'email',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 512,
    },
    ...NETBOX_COLS,
  ],
};

const imageMeta: TableMeta = {
  model: 'DockerImage',
  table: T.image,
  section: 'plugins',
  endpoint: '/api/plugins/docker/images/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockerimage',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'host',
      column: 'host_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerHost',
    },
    {
      name: 'registry',
      column: 'registry_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerRegistry',
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
      name: 'version',
      column: 'version',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      maxLength: 256,
    },
    {
      name: 'size',
      column: 'size',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'ImageID',
      column: 'image_id',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 128,
      formHidden: true, // set by the Docker agent, not entered by users
    },
    {
      name: 'Digest',
      column: 'digest',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 512,
    },
    ...NETBOX_COLS,
  ],
};

const volumeMeta: TableMeta = {
  model: 'DockerVolume',
  table: T.volume,
  section: 'plugins',
  endpoint: '/api/plugins/docker/volumes/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockervolume',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'host',
      column: 'host_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerHost',
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
      name: 'max_size',
      column: 'max_size',
      tsKind: 'number',
      nullable: true,
      writable: true,
      required: false,
    },
    {
      name: 'driver',
      column: 'driver',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...VOLUME_DRIVER,
      plainValue: true, // the Docker agent consumes driver as a bare string
    },
    ...NETBOX_COLS,
  ],
};

const networkMeta: TableMeta = {
  model: 'DockerNetwork',
  table: T.network,
  section: 'plugins',
  endpoint: '/api/plugins/docker/networks/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockernetwork',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'host',
      column: 'host_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerHost',
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
      name: 'driver',
      column: 'driver',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      ...NETWORK_DRIVER,
    },
    {
      name: 'NetworkID',
      column: 'network_id',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 128,
    },
    {
      name: 'state',
      column: 'state',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...NETWORK_STATE,
      plainValue: true, // the Docker agent consumes state as a bare string
    },
    ...NETBOX_COLS,
  ],
};

const containerMeta: TableMeta = {
  model: 'DockerContainer',
  table: T.container,
  section: 'plugins',
  endpoint: '/api/plugins/docker/containers/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockercontainer',
  readOnly: false,
  relations: [TAGS],
  counts: [],
  columns: [
    {
      name: 'host',
      column: 'host_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerHost',
    },
    {
      name: 'image',
      column: 'image_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'DockerImage',
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
      name: 'state',
      column: 'state',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...CONTAINER_STATE,
      plainValue: true, // the Docker agent consumes state as a bare string
    },
    {
      name: 'status',
      column: 'status',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 1024,
    },
    {
      name: 'ContainerID',
      column: 'container_id',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 128,
    },
    {
      name: 'operation',
      column: 'operation',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...CONTAINER_OPERATION,
      plainValue: true, // the Docker agent consumes operation as a bare string
    },
    {
      name: 'hostname',
      column: 'hostname',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 256,
    },
    {
      name: 'restart_policy',
      column: 'restart_policy',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      ...RESTART_POLICY,
      plainValue: true, // the Docker agent consumes restart_policy as a bare string
    },
    {
      name: 'cap_add',
      column: 'cap_add',
      tsKind: 'json',
      nullable: true,
      writable: true,
      required: false,
    },
    {
      name: 'cap_drop',
      column: 'cap_drop',
      tsKind: 'json',
      nullable: true,
      writable: true,
      required: false,
    },
    {
      name: 'log_driver',
      column: 'log_driver',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 32,
    },
    {
      name: 'secOpt',
      column: 'sec_opt',
      tsKind: 'json',
      nullable: true,
      writable: true,
      required: false,
    },
    {
      name: 'pid_mode',
      column: 'pid_mode',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      enum: ['host'],
      enumLabels: { host: 'host' },
    },
    {
      name: 'extra_hosts',
      column: 'extra_hosts',
      tsKind: 'json',
      nullable: true,
      writable: true,
      required: false,
    },
    { name: 'cmd', column: 'cmd', tsKind: 'json', nullable: true, writable: true, required: false },
    ...NETBOX_COLS,
  ],
};

const ro = (name: string, maxLength?: number): ColumnMeta => ({
  name,
  column: name,
  tsKind: 'string',
  nullable: true,
  writable: false,
  required: false,
  ...(maxLength ? { maxLength } : {}),
});

/**
 * A public key of the authorized_keys file the agent of a VM manages, as last read from
 * the agent. Created and deleted through the agent (see sshkeys.ts), never edited: POST
 * takes a catalog `ssh_key` or a pasted `public_key`, the rest comes from the agent.
 */
const vmSshKeyMeta: TableMeta = {
  model: 'DockerVmSshKey',
  table: T.vmSshKey,
  section: 'plugins',
  endpoint: '/api/plugins/docker/vm-ssh-keys/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.dockervmsshkey',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    {
      name: 'virtual_machine',
      column: 'virtual_machine_id',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: true,
      references: 'VirtualMachine',
    },
    {
      name: 'ssh_key',
      column: 'ssh_key_id',
      tsKind: 'number',
      nullable: true,
      writable: true,
      required: false,
      references: 'SshKey',
    },
    {
      name: 'public_key',
      column: 'public_key',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
    },
    ro('name', 255),
    ro('account', 255),
    ro('key_type', 64),
    ro('fingerprint', 128),
    ro('comment', 1024),
    ro('options'),
    ...NETBOX_COLS,
  ],
};

/** The entities paasbox registers (auto-CRUD + schema + FK-brief resolution). */
export const ENTITY_METAS: TableMeta[] = [
  hostMeta,
  registryMeta,
  imageMeta,
  volumeMeta,
  networkMeta,
  containerMeta,
  vmSshKeyMeta,
];

/** Convenience map for the routes/serializer. */
export const META = {
  host: hostMeta,
  registry: registryMeta,
  image: imageMeta,
  volume: volumeMeta,
  network: networkMeta,
  container: containerMeta,
  vmSshKey: vmSshKeyMeta,
} as const;

/**
 * Brief field projections — exactly the field sets the source Nested*Serializers
 * expose. Applied on top of a full engine-serialized object so nested briefs match
 * how the same entity renders at its own endpoint (enums as {value,label}, etc.).
 */
export const BRIEF_FIELDS: Record<string, string[]> = {
  [T.host]: [
    'id',
    'url',
    'display',
    'endpoint',
    'name',
    'state',
    'agent_version',
    'docker_api_version',
    'operation',
    'device',
    'virtual_machine',
  ],
  [T.image]: ['id', 'url', 'display', 'name', 'version', 'size', 'ImageID', 'Digest'],
  [T.volume]: ['id', 'url', 'display', 'name', 'max_size', 'driver'],
  [T.network]: ['id', 'url', 'display', 'name', 'driver', 'NetworkID', 'state'],
  [T.container]: [
    'id',
    'url',
    'display',
    'name',
    'ContainerID',
    'state',
    'status',
    'restart_policy',
    'operation',
    'hostname',
    'cap_add',
    'cap_drop',
    'log_driver',
    'secOpt',
    'pid_mode',
    'extra_hosts',
    'cmd',
  ],
  [T.registry]: ['id', 'name', 'url', 'display', 'serveraddress', 'username', 'password', 'email'],
};

/** A scalar column of a (non-registered) container child table. */
export interface ChildColumn {
  /** API field name (== column name for children). */
  readonly name: string;
  readonly column: string;
  readonly kind: 'string' | 'number' | 'boolean';
  /** Required on write (no DB default). */
  readonly required?: boolean;
  /** FK to a top-level table, rendered as a nested brief on read. */
  readonly fk?: { readonly table: string };
}

/**
 * Specs for the nine container child tables. Each child belongs to a container via
 * `container_id` and is exposed only nested under the container (no own endpoint).
 * `serialFields` is the exact field set the source child serializer returns.
 */
export interface ChildSpec {
  /** Logical key in the container body (e.g. "ports"). */
  readonly field: string;
  readonly table: string;
  readonly columns: readonly ChildColumn[];
  /** Field names returned when serializing a child row (in order). */
  readonly serialFields: readonly string[];
}

export const CHILD_SPECS: readonly ChildSpec[] = [
  {
    field: 'ports',
    table: T.port,
    columns: [
      { name: 'private_port', column: 'private_port', kind: 'number', required: true },
      { name: 'public_port', column: 'public_port', kind: 'number', required: true },
      { name: 'type', column: 'type', kind: 'string' },
    ],
    serialFields: ['public_port', 'private_port', 'type'],
  },
  {
    field: 'env',
    table: T.env,
    columns: [
      { name: 'var_name', column: 'var_name', kind: 'string', required: true },
      { name: 'value', column: 'value', kind: 'string' },
    ],
    serialFields: ['var_name', 'value'],
  },
  {
    field: 'labels',
    table: T.label,
    columns: [
      { name: 'key', column: 'key', kind: 'string', required: true },
      { name: 'value', column: 'value', kind: 'string' },
    ],
    serialFields: ['key', 'value'],
  },
  {
    field: 'log_driver_options',
    table: T.logDriverOption,
    columns: [
      { name: 'option_name', column: 'option_name', kind: 'string', required: true },
      { name: 'value', column: 'value', kind: 'string' },
    ],
    serialFields: ['option_name', 'value'],
  },
  {
    field: 'mounts',
    table: T.mount,
    columns: [
      { name: 'source', column: 'source', kind: 'string', required: true },
      {
        name: 'volume',
        column: 'volume_id',
        kind: 'number',
        required: true,
        fk: { table: T.volume },
      },
      { name: 'read_only', column: 'read_only', kind: 'boolean' },
    ],
    serialFields: ['source', 'volume', 'read_only'],
  },
  {
    field: 'binds',
    table: T.bind,
    columns: [
      { name: 'host_path', column: 'host_path', kind: 'string', required: true },
      { name: 'container_path', column: 'container_path', kind: 'string', required: true },
      { name: 'read_only', column: 'read_only', kind: 'boolean' },
    ],
    serialFields: ['host_path', 'container_path', 'read_only'],
  },
  {
    field: 'network_settings',
    table: T.networkSetting,
    columns: [
      {
        name: 'network',
        column: 'network_id',
        kind: 'number',
        required: true,
        fk: { table: T.network },
      },
    ],
    serialFields: ['network'],
  },
  {
    field: 'devices',
    table: T.device,
    columns: [
      { name: 'host_path', column: 'host_path', kind: 'string', required: true },
      { name: 'container_path', column: 'container_path', kind: 'string', required: true },
    ],
    serialFields: ['host_path', 'container_path'],
  },
  {
    field: 'sysctls',
    table: T.sysctl,
    columns: [
      { name: 'key', column: 'key', kind: 'string', required: true },
      { name: 'value', column: 'value', kind: 'string' },
    ],
    serialFields: ['key', 'value'],
  },
];

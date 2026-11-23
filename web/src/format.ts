// Units of the numeric fields, so a bare 7168 reads as "7 GB" in lists and details, and a
// form says what to type. Keyed by table, then by field name.
type Unit = 'MB' | 'GB' | 'vCPU' | 'B' | 'MiB';

const UNITS: Record<string, Record<string, Unit>> = {
  virtualization_virtual_machine: { memory: 'MB', disk: 'GB', vcpus: 'vCPU' },
  virtualization_virtual_machine_type: { default_memory: 'MB', default_vcpus: 'vCPU' },
  virtualization_virtual_disk: { size: 'GB' },
  // Docker container resource limits (agent 2.1.0+): memory_limit is in bytes, cpu_limit
  // in CPU cores; 0 means unlimited (see UNLIMITED_ZERO below), not a literal zero quantity.
  plugin_docker_container: { memory_limit: 'B', cpu_limit: 'vCPU' },
  // max_size is in MiB (binary), unlike the decimal MB/GB used elsewhere; 0 means unlimited.
  plugin_docker_volume: { max_size: 'MiB' },
};

/** Fields where 0 means "no limit" rather than a literal zero quantity. */
const UNLIMITED_ZERO = new Set([
  'plugin_docker_container.memory_limit',
  'plugin_docker_container.cpu_limit',
  'plugin_docker_volume.max_size',
]);

/** Bytes as the largest unit that keeps the number readable: "512 MB", "1.5 GB". */
function bytesToHuman(n: number): string {
  const steps = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < steps.length - 1) {
    n /= 1024;
    i++;
  }
  return `${tidy(n)} ${steps[i]}`;
}

/** Field names shown differently: a VM's `disk` is its root disk, the other disks are volumes. */
const LABELS: Record<string, Record<string, string>> = {
  virtualization_virtual_machine: { disk: 'root disk' },
  // it's paashup's own public URL (used by the agent to reach back), not NetBox's
  plugin_docker_host: { netbox_base_url: 'paashup URL' },
  plugin_docker_image: { used_by: 'Used by' },
  plugin_docker_volume: { used_by: 'Used by' },
  plugin_docker_network: { used_by: 'Used by' },
  extras_journalentry: {
    assigned_object_type: 'source',
    assigned_object: 'object',
    kind: 'severity',
    comments: 'details',
    created: 'timestamp',
  },
};

/** Raw stored values shown with a friendlier label: table -> field -> value -> label. */
const VALUE_LABELS: Record<string, Record<string, Record<string, string>>> = {
  extras_journalentry: {
    assigned_object_type: {
      'virtualization.virtualmachine': 'Virtual Machine',
      'plugins.openstackcloud': 'OpenStack Cloud',
      'plugins.dockerhost': 'Docker Host',
      'plugins.dockercontainer': 'Docker Container',
      'plugins.dockerimage': 'Docker Image',
      'plugins.dockervolume': 'Docker Volume',
      'plugins.dockernetwork': 'Docker Network',
      'plugins.dockerregistry': 'Docker Registry',
      'plugins.dockervmsshkey': 'Docker VM SSH Key',
    },
  },
};

/** A friendlier label for a raw stored value (e.g. a journal entry's object type), if one
 *  is known; null when the raw value should be shown as is. */
export function valueLabel(
  table: string | undefined,
  field: string,
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  return (table && VALUE_LABELS[table]?.[field]?.[value]) ?? null;
}

const tidy = (n: number): string => String(Math.round(n * 10) / 10);

/** "7 GB", "512 MB", "2 vCPU", "50 GB" — or null when the field has no unit or no value. */
export function formatUnit(
  table: string | undefined,
  field: string,
  value: unknown,
): string | null {
  const unit = table ? UNITS[table]?.[field] : undefined;
  if (!unit || value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0 && table && UNLIMITED_ZERO.has(`${table}.${field}`)) return 'Unlimited';
  if (unit === 'B') return bytesToHuman(n);
  if (unit === 'MB') return n >= 1024 ? `${tidy(n / 1024)} GB` : `${tidy(n)} MB`;
  if (unit === 'MiB') return n >= 1024 ? `${tidy(n / 1024)} GiB` : `${tidy(n)} MiB`;
  return `${tidy(n)} ${unit}`;
}

/** The label of a field in a detail page. */
export const fieldLabel = (table: string | undefined, field: string): string =>
  (table && LABELS[table]?.[field]) || field.replace(/_/g, ' ');

/** Spelled-out unit names for the form-label suffix (abbreviations read as raw unit values). */
const UNIT_LABELS: Partial<Record<Unit, string>> = { B: 'Bytes' };

/** The label of a form field, with the unit to type the value in: "memory (MB)". */
export function formLabel(table: string | undefined, field: string): string {
  const unit = table ? UNITS[table]?.[field] : undefined;
  const label = (table && LABELS[table]?.[field]) || field;
  return unit && unit !== 'vCPU' ? `${label} (${UNIT_LABELS[unit] ?? unit})` : label;
}

/** The header of a list column: the field name, or its special label (`disk` → "root disk"). */
export const columnLabel = (table: string | undefined, field: string): string =>
  (table && LABELS[table]?.[field]) || field;

/** An FK row's label: its display string, with a `:version` suffix when it has one (e.g. a
 *  Docker image reads "nginx:alpine", not just "nginx") — used by both the FK picker in a
 *  create/edit form and a column's header filter dropdown, so the two stay consistent and
 *  same-named rows (different image versions, say) are told apart in either place. */
export function fkOptionLabel(o: { id?: unknown; display?: unknown; version?: unknown }): string {
  const d = String(o.display ?? o.id);
  return o.version ? `${d}:${o.version}` : d;
}

/** A choice field as the API serializes it: `{ value, label }`. */
export function choiceOf(value: unknown): { value: string; label: string } | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { value?: unknown; label?: unknown };
  return typeof o.value === 'string' && typeof o.label === 'string'
    ? { value: o.value, label: o.label }
    : null;
}

export type StatusTone = 'ok' | 'danger' | 'warn' | 'info' | 'muted';

export interface Pill {
  label: string;
  tone: StatusTone;
  /** something is still going on (being built, restarting…): the pill shows a spinner */
  busy: boolean;
}

const OK = { tone: 'ok', busy: false } as const;
const DANGER = { tone: 'danger', busy: false } as const;
const INFO = { tone: 'info', busy: false } as const;
const MUTED = { tone: 'muted', busy: false } as const;
const BUSY = { tone: 'warn', busy: true } as const;
const WARN = { tone: 'warn', busy: false } as const;

/** Status fields drawn as a coloured pill: table → field → value → look. */
const PILLS: Record<string, Record<string, Record<string, Omit<Pill, 'label'>>>> = {
  extras_journalentry: {
    kind: { info: INFO, success: OK, warning: WARN, danger: DANGER },
  },
  virtualization_virtual_machine: {
    status: {
      active: OK,
      failed: DANGER,
      planned: BUSY,
      decommissioning: BUSY,
      staged: INFO,
      inventory: INFO,
    },
  },
  plugin_docker_container: {
    state: {
      running: OK,
      restarting: BUSY,
      paused: INFO,
      created: INFO,
      exited: MUTED,
      dead: DANGER,
      none: MUTED,
    },
  },
  plugin_docker_host: {
    state: { running: OK, refreshing: BUSY, created: INFO, error: DANGER, deleted: MUTED },
  },
  plugin_docker_network: {
    state: { creating: BUSY, created: OK },
  },
};

/**
 * The pill of a status field, or null when this field is not drawn as one. The value is a
 * serialized choice (`{ value, label }`) or a bare string (the Docker states); a value with
 * no look of its own is grey.
 */
export function pillFor(table: string | undefined, field: string, value: unknown): Pill | null {
  const looks = table ? PILLS[table]?.[field] : undefined;
  if (!looks) return null;
  const choice = choiceOf(value);
  const raw = choice?.value ?? (typeof value === 'string' ? value : '');
  if (!raw) return null;
  const label = choice?.label ?? raw.charAt(0).toUpperCase() + raw.slice(1);
  return { label, ...(looks[raw] ?? MUTED) };
}

/** Tables whose whole row is tinted by one of its fields (currently: a journal entry's
 *  `kind`), rather than just showing a pill in that one column. */
const ROW_TONE_FIELD: Record<string, string> = { extras_journalentry: 'kind' };

/** The tone to tint a row with, or null when this table has no row-level tone. */
export function rowTone(
  table: string | undefined,
  row: Record<string, unknown>,
): StatusTone | null {
  const field = table ? ROW_TONE_FIELD[table] : undefined;
  return field ? (pillFor(table, field, row[field])?.tone ?? null) : null;
}

const MASK = '••••••••';
const SECRET_FIELD = /(^|_)(password|passwd|secret|token|api_?key)(_|$)/i;
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]*@/i;

/** True when the field's value is a secret that should never be shown in clear. */
export const isSecretField = (field: string): boolean => SECRET_FIELD.test(field);

/**
 * The text to display for a value that may hold a secret: a password/secret/token field is
 * replaced by dots, and the credentials of a URL are dropped (`http://admin:pw@host:1880`
 * → `http://host:1880`) so the rest can be copied as is. Returns null when there is nothing to hide.
 */
export function maskSecret(field: string, value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (isSecretField(field)) return MASK;
  return URL_USERINFO.test(value) ? value.replace(URL_USERINFO, '$1') : null;
}

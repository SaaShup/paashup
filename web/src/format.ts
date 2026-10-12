// Units of the numeric fields, so a bare 7168 reads as "7 GB" in lists and details, and a
// form says what to type. Keyed by table, then by field name.
type Unit = 'MB' | 'GB' | 'vCPU';

const UNITS: Record<string, Record<string, Unit>> = {
  virtualization_virtual_machine: { memory: 'MB', disk: 'GB', vcpus: 'vCPU' },
  virtualization_virtual_machine_type: { default_memory: 'MB', default_vcpus: 'vCPU' },
  virtualization_virtual_disk: { size: 'GB' },
};

/** Field names shown differently: a VM's `disk` is its root disk, the other disks are volumes. */
const LABELS: Record<string, Record<string, string>> = {
  virtualization_virtual_machine: { disk: 'root disk' },
};

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
  if (unit === 'MB') return n >= 1024 ? `${tidy(n / 1024)} GB` : `${tidy(n)} MB`;
  return `${tidy(n)} ${unit}`;
}

/** The label of a field in a detail page. */
export const fieldLabel = (table: string | undefined, field: string): string =>
  (table && LABELS[table]?.[field]) || field.replace(/_/g, ' ');

/** The label of a form field, with the unit to type the value in: "memory (MB)". */
export function formLabel(table: string | undefined, field: string): string {
  const unit = table ? UNITS[table]?.[field] : undefined;
  const label = (table && LABELS[table]?.[field]) || field;
  return unit && unit !== 'vCPU' ? `${label} (${unit})` : label;
}

/** The header of a list column: the field name, or its special label (`disk` → "root disk"). */
export const columnLabel = (table: string | undefined, field: string): string =>
  (table && LABELS[table]?.[field]) || field;

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

/** Status fields drawn as a coloured pill: table → field → value → look. */
const PILLS: Record<string, Record<string, Record<string, Omit<Pill, 'label'>>>> = {
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

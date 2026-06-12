// Hand-written metadata interfaces consumed by the generated metadata.ts and the
// generic Repository. These describe each table at runtime so one Repository can
// serve every entity without an ORM.

/** How a column is represented in JS, used for read/write coercion. */
export type TsKind = 'number' | 'string' | 'boolean' | 'json';

export interface ColumnMeta {
  /** Logical field name (NetBox API field). */
  readonly name: string;
  /** Physical DB column (foreign keys are `<name>_id`). */
  readonly column: string;
  readonly tsKind: TsKind;
  readonly nullable: boolean;
  /** Settable on create/update (excludes id, timestamps, computed, m2m). */
  readonly writable: boolean;
  /** Must be supplied on create (NOT NULL without a default). */
  readonly required: boolean;
  /** Max length for string columns, if bounded. */
  readonly maxLength?: number;
  /** Foreign-key target table, if this is an FK column. */
  readonly references?: string;
  /**
   * For the two columns of a generic (polymorphic) relation, the accessor name
   * (e.g. `scope_type`/`scope_id` both carry `genericRel: "scope"`). The serializer
   * resolves `<accessor>` to a nested object using the `_type` content-type.
   */
  readonly genericRel?: string;
  /** Allowed values for enum columns. */
  readonly enum?: readonly (string | number)[];
  /** value -> human label for enum columns (NetBox `{value, label}` choices). */
  readonly enumLabels?: Readonly<Record<string, string>>;
  /**
   * Serialize this enum column as its raw value (a plain string) instead of a NetBox
   * `{value, label}` object — e.g. a container's `operation`, which the Docker agent
   * consumes as a bare command string. Writes still accept the plain value.
   */
  readonly plainValue?: boolean;
  /**
   * Writable via the API (e.g. the Docker agent PATCHes it back) but not meant to be
   * entered by a user — the generated UI form omits it. Surfaced in the OpenAPI write
   * schema as `x-form-hidden`. Example: an image's agent-observed `ImageID`.
   */
  readonly formHidden?: boolean;
  /**
   * For a json column holding an array of object-type strings (e.g. the webhook
   * `object_types` field), render it in the schema as a multi-select whose choices
   * are every object type currently in the registry.
   */
  readonly objectTypeChoices?: boolean;
  /**
   * For a json column holding an array drawn from a fixed choice list (e.g. the
   * webhook `events` field), render it as a multi-select over these values.
   */
  readonly arrayEnum?: readonly (string | number)[];
  /** Server-generated read-only value, e.g. "uuid" (set on create). */
  readonly auto?: string;
}

/** A many-to-many relation (NetBox `tags` or an explicit join-table M2M). */
export interface RelationMeta {
  /** Logical field name (e.g. "tags", "tagged_vlans"). */
  readonly name: string;
  /** "tags" = polymorphic tagging table; "m2m" = a dedicated join table. */
  readonly kind: 'tags' | 'm2m';
  /** Target model name (e.g. "Tag", "VLAN"). */
  readonly target: string;
  /** Physical table of the target rows. */
  readonly targetTable: string;
  /** Join table (m2m only). */
  readonly joinTable?: string;
  /** Column in the join table holding this entity's id (m2m only). */
  readonly selfColumn?: string;
  /** Column in the join table holding the target id (m2m only). */
  readonly targetColumn?: string;
}

/** A `<x>_count` read-only field, computed by counting reverse-FK rows. */
export interface CountSpec {
  /** Serialized field name (e.g. "device_count"). */
  readonly name: string;
  /** Table holding the rows to count. */
  readonly table: string;
  /** FK column in that table pointing back at this entity. */
  readonly column: string;
}

export interface TableMeta {
  /** PascalCase model name (e.g. "Device"). */
  readonly model: string;
  /** Physical table name (e.g. "dcim_device"). */
  readonly table: string;
  readonly section: string;
  readonly endpoint: string;
  readonly origin: 'core' | 'external-full' | 'external-stub' | 'plugin';
  readonly pk: string;
  /** Type of the primary key: integer (default) or a server-generated UUID string. */
  readonly pkKind?: 'number' | 'string';
  readonly columns: readonly ColumnMeta[];
  /** Many-to-many relations (tags + join-table M2M). */
  readonly relations: readonly RelationMeta[];
  /** Reverse-FK count fields (e.g. `device_count`). */
  readonly counts: readonly CountSpec[];
  /** Content-type string for polymorphic links/tagging (e.g. "dcim.device"). */
  readonly objectType: string;
  /** Whether the API endpoint is read-only (no create/update/delete). */
  readonly readOnly: boolean;
}

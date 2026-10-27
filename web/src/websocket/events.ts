// Typed messages from the paashup WebSocket change-feed (/api/ws/).

export interface HelloEvent {
  type: 'hello';
  ts: number;
}

export interface ChangeEvent {
  type: 'change';
  event: 'created' | 'updated' | 'deleted';
  /** Content-type of the object, e.g. "dcim.device". */
  object_type: string;
  /** Physical table name, e.g. "dcim_device". */
  table: string;
  id: number;
  /** Serialized object for created/updated (absent for deleted). */
  data?: Record<string, unknown>;
}

export type ServerEvent = HelloEvent | ChangeEvent;

export function isChange(e: ServerEvent): e is ChangeEvent {
  return e.type === 'change';
}

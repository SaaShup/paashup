import { defineStore } from 'pinia';
import type { ConnectionStatus } from '../websocket/socket.js';
import type { ChangeEvent } from '../websocket/events.js';

export interface LoggedChange extends ChangeEvent {
  at: number;
}

/** WebSocket connection status + a rolling log of recent change events. */
export const useConnectionStore = defineStore('connection', {
  state: () => ({
    status: 'closed' as ConnectionStatus,
    log: [] as LoggedChange[],
  }),
  actions: {
    setStatus(status: ConnectionStatus) {
      this.status = status;
    },
    record(event: ChangeEvent) {
      this.log.unshift({ ...event, at: Date.now() });
      if (this.log.length > 50) this.log.length = 50;
    },
  },
});

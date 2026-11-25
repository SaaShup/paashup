// Interactive SSH terminal into a VM, relayed over WebSocket — the same framing and
// frontend component (ContainerTerminal.vue) as the Docker exec terminal (./terminal.ts),
// but paashup is the SSH client itself (via the ssh2 package), using its own service-account
// key (serviceAccount.ts) rather than proxying to an agent. That key's public half must be
// deployed to the VM (as any catalog SSH key is, through the existing agent push) before a
// session can open — a plain auth failure otherwise. The login account isn't asked of the
// user: it's whatever the agent reported managing (see vmAccount below), since there's only
// ever one per agent.
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import type { PluginWebSocketRoute } from '../../../plugins/types.js';
import {
  getServiceAccountPrivateKey,
  isServiceAccountDeployedOn,
  SERVICE_ACCOUNT_KEY_NAME,
} from '../../../serviceAccount.js';

const wss = new WebSocketServer({ noServer: true });

const CLOSE_NOT_FOUND = 4004;
const CLOSE_FORBIDDEN = 4003;
const CLOSE_AGENT_ERROR = 4502;

const MSG = {
  stdin: 0,
  stdout: 1,
  stderr: 2,
  resize: 50,
  resume: 100,
  pause: 101,
  end: 102,
  stopped: 200,
  shutdown: 201,
  error: 202,
} as const;

/** Close reasons are capped at 123 bytes by the protocol. */
const reason = (s: string): string => Buffer.from(s).subarray(0, 120).toString();

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as ArrayBuffer);

function frame(code: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from([code]), payload]);
}

type Db = import('../../../db/types.js').Db;

/** The VM's primary IP (v4 preferred), or null without one. */
async function vmAddress(db: Db, vmId: number): Promise<string | null> {
  const row = await db.get<{ address: string }>(
    `SELECT a.address FROM virtualization_virtual_machine v
       JOIN ipam_ipaddress a ON a.id = COALESCE(v.primary_ip4_id, v.primary_ip6_id)
      WHERE v.id = ?`,
    [vmId],
  );
  return row ? String(row.address).split('/')[0]! : null;
}

/**
 * The account the agent manages `authorized_keys` for on this VM (one fixed account per
 * agent — see sshkeys.ts): whatever it reported when a key was last deployed/read, stored on
 * any of the VM's `plugin_docker_vm_ssh_key` rows. Null until at least one key has been synced.
 */
async function vmAccount(db: Db, vmId: number): Promise<string | null> {
  const row = await db.get<{ account: string | null }>(
    `SELECT account FROM plugin_docker_vm_ssh_key
      WHERE virtual_machine_id = ? AND account IS NOT NULL LIMIT 1`,
    [vmId],
  );
  return row?.account ?? null;
}

export const sshTerminalWebSockets: PluginWebSocketRoute[] = [
  {
    path: '/api/plugins/docker/virtual-machines/{id}/ssh/',
    handler: ({ db, params, query, req, socket, head }) => {
      wss.handleUpgrade(req, socket, head, (client) => {
        void (async () => {
          const vmId = Number(params.id);
          const address = await vmAddress(db, vmId);
          if (!address) return client.close(CLOSE_NOT_FOUND, 'VM has no primary IP');

          const privateKey = await getServiceAccountPrivateKey(db);
          if (!privateKey) {
            return client.close(CLOSE_AGENT_ERROR, 'No SSH service-account key configured');
          }

          const username = (await vmAccount(db, vmId)) || process.env.PB_SSH_USERNAME || 'paashup';
          const port = Number(process.env.PB_SSH_PORT || 22);
          const command = query.getAll('command');
          const cmd = command.length ? command.join(' ') : undefined;
          const cols = Number(query.get('cols') || 80);
          const rows = Number(query.get('rows') || 24);

          const ssh = new SshClient();
          let channel: ClientChannel | null = null;

          const onReady = () => {
            const open = (err: Error | undefined, ch: ClientChannel) => {
              if (err || !ch) {
                ssh.end();
                return client.close(CLOSE_AGENT_ERROR, reason(err?.message ?? 'exec failed'));
              }
              channel = ch;
              if (client.readyState !== WebSocket.OPEN) return ch.end();
              client.send(frame(MSG.resume));
              ch.on('data', (data: Buffer) => {
                if (client.readyState === WebSocket.OPEN) client.send(frame(MSG.stdout, data));
              });
              ch.stderr.on('data', (data: Buffer) => {
                if (client.readyState === WebSocket.OPEN) client.send(frame(MSG.stderr, data));
              });
              ch.on('close', (code?: number) => {
                client.send(frame(MSG.stopped, Buffer.from([code ?? 0])));
                client.close(1000, 'Session ended');
              });
            };
            const pty = { cols, rows, term: 'xterm-256color' };
            if (cmd) ssh.exec(cmd, { pty }, open);
            else ssh.shell(pty, open);
          };

          ssh.on('ready', onReady);
          ssh.on('error', (err: Error) => {
            void (async () => {
              const forbidden = /auth/i.test(err.message);
              if (forbidden && !(await isServiceAccountDeployedOn(db, vmId))) {
                return client.close(
                  CLOSE_FORBIDDEN,
                  reason(
                    `paashup's SSH key ("${SERVICE_ACCOUNT_KEY_NAME}") isn't deployed on this VM yet — ` +
                      'add it from the SSH keys catalog first.',
                  ),
                );
              }
              client.close(forbidden ? CLOSE_FORBIDDEN : CLOSE_AGENT_ERROR, reason(err.message));
            })();
          });

          client.on('message', (data) => {
            const m = toBuffer(data);
            if (!m.length) return;
            const payload = m.subarray(1);
            switch (m[0]) {
              case MSG.stdin:
                channel?.write(payload);
                break;
              case MSG.resize:
                if (channel && payload.length >= 4) {
                  channel.setWindow(payload.readUInt16LE(0), payload.readUInt16LE(2), 0, 0);
                }
                break;
              case MSG.end:
                channel?.end();
                break;
              default:
                break;
            }
          });
          client.on('close', () => {
            channel?.end();
            ssh.end();
          });
          client.on('error', () => {
            channel?.end();
            ssh.end();
          });

          ssh.connect({ host: address, port, username, privateKey, readyTimeout: 10_000 });
        })().catch((err: unknown) => {
          console.error(err);
          if (client.readyState === WebSocket.OPEN) client.close(1011, 'internal error');
        });
      });
    },
  },
];

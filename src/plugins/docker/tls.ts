// Trust-on-first-use pinning of a Docker agent's TLS CA. An agent run with HTTP_SECURE=true
// serves a self-signed CA (see paashup-agent src/tls.js), unique per agent instance, from the
// unauthenticated GET /api/tls/certificate. Since no central CA exists to verify it against,
// the CA is fetched once — without verifying the connection it comes over — when a host's
// https endpoint is set, and stored on the host row (ca_pem). Every later call to that host
// is pinned to exactly that CA: a cert from any other CA (even a publicly trusted one) is
// refused, which is the point of pinning rather than merely trusting it.
//
// If the agent's CA ever changes (redeploy, lost volume), the host must be re-added: there is
// no re-pin flow by design, to keep a silent CA change from re-establishing trust unnoticed.
import { X509Certificate } from 'node:crypto';
import { splitCredentials } from '../../webhooks.js';
import type { Db } from '../../db/types.js';
import { T } from './meta.js';
import { journalHost } from './journal.js';

const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

const FETCH_TIMEOUT_MS = 10000;

let insecureDispatcher: unknown;
const pinnedDispatchers = new Map<string, unknown>();

/** Dispatcher that accepts any server cert — only for the unauthenticated bootstrap fetch. */
async function getInsecureDispatcher(): Promise<unknown> {
  if (!insecureDispatcher) {
    const { Agent } = await import('undici');
    insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureDispatcher;
}

/** Dispatcher that trusts only this exact CA (and nothing else). */
async function getPinnedDispatcher(ca: string): Promise<unknown> {
  let dispatcher = pinnedDispatchers.get(ca);
  if (!dispatcher) {
    const { Agent } = await import('undici');
    dispatcher = new Agent({ connect: { ca, rejectUnauthorized: true } });
    pinnedDispatchers.set(ca, dispatcher);
  }
  return dispatcher;
}

/** Attach a pinned (or, bootstrap-only, insecure) dispatcher to a fetch() against an https URL. */
export async function withAgentDispatcher(
  opts: RequestInit,
  url: string,
  ca: string | undefined,
  insecure = false,
): Promise<RequestInit> {
  if (!url.startsWith('https:')) return opts;
  const dispatcher = ca
    ? await getPinnedDispatcher(ca)
    : insecure
      ? await getInsecureDispatcher()
      : undefined;
  return dispatcher ? { ...opts, dispatcher: dispatcher as RequestInit['dispatcher'] } : opts;
}

/**
 * Node's global fetch() is backed by its own bundled undici, a different instance from the
 * `undici` npm dependency — an Agent built from the latter is rejected as a `dispatcher` by
 * the former (UND_ERR_INVALID_ARG). So any call that attaches one of our dispatchers must go
 * through undici's own fetch instead of the global one.
 */
export async function dispatchedFetch(url: string, opts: RequestInit): Promise<Response> {
  if (!opts.dispatcher) return fetch(url, opts);
  const { fetch: undiciFetch } = await import('undici');
  return undiciFetch(
    url,
    opts as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>;
}

/**
 * Fetch the agent's CA certificate (PEM) over its own, as-yet-untrusted connection — the
 * trust-on-first-use step. Throws if the agent is unreachable or doesn't serve one.
 */
export async function fetchAgentCa(endpoint: string): Promise<string> {
  const { url, authHeader } = splitCredentials(endpoint);
  if (!url.startsWith('https:')) throw new Error('Not an https endpoint');
  const opts = await withAgentDispatcher(
    { headers: authHeader ? { Authorization: authHeader } : {} },
    url,
    undefined,
    true,
  );
  const resp = await dispatchedFetch(`${url.replace(/\/$/, '')}/api/tls/certificate`, {
    ...opts,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Agent answered ${resp.status} for /api/tls/certificate`);
  const pem = (await resp.text()).trim();
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('Not a PEM certificate');
  return pem;
}

/** The CA pinned for a host, if any. */
export async function hostCa(db: Db, hostId: unknown): Promise<string | undefined> {
  const row = await db.get<{ ca_pem: string | null }>(
    `SELECT ca_pem FROM ${ident(T.host)} WHERE id = ?`,
    [Number(hostId)],
  );
  return row?.ca_pem ?? undefined;
}

/** The host whose (https, pinned) endpoint matches this URL's host:port, if any. */
async function findHostForUrl(
  db: Db,
  url: string,
): Promise<{ id: number; ca_pem: string | null } | undefined> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }
  if (target.protocol !== 'https:') return undefined;
  const rows = await db.query<{ id: number; endpoint: string; ca_pem: string | null }>(
    `SELECT id, endpoint, ca_pem FROM ${ident(T.host)} WHERE ca_pem IS NOT NULL`,
  );
  for (const row of rows) {
    try {
      if (new URL(splitCredentials(row.endpoint).url).host === target.host) return row;
    } catch {
      /* malformed stored endpoint — skip it */
    }
  }
  return undefined;
}

/**
 * A webhook target (one of DOCKER_WEBHOOKS, e.g. "[Docker] Add host") that happens to be
 * one of our agents: hand back its pinned CA so the generic webhook delivery (src/webhooks.ts)
 * trusts it too, same as agentFetch. Registered as a WebhookCaResolver in index.ts.
 */
export async function hostCaForUrl(db: Db, url: string): Promise<string | undefined> {
  const host = await findHostForUrl(db, url);
  return host?.ca_pem ?? undefined;
}

/**
 * A pinned webhook delivery to one of our agents failed outright (no HTTP response at all —
 * most often the agent's CA no longer matches what's pinned). Leave a journal entry on the
 * host explaining why, since the server console log otherwise never reaches the UI.
 * Registered as a WebhookCaFailureHandler in index.ts.
 */
export async function journalCaFailure(db: Db, url: string, message: string): Promise<void> {
  const host = await findHostForUrl(db, url);
  if (!host) return;
  await journalHost(
    db,
    host.id,
    'danger',
    `Agent call over the pinned CA failed: ${message}. If the agent's CA changed (redeploy, lost data), delete and re-add the host to re-pin it.`,
  );
}

/**
 * (Re)pin a host's CA for an https endpoint (trust-on-first-use), or clear it for a plain
 * http one. Best-effort: logged, never thrown — an unreachable agent at pin time shouldn't
 * block adding/editing the host; its https calls simply fail until the agent is reachable
 * and the host is re-added (or edited again) to retry the pin.
 */
export async function pinAgentCa(db: Db, hostId: number, endpoint: string): Promise<void> {
  const { url } = splitCredentials(endpoint);
  if (!url.startsWith('https:')) {
    await db.execute(`UPDATE ${ident(T.host)} SET ca_pem = NULL WHERE id = ?`, [hostId]);
    return;
  }
  try {
    const pem = await fetchAgentCa(endpoint);
    await db.execute(`UPDATE ${ident(T.host)} SET ca_pem = ? WHERE id = ?`, [pem, hostId]);
    const fingerprint = new X509Certificate(pem).fingerprint256;
    await journalHost(
      db,
      hostId,
      'success',
      `Agent CA pinned (trust-on-first-use): ${fingerprint}`,
    );
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : '';
    const message = `Could not pin agent CA${cause || `: ${(e as Error).message}`}`;
    console.warn(`[Docker] Host ${hostId}: ${message}`);
    await journalHost(db, hostId, 'danger', message);
  }
}

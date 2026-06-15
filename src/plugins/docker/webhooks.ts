// Default webhooks for the Docker agent integration, seeded at startup (created if
// missing — see `ensureWebhooks`). Each fires on a single entity/event and renders
// the target agent URL from the changed object via NetBox-style templating
// (`{{ data.host.endpoint }}` etc.). Ported from netbox_docker_plugin's seed set.
import type { WebhookSeed } from '../../webhooks.js';
import { META } from './meta.js';

const OT = {
  container: META.container.objectType,
  host: META.host.objectType,
  image: META.image.objectType,
  network: META.network.objectType,
  volume: META.volume.objectType,
} as const;

/** Shared defaults: enabled, and verify TLS on the agent endpoint. */
const base = { enabled: true, sslVerification: true } as const;

export const DOCKER_WEBHOOKS: readonly WebhookSeed[] = [
  // ---- create ----
  {
    ...base,
    name: '[Docker] Add container',
    objectTypes: [OT.container],
    events: ['created'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/containers',
  },
  {
    ...base,
    name: '[Docker] Add host',
    objectTypes: [OT.host],
    events: ['created'],
    httpMethod: 'GET',
    payloadUrl:
      '{{ data.endpoint }}/api/engine/endpoint?id={{ data.id }}&token={{ data.token.key }}&endpoint={{ data.endpoint }}&url={{ data.netbox_base_url }}',
  },
  {
    ...base,
    name: '[Docker] Add image',
    objectTypes: [OT.image],
    events: ['created'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/images',
  },
  {
    ...base,
    name: '[Docker] Add network',
    objectTypes: [OT.network],
    events: ['created'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/networks',
  },
  {
    ...base,
    name: '[Docker] Add volume',
    objectTypes: [OT.volume],
    events: ['created'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/volumes',
  },
  // ---- delete ----
  {
    ...base,
    name: '[Docker] Delete container',
    objectTypes: [OT.container],
    events: ['deleted'],
    httpMethod: 'DELETE',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/containers',
  },
  {
    ...base,
    name: '[Docker] Delete host',
    objectTypes: [OT.host],
    events: ['deleted'],
    httpMethod: 'DELETE',
    payloadUrl: '{{ data.endpoint }}/api/engine/endpoint',
  },
  {
    ...base,
    name: '[Docker] Delete image',
    objectTypes: [OT.image],
    events: ['deleted'],
    httpMethod: 'DELETE',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/images',
  },
  {
    ...base,
    name: '[Docker] Delete network',
    objectTypes: [OT.network],
    events: ['deleted'],
    httpMethod: 'DELETE',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/networks',
  },
  {
    ...base,
    name: '[Docker] Delete volume',
    objectTypes: [OT.volume],
    events: ['deleted'],
    httpMethod: 'DELETE',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/volumes',
  },
  // ---- modify (update) ----
  {
    ...base,
    name: '[Docker] Modify host',
    objectTypes: [OT.host],
    events: ['updated'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.endpoint }}/api/engine/endpoint',
  },
  {
    ...base,
    name: '[Docker] Modify image',
    objectTypes: [OT.image],
    events: ['updated'],
    httpMethod: 'POST',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/images',
  },
  {
    ...base,
    name: '[Docker] Modify container',
    objectTypes: [OT.container],
    events: ['updated'],
    httpMethod: 'PUT',
    payloadUrl: '{{ data.host.endpoint }}/api/engine/containers',
  },
];

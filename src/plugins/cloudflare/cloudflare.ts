// Cloudflare DNS API client, ported from
// netbox_cloudflare_plugin/utilities/cloudflare_dns_client.py. Talks to the
// Cloudflare v4 API with a per-zone bearer token. The base URL is overridable via
// PB_CLOUDFLARE_BASE_URL (default https://api.cloudflare.com/client/v4) so tests
// (and self-hosted gateways) can point it elsewhere.

export interface ZoneAccount {
  zone_id: string;
  token: string;
}
export interface CfRecord {
  record_id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

const RECORD_TYPES = new Set(['A', 'CNAME']);

function baseUrl(): string {
  return (process.env.PB_CLOUDFLARE_BASE_URL || 'https://api.cloudflare.com/client/v4').replace(
    /\/+$/,
    '',
  );
}

async function cf(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Cloudflare ${method} ${path} -> ${res.status}`);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Page through a zone's DNS records, returning only A/CNAME entries. */
export async function listDnsRecords(
  zone: ZoneAccount,
  page = 1,
  perPage = 100,
): Promise<{ records: CfRecord[]; totalPages: number }> {
  const content = await cf(
    'GET',
    `/zones/${zone.zone_id}/dns_records?page=${page}&per_page=${perPage}`,
    zone.token,
  );
  const result = (content.result as Record<string, unknown>[] | undefined) ?? [];
  const info = (content.result_info as { total_pages?: number } | undefined) ?? {};
  const records: CfRecord[] = [];
  for (const r of result) {
    if (!RECORD_TYPES.has(String(r.type))) continue;
    records.push({
      record_id: String(r.id),
      name: String(r.name),
      type: String(r.type),
      content: String(r.content),
      ttl: Number(r.ttl ?? 3600),
      proxied: !!r.proxied,
    });
  }
  return { records, totalPages: Number(info.total_pages ?? 1) };
}

/** Create a DNS record on Cloudflare; returns the new record id. */
export async function createDnsRecord(
  zone: ZoneAccount,
  rec: { name: string; type: string; content: string; ttl: number; proxied: boolean },
): Promise<string> {
  const content = await cf('POST', `/zones/${zone.zone_id}/dns_records`, zone.token, {
    name: rec.name,
    type: rec.type,
    content: rec.content,
    ttl: rec.ttl,
    proxied: rec.proxied,
  });
  const result = (content.result as { id?: unknown } | undefined) ?? {};
  return String(result.id ?? '');
}

/** Overwrite a DNS record on Cloudflare (PUT) with the full desired state. */
export async function updateDnsRecord(
  zone: ZoneAccount,
  recordId: string,
  rec: { name: string; type: string; content: string; ttl: number; proxied: boolean },
): Promise<void> {
  await cf('PUT', `/zones/${zone.zone_id}/dns_records/${recordId}`, zone.token, {
    name: rec.name,
    type: rec.type,
    content: rec.content,
    ttl: rec.ttl,
    proxied: rec.proxied,
  });
}

/** Delete a DNS record on Cloudflare by its record id. */
export async function deleteDnsRecord(zone: ZoneAccount, recordId: string): Promise<void> {
  await cf('DELETE', `/zones/${zone.zone_id}/dns_records/${recordId}`, zone.token);
}

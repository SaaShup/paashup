// A stand-in OpenStack for the plugin tests: one HTTP server playing Keystone (v3 password
// auth + service catalogue), Nova (servers, keypairs), Glance (images) and Cinder
// (volumes). Every region of `state.regions` gets its own set of endpoints, all served
// from this one server, and the catalogue Keystone returns points back at it — exactly how
// the plugin discovers endpoints against a real cloud. Tests change `state` between syncs
// and flip the `down` / `noVolumes` switches to simulate failures.
import http from 'node:http';

export const region = (extra = {}) => ({
  servers: [],
  images: [],
  volumes: [],
  keypairs: [],
  flavors: [{ id: 'fl-1', name: 'b2-7', vcpus: 2, ram: 7168, disk: 50 }],
  limits: {
    maxTotalInstances: 10,
    totalInstancesUsed: 0,
    maxTotalCores: 20,
    totalCoresUsed: 0,
    maxTotalRAMSize: 51200,
    totalRAMUsed: 0,
  },
  buildReads: 0, // how many times a new server is read as BUILD before it turns ACTIVE
  failBuild: null, // a message: a new server ends in ERROR with this fault
  down: false, // the whole compute API answers 500
  glanceDown: false,
  volumesDown: false,
  noVolumes: false, // no block-storage service in the catalogue
  ...extra,
});

/** A Nova server as returned by `/servers/detail` with microversion 2.47. */
export const server = (id, name, extra = {}) => ({
  id,
  name,
  status: 'ACTIVE',
  flavor: { original_name: 'b2-7', vcpus: 2, ram: 7168, disk: 50 },
  image: { id: 'img-ubuntu' },
  metadata: {},
  addresses: {},
  ...extra,
});

export const addr = (ip, extra = {}) => ({
  addr: ip,
  version: ip.includes(':') ? 6 : 4,
  'OS-EXT-IPS:type': 'fixed',
  ...extra,
});

export async function startFakeOpenStack() {
  const state = {
    user: 'demo',
    password: 'secret',
    hasProject: true,
    projectName: 'demo-project',
    regions: { GRA9: region(), SBG5: region() },
    authCalls: 0,
  };
  const TOKEN = 'tok-1';

  const srv = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${srv.address().port}`;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      const path = req.url.split('?')[0];

      if (req.method === 'POST' && path === '/v3/auth/tokens') {
        state.authCalls++;
        const user = JSON.parse(raw)?.auth?.identity?.password?.user ?? {};
        if (user.name !== state.user || user.password !== state.password) {
          return send(401, {
            error: { code: 401, message: 'The request you have made requires authentication.' },
          });
        }
        const catalog = [];
        for (const [name, r] of Object.entries(state.regions)) {
          const ep = (type) => ({
            type,
            endpoints: [{ interface: 'public', region_id: name, url: `${origin}/${type}/${name}` }],
          });
          catalog.push(ep('compute'), ep('image'));
          if (!r.noVolumes) catalog.push(ep('volumev3'));
        }
        return send(
          201,
          {
            token: {
              expires_at: new Date(Date.now() + 3600e3).toISOString(),
              project: state.hasProject ? { id: 'proj-1', name: state.projectName } : undefined,
              catalog,
            },
          },
          { 'X-Subject-Token': TOKEN },
        );
      }

      if (req.headers['x-auth-token'] !== TOKEN)
        return send(401, { error: { message: 'bad token' } });
      const m = path.match(/^\/(compute|image|volumev3)\/([^/]+)(\/.*)$/);
      const r = m && state.regions[m[2]];
      if (!r) return send(404, { error: { message: 'not found' } });
      const [, type, , rest] = m;

      if (type === 'compute') {
        if (r.down) return send(500, { error: { message: 'compute is down' } });
        if (rest === '/servers/detail') return send(200, { servers: r.servers });
        if (rest === '/flavors/detail') return send(200, { flavors: r.flavors });
        if (rest === '/limits') return send(200, { limits: { absolute: r.limits } });
        if (req.method === 'POST' && rest === '/servers') {
          const spec = JSON.parse(raw).server;
          const flavor = r.flavors.find((f) => f.id === spec.flavorRef);
          const created = server(`srv-${r.servers.length + 1}-${Date.now()}`, spec.name, {
            status: 'BUILD',
            flavor: {
              original_name: flavor?.name,
              vcpus: flavor?.vcpus,
              ram: flavor?.ram,
              disk: flavor?.disk,
            },
            image: { id: spec.imageRef },
            metadata: spec.metadata ?? {},
            key_name: spec.key_name,
            networks: spec.networks,
            reads: 0,
          });
          r.servers.push(created);
          r.created = [...(r.created ?? []), spec];
          return send(202, { server: { id: created.id } });
        }
        const one = rest.match(/^\/servers\/([^/]+)$/);
        if (one) {
          const i = r.servers.findIndex((x) => x.id === one[1]);
          if (i < 0) return send(404, { itemNotFound: { message: 'Instance could not be found' } });
          const found = r.servers[i];
          if (req.method === 'DELETE') {
            r.servers.splice(i, 1);
            r.deleted = [...(r.deleted ?? []), found.id];
            return send(204, {});
          }
          if (found.status === 'BUILD' && found.reads++ >= r.buildReads) {
            found.status = r.failBuild ? 'ERROR' : 'ACTIVE';
            if (r.failBuild) found.fault = { message: r.failBuild };
            else found.addresses = { 'Ext-Net': [addr(`51.0.0.${r.servers.length + 10}`)] };
          }
          return send(200, { server: found });
        }
        // server metadata: GET reads, POST adds / updates, DELETE /<key> removes one
        const meta = rest.match(/^\/servers\/([^/]+)\/metadata(?:\/([^/]+))?$/);
        if (meta) {
          const found = r.servers.find((x) => x.id === meta[1]);
          if (!found)
            return send(404, { itemNotFound: { message: 'Instance could not be found' } });
          found.metadata ??= {};
          if (req.method === 'POST') Object.assign(found.metadata, JSON.parse(raw).metadata);
          if (req.method === 'DELETE' && meta[2]) {
            if (!(meta[2] in found.metadata))
              return send(404, { itemNotFound: { message: 'Metadata item not found' } });
            delete found.metadata[meta[2]];
            return send(204, {});
          }
          return send(200, { metadata: found.metadata });
        }
        if (req.method === 'POST' && rest === '/os-keypairs') {
          const k = JSON.parse(raw).keypair;
          r.keypairs.push({ name: k.name, public_key: k.public_key });
          return send(200, { keypair: k });
        }
        if (rest === '/os-keypairs') {
          return send(200, {
            keypairs: r.keypairs.map((k) => ({
              keypair: { name: k.name, public_key: k.public_key ?? '', type: k.type ?? 'ssh' },
            })),
          });
        }
      }
      if (type === 'image' && rest === '/v2/images') {
        if (r.glanceDown) return send(500, { message: 'glance is down' });
        return send(200, { images: r.images });
      }
      const oneImage = type === 'image' && rest.match(/^\/v2\/images\/([^/]+)$/);
      if (oneImage) {
        const found = r.images.find((i) => i.id === oneImage[1]);
        return found ? send(200, found) : send(404, { message: 'image not found' });
      }
      if (type === 'volumev3' && rest === '/volumes/detail') {
        if (r.volumesDown) return send(500, { error: { message: 'cinder is down' } });
        return send(200, { volumes: r.volumes });
      }
      return send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { state, url, authUrl: `${url}/v3`, close: () => new Promise((r) => srv.close(r)) };
}

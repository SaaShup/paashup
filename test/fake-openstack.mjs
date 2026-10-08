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

// Documentation pages, authored as Markdown and bundled at build time.
import welcome from './welcome.md?raw';
import uiGuide from './ui-guide.md?raw';
import objects from './objects.md?raw';
import infraOverview from './infra-overview.md?raw';
import openstack from './openstack.md?raw';
import vms from './vms.md?raw';
import dockerAgent from './docker-agent.md?raw';
import dockerContainers from './docker-containers.md?raw';
import keycloak from './keycloak.md?raw';
import cloudflare from './cloudflare.md?raw';
import api from './api.md?raw';
import apiKeys from './api-keys.md?raw';
import webhooks from './webhooks.md?raw';
import plugins from './plugins.md?raw';

export interface DocPage {
  id: string;
  title: string;
  body: string;
}

export const docs: DocPage[] = [
  { id: 'welcome', title: 'Welcome', body: welcome },
  { id: 'ui', title: 'Using the interface', body: uiGuide },
  { id: 'objects', title: 'The object model', body: objects },
  { id: 'infra-overview', title: 'Managing your infrastructure', body: infraOverview },
  { id: 'openstack', title: 'Virtualization: OpenStack', body: openstack },
  { id: 'vms', title: 'Creating VMs', body: vms },
  { id: 'docker-agent', title: 'The Docker agent', body: dockerAgent },
  { id: 'docker-containers', title: 'Managing containers', body: dockerContainers },
  { id: 'keycloak', title: 'Keycloak', body: keycloak },
  { id: 'cloudflare', title: 'Cloudflare DNS', body: cloudflare },
  { id: 'api', title: 'The API', body: api },
  { id: 'api-keys', title: 'API keys', body: apiKeys },
  { id: 'webhooks', title: 'Webhooks & realtime', body: webhooks },
  { id: 'plugins', title: 'Plugins', body: plugins },
];

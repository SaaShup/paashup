// Documentation pages, authored as Markdown and bundled at build time.
import welcome from './welcome.md?raw';
import uiGuide from './ui-guide.md?raw';
import objects from './objects.md?raw';
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
  { id: 'api', title: 'The API', body: api },
  { id: 'api-keys', title: 'API keys', body: apiKeys },
  { id: 'webhooks', title: 'Webhooks & realtime', body: webhooks },
  { id: 'plugins', title: 'Plugins', body: plugins },
];

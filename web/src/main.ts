import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles.css';
import App from './App.vue';
import { socket } from './websocket/socket.js';
import { isChange } from './websocket/events.js';
import { useConnectionStore } from './stores/connection.js';
import { useObjectsStore } from './stores/objects.js';
import { useUiStore } from './stores/ui.js';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// Wire the WebSocket change-feed into the stores, then connect.
const connection = useConnectionStore(pinia);
const objects = useObjectsStore(pinia);
const ui = useUiStore(pinia);

socket.onStatus((status) => connection.setStatus(status));
socket.on((event) => {
  if (isChange(event)) {
    connection.record(event);
    objects.applyChange(event);
    ui.bumpCount(event); // keep sidebar item counts live
    void ui.resyncCountsAfterBulkChange(event); // resync counts on refresh host
  }
});
socket.connect();

app.mount('#app');

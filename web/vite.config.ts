import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// In dev, proxy the REST API and the WebSocket change-feed to the paas2box backend.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: process.env.PB_BACKEND ?? 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Component + unit tests run under jsdom. Mirrors the Vite plugin set so .vue SFCs compile.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
  },
});

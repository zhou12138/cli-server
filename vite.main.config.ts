import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // ws optional native deps — not needed, must stay external
      external: ['bufferutil', 'utf-8-validate'],
    },
  },
  resolve: {
    conditions: ['node'],
  },
});

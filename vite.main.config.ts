import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // Native addons / optional deps — must stay external
      external: ['bufferutil', 'utf-8-validate', 'node-pty'],
    },
  },
  resolve: {
    conditions: ['node'],
  },
});

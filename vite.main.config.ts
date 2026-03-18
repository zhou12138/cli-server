import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['express', 'ws'],
    },
  },
  resolve: {
    // Ensure Node.js built-in modules are treated as external
    conditions: ['node'],
  },
});

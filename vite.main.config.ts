import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Ensure Node.js built-in modules are treated as external
    conditions: ['node'],
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5190, strictPort: true },
  preview: { port: 8750, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        lab: resolve(import.meta.dirname, 'lab.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
        cove: resolve(import.meta.dirname, 'cove.html'),
      },
    },
  },
});

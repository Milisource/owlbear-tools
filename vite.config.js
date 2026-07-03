import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    cors: true,
  },
  preview: {
    cors: true,
  },
  build: {
    outDir: 'dist',
    copyPublicDir: true,
  },
});

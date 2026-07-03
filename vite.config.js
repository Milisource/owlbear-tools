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
    cssMinify: 'esbuild',
    minify: 'esbuild',
    sourcemap: false,
    target: 'es2020',
    modulePreload: {
      polyfill: false,
    },
  },
});

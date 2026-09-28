import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages などのサブパスでも動くように相対パスで出力
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});

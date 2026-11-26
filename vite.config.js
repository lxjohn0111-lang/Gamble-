import { defineConfig } from 'vite';

// CrazyGames serves the build from a sub-path, so every asset URL must be relative.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: { host: true, port: 5173 },
});

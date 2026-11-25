import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The resident portal is its own app on its own origin (local: http://localhost:5174, production: resident.trynook.in).
// In development the Vite server proxies /api to the local API, so the browser sees one origin and the API sees the
// resident origin it is configured to allow (RESIDENT_WEB_ORIGIN).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  // Production output never ships source maps. (The dev server still serves them for local debugging.)
  build: { sourcemap: false },
});

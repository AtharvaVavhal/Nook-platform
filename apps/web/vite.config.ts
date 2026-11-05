import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { checkApiBase } from './src/apiBaseCheck';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const warning = checkApiBase(mode, env.VITE_API_BASE);
  if (warning) console.warn(`\n[nook] WARNING: ${warning}\n`);
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});

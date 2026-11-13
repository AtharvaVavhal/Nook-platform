import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { checkApiBase } from './src/apiBaseCheck';

export default defineConfig(({ mode }) => {
  // Disposable QA runs must not read local deployment configuration or secrets.
  const isolatedTest = process.env.NOOK_ISOLATED_TEST_RUN === '1';
  const env = isolatedTest
    ? { VITE_API_BASE: process.env.VITE_API_BASE }
    : loadEnv(mode, process.cwd(), 'VITE_');
  const warning = checkApiBase(mode, env.VITE_API_BASE);
  if (warning) console.warn(`\n[nook] WARNING: ${warning}\n`);
  return {
    ...(isolatedTest ? { envDir: false as const } : {}),
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

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.vite/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'prisma.config.ts', 'scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser globals are used inside page.evaluate callbacks that run in Chromium.
    files: ['scripts/verify_property_ui.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Brand and documentation render scripts. CommonJS, run with node directly.
    // Browser globals are used inside page.evaluate callbacks that run in Chromium.
    files: ['marketing/**/*.cjs', 'docs/assets/**/*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];

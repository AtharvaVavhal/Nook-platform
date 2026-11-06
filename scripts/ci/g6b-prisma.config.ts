import { defineConfig, env } from 'prisma/config';

// Only the wrapper supplies these variables. No dotenv, root config or runtime URL.
export default defineConfig({
  schema: '../../prisma/schema.prisma',
  migrations: { path: env('NOOK_CI_G6B_MIGRATIONS_DIR') },
  datasource: { url: env('MIGRATOR_DATABASE_URL') },
});

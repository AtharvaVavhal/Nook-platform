import { defineConfig, env } from 'prisma/config';

// migrate deploy reads only the staged foundation history; no dotenv or generated-client writes.
export default defineConfig({
  schema: '../../prisma/schema.prisma',
  migrations: { path: env('NOOK_CI_G6A_MIGRATIONS_DIR') },
  datasource: { url: env('DATABASE_URL') },
});

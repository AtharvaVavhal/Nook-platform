import { defineConfig } from 'prisma/config';

// Static schema validation only. Do not import the root config, which loads dotenv.
export default defineConfig({
  schema: '../../prisma/schema.prisma',
});

import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI (db pull / migrate dev / generate) reads DATABASE_URL from .env.
// The running API does not use this file: it derives the connection from
// ConnectionStrings__Default exactly like the .NET API (see src/config).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});

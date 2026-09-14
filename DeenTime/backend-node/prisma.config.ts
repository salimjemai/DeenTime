import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The Prisma CLI (db pull / migrate dev / generate) reads DATABASE_URL from .env.
// The running API does not use this file: it derives the connection from
// ConnectionStrings__Default exactly like the .NET API (see src/config).
//
// `prisma generate` never connects but prisma.config.ts is still evaluated, so an
// unset DATABASE_URL (CI, a fresh clone) falls back to the local default from
// .env.example instead of failing the build.
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/deentime';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL },
});

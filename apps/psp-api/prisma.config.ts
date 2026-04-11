import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `env('DATABASE_URL')` falla al cargar la config si falta la variable y rompe `prisma generate` sin `.env`.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

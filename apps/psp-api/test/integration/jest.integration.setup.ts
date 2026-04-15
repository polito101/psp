import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests. Set it in apps/psp-api/.env or the shell.',
  );
}

process.env.NODE_ENV ??= 'development';
process.env.INTERNAL_API_SECRET ??= 'integration-internal-secret';
process.env.APP_ENCRYPTION_KEY ??= 'integration-encryption-key-32-chars';
process.env.ENABLE_SWAGGER ??= 'false';
process.env.PAYMENTS_V2_ENABLED_MERCHANTS ??= '*';
process.env.PAYMENTS_PROVIDER_ORDER ??= 'mock,stripe';
process.env.PAYMENTS_ALLOW_MOCK ??= 'true';
process.env.WEBHOOK_WORKER_ENABLED ??= 'false';

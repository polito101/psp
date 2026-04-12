type EnvInput = Record<string, unknown>;

/**
 * Normaliza y valida variables de entorno críticas para evitar fallos tardíos.
 *
 * @param input Variables de entorno crudas.
 * @returns Variables normalizadas para `ConfigModule`.
 * @throws {Error} Si falta configuración crítica.
 */
export function validateEnv(input: EnvInput): EnvInput {
  const env = { ...input };

  const requiredVars = ['DATABASE_URL', 'INTERNAL_API_SECRET', 'APP_ENCRYPTION_KEY'];
  for (const key of requiredVars) {
    const value = getString(env[key]);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    env[key] = value;
  }

  const encryptionKey = getString(env.APP_ENCRYPTION_KEY) ?? '';
  if (encryptionKey.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must be at least 32 characters');
  }

  const nodeEnv = getString(env.NODE_ENV) ?? 'development';
  env.NODE_ENV = nodeEnv;

  const portRaw = getString(env.PORT) ?? '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be a valid integer between 1 and 65535');
  }
  env.PORT = String(port);

  const swaggerEnabled = parseBoolean(getString(env.ENABLE_SWAGGER), nodeEnv !== 'production');
  env.ENABLE_SWAGGER = String(swaggerEnabled);

  const corsAllowedOrigins = getString(env.CORS_ALLOWED_ORIGINS) ?? '';
  env.CORS_ALLOWED_ORIGINS = corsAllowedOrigins;

  if (nodeEnv === 'sandbox') {
    const redisUrl = getString(env.REDIS_URL);
    if (!redisUrl) {
      throw new Error('REDIS_URL is required when NODE_ENV=sandbox');
    }
    env.REDIS_URL = redisUrl;
  }

  return env;
}

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ENABLE_SWAGGER must be "true" or "false"');
}

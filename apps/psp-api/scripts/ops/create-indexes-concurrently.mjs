import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Índices creados por `prisma/ops/create-indexes-concurrently.sql`.
 * Tras cada pase se comprueba `pg_index.indisvalid`; índices inválidos se eliminan con
 * `DROP INDEX CONCURRENTLY` (acotado por `PSP_PRISMA_INDEX_LOCK_TIMEOUT`) y se reaplica el SQL sin backoff.
 * El contador de rondas de remediación solo avanza tras un DROP exitoso (fallos transitorios no consumen presupuesto).
 */
const CONCURRENT_INDEX_CHECKLIST = [
  {
    table: 'Payment',
    indexNames: [
      'Payment_selected_provider_provider_ref_idx',
      'Payment_status_currency_succeeded_at_idx',
    ],
  },
  {
    table: 'PaymentSettlement',
    indexNames: ['PaymentSettlement_provider_idx'],
  },
  {
    table: 'MerchantRateTable',
    indexNames: ['MerchantRateTable_provider_merchant_id_currency_idx'],
  },
  {
    table: 'merchant_onboarding_applications',
    indexNames: ['merchant_onboarding_applications_contact_email_key'],
  },
];

/** Límite superior para `PSP_PRISMA_INDEX_RETRIES` (evita backoff desmesurado). */
const MAX_PSP_PRISMA_INDEX_RETRIES = 20;
/** Límite superior para `PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS` (ms). */
const MAX_PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS = 300_000;
/** Límite superior para `PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS`. */
const MAX_PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS = 10;
/** Límite superior para `PSP_PRISMA_INDEX_LOCK_TIMEOUT` (ms). Evita `SET lock_timeout` excesivo en DROP concurrente. */
const MAX_PSP_PRISMA_INDEX_LOCK_TIMEOUT_MS = 120_000;
/**
 * Tope por iteración antes de `sleep()` ante overflow o exponencial muy alto (ms).
 */
const MAX_RETRY_SLEEP_MS = 600_000;

/**
 * Entero no negativo desde env (solo dígitos). Valores inválidos o fuera de rango seguro → error explícito.
 * Si `opts.max` está definido y el valor parseado lo supera, se usa `max` y se avisa por consola.
 *
 * @param {string} name
 * @param {number} fallback
 * @param {{ max?: number }} [opts]
 * @returns {number}
 */
function envNonNegativeInt(name, fallback, opts = {}) {
  const max = opts.max;
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return max !== undefined ? Math.min(fallback, max) : fallback;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return max !== undefined ? Math.min(fallback, max) : fallback;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${name} must be a non-negative integer (digits only). Received: ${raw}`,
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${name} must be a non-negative safe integer. Received: ${raw}`,
    );
  }
  if (max !== undefined && parsed > max) {
    // eslint-disable-next-line no-console
    console.warn(
      `[prisma:ops:indexes] ${name}=${parsed} exceeds configured maximum ${max}; using ${max}. See PROJECT_CONTEXT.md (repo root) for operational clamp limits.`,
    );
    return max;
  }
  return parsed;
}

/**
 * Milisegundos para `SET lock_timeout` en `DROP INDEX CONCURRENTLY`.
 * `0` en Postgres desactiva el timeout (riesgo de cuelgue); valores altos alargan demasiado el script.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envLockTimeoutMs(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return fallback;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${name} must be an integer value in milliseconds (for example, 15000). Received: ${raw}`,
    );
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative safe integer in milliseconds. Received: ${raw}`,
    );
  }
  if (parsed === 0) {
    throw new Error(
      `${name}=0 disables lock_timeout in PostgreSQL (waits indefinitely). Use a positive millisecond value (default ${fallback}). Received: ${raw}`,
    );
  }
  if (parsed > MAX_PSP_PRISMA_INDEX_LOCK_TIMEOUT_MS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[prisma:ops:indexes] ${name}=${parsed} exceeds configured maximum ${MAX_PSP_PRISMA_INDEX_LOCK_TIMEOUT_MS}ms; using ${MAX_PSP_PRISMA_INDEX_LOCK_TIMEOUT_MS}ms. See PROJECT_CONTEXT.md (repo root) for operational clamp limits.`,
    );
    return MAX_PSP_PRISMA_INDEX_LOCK_TIMEOUT_MS;
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  const factor = 0.8 + Math.random() * 0.4; // 0.8x..1.2x
  return Math.round(ms * factor);
}

/**
 * Loads `.env` from `cwd` when the `dotenv` package is available (local dev).
 * In production, env vars should already be set by the runtime (`DATABASE_URL`, `PSP_PRISMA_INDEX_*`).
 *
 * @param {string} cwd
 */
async function loadDotenvIfPresent(cwd) {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: join(cwd, '.env') });
  } catch {
    /* dotenv may be absent (e.g. `npm ci --omit=dev`); rely on process.env */
  }
}

/**
 * Splits a SQL script into statements for one-by-one execution.
 * `CREATE INDEX CONCURRENTLY` must not run inside a transaction; `prisma db execute`
 * wraps the whole file in a transaction, so we use `pg` with autocommit per query.
 *
 * @param {string} sql
 * @returns {string[]}
 */
function splitIntoSqlStatements(sql) {
  const withoutLineComments = sql.replace(/--[^\n]*/g, '\n');
  return withoutLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Prepends `SET lock_timeout` only immediately before `DROP INDEX CONCURRENTLY`.
 * Applying `lock_timeout` to `CREATE INDEX CONCURRENTLY` can abort mid-build and leave an
 * invalid index that `IF NOT EXISTS` will not recreate on retries.
 * After each `DROP`, runs `RESET lock_timeout` in case more statements are appended later.
 *
 * @param {string[]} statements
 * @param {number} lockTimeoutMs
 * @returns {string[]}
 */
function injectLockTimeoutForDropConcurrently(statements, lockTimeoutMs) {
  const out = [];
  for (const stmt of statements) {
    if (/^\s*DROP\s+INDEX\s+CONCURRENTLY\b/i.test(stmt)) {
      out.push(`SET lock_timeout = ${lockTimeoutMs}`);
      out.push(stmt);
      out.push('RESET lock_timeout');
    } else {
      out.push(stmt);
    }
  }
  return out;
}

/**
 * @param {string} connectionString
 * @param {string[]} statements
 */
async function runStatements(connectionString, statements) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
  } finally {
    await client.end();
  }
}

/** Prefijos detectados en `main()` para abortar sin backoff ni reintentos. */
const FAIL_FAST_MISSING = '[prisma:ops:indexes:missing]';
const FAIL_FAST_REMEDIATION = '[prisma:ops:indexes:remediation-exhausted]';

/**
 * Comprueba presencia y validez (`pg_index.indisvalid`) de los índices del checklist.
 *
 * @param {string} connectionString
 * @param {readonly { table: string; indexNames: readonly string[] }[]} checklist
 * @returns {Promise<{ missing: { table: string; indexName: string }[]; invalid: { table: string; indexName: string }[] }>}
 */
async function validateConcurrentIndexes(connectionString, checklist) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    /** @type {{ table: string; indexName: string }[]} */
    const missing = [];
    /** @type {{ table: string; indexName: string }[]} */
    const invalid = [];

    for (const { table, indexNames } of checklist) {
      const res = await client.query(
        `SELECT i.relname AS index_name, idx.indisvalid AS is_valid
         FROM pg_index idx
         INNER JOIN pg_class i ON i.oid = idx.indexrelid
         INNER JOIN pg_class c ON c.oid = idx.indrelid
         WHERE c.relname = $1
           AND i.relname = ANY($2::text[])`,
        [table, indexNames],
      );
      const byName = new Map(res.rows.map((r) => [r.index_name, r]));
      for (const name of indexNames) {
        const row = byName.get(name);
        if (!row) {
          missing.push({ table, indexName: name });
        } else if (!row.is_valid) {
          invalid.push({ table, indexName: name });
        }
      }
    }

    return { missing, invalid };
  } finally {
    await client.end();
  }
}

/**
 * Ejecuta `DROP INDEX CONCURRENTLY IF EXISTS` por cada entrada, con `lock_timeout` como en el SQL principal.
 *
 * @param {string} connectionString
 * @param {readonly { table: string; indexName: string }[]} indexes
 * @param {number} lockTimeoutMs
 */
async function dropIndexesConcurrently(connectionString, indexes, lockTimeoutMs) {
  if (indexes.length === 0) {
    return;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const { indexName, table } of indexes) {
      await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${quotePgIdentifier(indexName)}`);
      await client.query('RESET lock_timeout');
      // eslint-disable-next-line no-console
      console.warn(
        `[prisma:ops:indexes] dropped invalid concurrent index "${indexName}" (table "${table}") for rebuild on next pass.`,
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Cita un identificador para DDL PostgreSQL (solo caracteres seguros en nombres de índice del checklist).
 *
 * @param {string} name
 */
function quotePgIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const cwd = process.cwd();
  await loadDotenvIfPresent(cwd);

  const lockTimeoutMs = envLockTimeoutMs('PSP_PRISMA_INDEX_LOCK_TIMEOUT', 15000);
  const retries = envNonNegativeInt('PSP_PRISMA_INDEX_RETRIES', 6, {
    max: MAX_PSP_PRISMA_INDEX_RETRIES,
  });
  const baseDelayMs = envNonNegativeInt(
    'PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS',
    1000,
    { max: MAX_PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS },
  );
  const maxRemediation = envNonNegativeInt(
    'PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS',
    3,
    { max: MAX_PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS },
  );

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      '[prisma:ops:indexes] DATABASE_URL is not set. Define it in the environment or in apps/psp-api/.env for local runs.',
    );
  }

  const sourceSqlPath = join(cwd, 'prisma', 'ops', 'create-indexes-concurrently.sql');
  const sourceSql = await readFile(sourceSqlPath, 'utf8');
  const statements = injectLockTimeoutForDropConcurrently(
    splitIntoSqlStatements(sourceSql),
    lockTimeoutMs,
  );

  let attempt = 0;
  let remediationRound = 0;
  // Retries help with transient lock contention (mainly on DROP INDEX CONCURRENTLY).
  // Bounded budget so persistent lock issues are not masked forever.
  // Índices con indisvalid=false: DROP controlado + nuevo pase inmediato (sin backoff); presupuesto de rondas solo tras DROP OK.
  while (true) {
    try {
      await runStatements(databaseUrl, statements);

      const { missing, invalid } = await validateConcurrentIndexes(
        databaseUrl,
        CONCURRENT_INDEX_CHECKLIST,
      );

      if (missing.length > 0) {
        const detail = missing.map((m) => `"${m.indexName}" on "${m.table}"`).join('; ');
        throw new Error(
          `${FAIL_FAST_MISSING} expected index(es) not found after script run: ${detail}.`,
        );
      }

      if (invalid.length > 0) {
        if (remediationRound >= maxRemediation) {
          const detail = invalid.map((m) => `"${m.indexName}"@${m.table}`).join(', ');
          throw new Error(
            `${FAIL_FAST_REMEDIATION} invalid indexes persist after ${maxRemediation} DROP/rebuild attempt(s): ${detail}.`,
          );
        }
        const remediationAttempt = remediationRound + 1;
        // eslint-disable-next-line no-console
        console.warn(
          `[prisma:ops:indexes] invalid concurrent indexes (indisvalid=false): ${invalid
            .map((m) => `"${m.indexName}"@${m.table}`)
            .join(', ')} — dropping with CONCURRENTLY and rebuilding (remediation ${remediationAttempt}/${maxRemediation}).`,
        );
        await dropIndexesConcurrently(databaseUrl, invalid, lockTimeoutMs);
        // Solo cuenta una ronda tras DROP exitoso; si falla (locks/conexión), el retry no consume presupuesto.
        remediationRound += 1;
        continue;
      }

      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(FAIL_FAST_MISSING) || message.includes(FAIL_FAST_REMEDIATION)) {
        throw error;
      }
      // eslint-disable-next-line no-console
      console.warn(`[prisma:ops:indexes] ${message}`);
    }

    attempt += 1;
    if (attempt > retries) {
      throw new Error(`[prisma:ops:indexes] failed after ${retries} retries.`);
    }

    const rawDelayMs = jitter(baseDelayMs * Math.pow(2, attempt - 1));
    const delayMs = Math.min(rawDelayMs, MAX_RETRY_SLEEP_MS);
    // eslint-disable-next-line no-console
    console.warn(
      `[prisma:ops:indexes] attempt ${attempt}/${retries} failed; retrying in ${delayMs}ms...`,
    );
    await sleep(delayMs);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[prisma:ops:indexes] fatal error', err);
  process.exit(1);
});

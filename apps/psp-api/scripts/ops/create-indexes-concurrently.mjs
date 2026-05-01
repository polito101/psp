import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Índices creados por `prisma/ops/create-indexes-concurrently.sql`.
 * Tras un pase correcto se comprueba `pg_index.indisvalid` por tabla para detectar builds concurrentes abortados.
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

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envLockTimeoutMs(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${name} must be an integer value in milliseconds (for example, 15000). Received: ${raw}`,
    );
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative safe integer in milliseconds. Received: ${raw}`,
    );
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
 * In production, `DATABASE_URL` should already be set by the runtime.
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

/**
 * @param {string} connectionString
 * @param {readonly { table: string; indexNames: readonly string[] }[]} checklist
 */
async function assertConcurrentIndexesValid(connectionString, checklist) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
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
          throw new Error(
            `[prisma:ops:indexes] expected index "${name}" on "${table}" not found after script run.`,
          );
        }
        if (!row.is_valid) {
          throw new Error(
            `[prisma:ops:indexes] index "${name}" on "${table}" exists but is invalid (indisvalid=false). ` +
              `Drop it with DROP INDEX CONCURRENTLY and re-run this script.`,
          );
        }
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const lockTimeoutMs = envLockTimeoutMs('PSP_PRISMA_INDEX_LOCK_TIMEOUT', 15000);
  const retries = envInt('PSP_PRISMA_INDEX_RETRIES', 6);
  const baseDelayMs = envInt('PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS', 1000);

  const cwd = process.cwd();
  await loadDotenvIfPresent(cwd);

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
  // Retries help with transient lock contention (mainly on DROP INDEX CONCURRENTLY).
  // Bounded budget so persistent lock issues are not masked forever.
  while (true) {
    try {
      await runStatements(databaseUrl, statements);
      await assertConcurrentIndexesValid(databaseUrl, CONCURRENT_INDEX_CHECKLIST);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.warn(`[prisma:ops:indexes] ${message}`);
    }

    attempt += 1;
    if (attempt > retries) {
      throw new Error(`[prisma:ops:indexes] failed after ${retries} retries.`);
    }

    const delayMs = jitter(baseDelayMs * Math.pow(2, attempt - 1));
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

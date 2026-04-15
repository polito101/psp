import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  const factor = 0.8 + Math.random() * 0.4; // 0.8x..1.2x
  return Math.round(ms * factor);
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const lockTimeout = process.env.PSP_PRISMA_INDEX_LOCK_TIMEOUT ?? '15s';
  const retries = envInt('PSP_PRISMA_INDEX_RETRIES', 6);
  const baseDelayMs = envInt('PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS', 1000);

  const cwd = process.cwd();
  const sourceSqlPath = join(cwd, 'prisma', 'ops', 'create-indexes-concurrently.sql');
  const sourceSql = await readFile(sourceSqlPath, 'utf8');
  const finalSql = `SET lock_timeout = '${lockTimeout}';\n\n${sourceSql}`;

  const tmpBase = await mkdtemp(join(tmpdir(), 'psp-indexes-'));
  const tmpSqlPath = join(tmpBase, 'create-indexes-concurrently.sql');
  await writeFile(tmpSqlPath, finalSql, 'utf8');

  try {
    let attempt = 0;
    // Retries help with transient lock contention during deploys.
    // We keep a bounded budget to avoid masking persistent lock issues forever.
    while (true) {
      const exitCode = await run(
        'npx',
        [
          'prisma',
          'db',
          'execute',
          '--schema',
          'prisma/schema.prisma',
          '--file',
          tmpSqlPath,
        ],
        { cwd }
      );

      if (exitCode === 0) return;

      attempt += 1;
      if (attempt > retries) process.exit(exitCode);

      const delayMs = jitter(baseDelayMs * Math.pow(2, attempt - 1));
      // eslint-disable-next-line no-console
      console.warn(
        `[prisma:ops:indexes] attempt ${attempt}/${retries} failed (exit ${exitCode}); retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[prisma:ops:indexes] fatal error', err);
  process.exit(1);
});


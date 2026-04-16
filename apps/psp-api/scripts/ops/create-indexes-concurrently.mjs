import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

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
      `${name} must be an integer value in milliseconds (for example, 15000). Received: ${raw}`
    );
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative safe integer in milliseconds. Received: ${raw}`
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
 * Resolves the Prisma CLI entrypoint for `spawn` without a shell.
 * On Windows, `spawn('prisma', …)` often fails with ENOENT because Node does not
 * resolve npm `.cmd` shims the way cmd/PowerShell does.
 */
function resolvePrismaCliEntrypoint() {
  const require = createRequire(import.meta.url);
  const prismaPkgJson = require.resolve('prisma/package.json');
  return join(dirname(prismaPkgJson), 'build', 'index.js');
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
    child.on('error', (error) => {
      const spawnError = new Error(`Failed to start command "${cmd}": ${error.message}`);
      spawnError.cause = error;
      spawnError.exitCode = 1;
      reject(spawnError);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const lockTimeoutMs = envLockTimeoutMs('PSP_PRISMA_INDEX_LOCK_TIMEOUT', 15000);
  const retries = envInt('PSP_PRISMA_INDEX_RETRIES', 6);
  const baseDelayMs = envInt('PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS', 1000);

  const cwd = process.cwd();
  const prismaCli = resolvePrismaCliEntrypoint();
  const sourceSqlPath = join(cwd, 'prisma', 'ops', 'create-indexes-concurrently.sql');
  const sourceSql = await readFile(sourceSqlPath, 'utf8');
  const finalSql = `SET lock_timeout = ${lockTimeoutMs};\n\n${sourceSql}`;

  const tmpBase = await mkdtemp(join(tmpdir(), 'psp-indexes-'));
  const tmpSqlPath = join(tmpBase, 'create-indexes-concurrently.sql');
  await writeFile(tmpSqlPath, finalSql, 'utf8');

  try {
    let attempt = 0;
    // Retries help with transient lock contention during deploys.
    // We keep a bounded budget to avoid masking persistent lock issues forever.
    while (true) {
      let exitCode = 1;
      try {
        exitCode = await run(
          process.execPath,
          [prismaCli, 'db', 'execute', '--file', tmpSqlPath],
          { cwd }
        );
      } catch (error) {
        const maybeExitCode = Number(error?.exitCode);
        exitCode = Number.isInteger(maybeExitCode) && maybeExitCode > 0 ? maybeExitCode : 1;
        // eslint-disable-next-line no-console
        console.warn(`[prisma:ops:indexes] unable to start prisma command: ${error.message}`);
      }

      if (exitCode === 0) return;

      attempt += 1;
      if (attempt > retries) {
        throw new Error(
          `[prisma:ops:indexes] failed after ${retries} retries (exit ${exitCode}).`
        );
      }

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


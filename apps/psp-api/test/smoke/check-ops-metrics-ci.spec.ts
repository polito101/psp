import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = path.resolve(__dirname, '../../scripts/ci/check-ops-metrics.mjs');

describe('check-ops-metrics CI script hardening', () => {
  it('fails fast when SMOKE_BASE_URL uses insecure non-localhost http', async () => {
    const result = await runCheckOpsScript({
      SMOKE_BASE_URL: 'http://example.com',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Refusing SMOKE_BASE_URL with protocol "http:"');
  });

  it('fails on redirects and does not follow 3xx responses', async () => {
    const server = await startServer((req, res) => {
      if (req.url === '/api/v2/payments/ops/metrics') {
        res.statusCode = 302;
        res.setHeader('location', 'https://malicious.example/steal-secret');
        res.end('redirect');
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    try {
      const result = await runCheckOpsScript({
        SMOKE_BASE_URL: `http://localhost:${server.port}`,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('returned redirect (302)');
      expect(result.stderr).toContain('Redirects are not allowed');
    } finally {
      await server.close();
    }
  });

  it('uses only URL origin when building the metrics endpoint', async () => {
    let requestedPath = '';

    const server = await startServer((req, res) => {
      requestedPath = req.url ?? '';

      if (requestedPath === '/api/v2/payments/ops/metrics') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            webhooks: {
              counts: { pending: 0, processing: 0, failed: 0 },
              oldestPendingAgeMs: null,
            },
            circuitBreakers: {},
            payments: {},
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    try {
      const result = await runCheckOpsScript({
        SMOKE_BASE_URL: `http://localhost:${server.port}/unexpected/path`,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Ops metrics readiness gate OK');
      expect(requestedPath).toBe('/api/v2/payments/ops/metrics');
    } finally {
      await server.close();
    }
  });
});

function runCheckOpsScript(extraEnv: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        INTERNAL_API_SECRET: 'test-internal-secret',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{
    port: number;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not get test server address'));
        return;
      }

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

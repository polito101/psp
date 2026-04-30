import { defineConfig, devices } from "@playwright/test";

/**
 * Secreto por defecto solo para CI/local cuando no hay env (coincide con `e2e/auth-and-rbac.spec.ts`).
 * En CI se sobrescribe vía `env` del job.
 */
const devDefaults = {
  PSP_API_BASE_URL: "http://127.0.0.1:3003",
  BACKOFFICE_SESSION_JWT_SECRET: "session-jwt-secret-dev-only-32b",
  BACKOFFICE_ADMIN_SECRET: "admin-secret",
  PSP_INTERNAL_API_SECRET: "internal-only",
  BACKOFFICE_MERCHANT_PORTAL_SECRET: "portal-hmac-secret-32bytes!!",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3005",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3005/login",
    /** En local suele haber `next dev` en 3005; en CI el puerto está libre. */
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PSP_API_BASE_URL: process.env.PSP_API_BASE_URL ?? devDefaults.PSP_API_BASE_URL,
      BACKOFFICE_SESSION_JWT_SECRET:
        process.env.BACKOFFICE_SESSION_JWT_SECRET ?? devDefaults.BACKOFFICE_SESSION_JWT_SECRET,
      BACKOFFICE_ADMIN_SECRET: process.env.BACKOFFICE_ADMIN_SECRET ?? devDefaults.BACKOFFICE_ADMIN_SECRET,
      PSP_INTERNAL_API_SECRET: process.env.PSP_INTERNAL_API_SECRET ?? devDefaults.PSP_INTERNAL_API_SECRET,
      BACKOFFICE_MERCHANT_PORTAL_SECRET:
        process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET ?? devDefaults.BACKOFFICE_MERCHANT_PORTAL_SECRET,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

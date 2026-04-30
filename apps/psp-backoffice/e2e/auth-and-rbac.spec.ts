import { expect, test } from "@playwright/test";

/** Debe coincidir con el fallback de `playwright.config.ts`. */
const ADMIN_SECRET =
  process.env.BACKOFFICE_ADMIN_SECRET ??
  process.env.E2E_BACKOFFICE_ADMIN_SECRET ??
  "admin-secret";

test("usuario sin sesión va a login desde transacciones", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login$/);
});

test("admin puede iniciar sesión y abrir merchants", async ({ page, context }) => {
  await context.clearCookies();
  const res = await page.request.post("/api/auth/session", {
    data: { mode: "admin", token: ADMIN_SECRET },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/merchants");
  await expect(page).toHaveURL(/\/merchants$/);
});

import { expect, test } from "@playwright/test";

/** Debe coincidir con el fallback de `playwright.config.ts`. */
const ADMIN_SECRET =
  process.env.BACKOFFICE_ADMIN_SECRET ??
  process.env.E2E_BACKOFFICE_ADMIN_SECRET ??
  "admin-secret";

test("usuario sin sesión va a login desde transacciones", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("admin puede iniciar sesión y abrir merchants", async ({ page, context }) => {
  await context.clearCookies();
  const res = await page.request.post("/api/auth/session", {
    data: { mode: "admin", token: ADMIN_SECRET },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok()).toBeTruthy();

  const directoryResponsePromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/internal/merchants/ops/directory") && r.request().method() === "GET",
    { timeout: 25_000 },
  );
  await page.goto("/merchants");
  const directoryResponse = await directoryResponsePromise;
  expect(directoryResponse.status()).toBe(200);

  await expect(page).toHaveURL(/\/merchants$/);
  await expect(page.getByRole("columnheader", { name: "Nombre" })).toBeVisible();

  const adminLink = page.getByRole("link", { name: "Admin" }).first();
  await expect(adminLink).toBeVisible({ timeout: 15_000 });
  await adminLink.click();
  await page.waitForURL(/\/merchants\/[^/]+\/admin\/?$/);
  await expect(page.getByRole("heading", { name: "Edit Merchant" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Application Form" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Provider rates" })).toBeVisible();
  await page.getByRole("button", { name: "Provider rates" }).click();
  await expect(page.getByText("Tarifas por proveedor y país")).toBeVisible();
});

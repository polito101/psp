# Merchant Login Email+Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar el login merchant a `email + password` con envío de credenciales al crear solicitud y bloqueo total del portal para merchants no `ACTIVE`.

**Architecture:** La autenticación merchant se valida en `psp-api` mediante endpoint interno protegido por `X-Internal-Secret`; `psp-backoffice` delega login merchant a ese endpoint y firma JWT de sesión con estado de onboarding. El bloqueo se aplica en doble capa: navegación (`proxy.ts`) y BFF (`/api/internal/*`) con `403` para merchants no activos.

**Tech Stack:** NestJS 11 + Prisma 7 + Jest (`apps/psp-api`), Next.js 16 + Route Handlers + JOSE + Vitest (`apps/psp-backoffice`).

---

## File Structure

- **Create:** `apps/psp-api/prisma/migrations/20260504110000_merchant_portal_password_hash/migration.sql`
- **Modify:** `apps/psp-api/prisma/schema.prisma`
- **Modify:** `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`
- **Modify:** `apps/psp-api/src/merchant-onboarding/onboarding-email.service.ts`
- **Modify:** `apps/psp-api/src/merchant-onboarding/merchant-onboarding-ops.controller.ts`
- **Modify:** `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`
- **Modify:** `apps/psp-api/src/merchant-onboarding/onboarding-email.service.spec.ts`
- **Create:** `apps/psp-api/src/merchant-onboarding/dto/merchant-portal-login.dto.ts`
- **Modify:** `apps/psp-backoffice/src/lib/server/auth/session-claims.ts`
- **Modify:** `apps/psp-backoffice/src/lib/session-types.ts`
- **Modify:** `apps/psp-backoffice/src/lib/server/read-layout-session.ts`
- **Modify:** `apps/psp-backoffice/src/lib/server/internal-route-auth.ts`
- **Modify:** `apps/psp-backoffice/src/app/api/auth/session/route.ts`
- **Modify:** `apps/psp-backoffice/src/app/api/auth/session/route.spec.ts`
- **Modify:** `apps/psp-backoffice/src/app/login/page.tsx`
- **Modify:** `apps/psp-backoffice/src/proxy.ts`
- **Modify:** `apps/psp-backoffice/src/proxy.spec.ts`
- **Create:** `apps/psp-backoffice/src/app/merchant-status/page.tsx`
- **Modify:** `apps/psp-backoffice/src/components/app-shell.tsx`
- **Modify:** `apps/psp-backoffice/src/lib/server/internal-route-scope.ts`
- **Modify:** `apps/psp-backoffice/src/lib/server/internal-route-auth.spec.ts`
- **Modify:** `PROJECT_CONTEXT.md`
- **Modify:** `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- **Modify:** `docs/testing-status.md`

---

### Task 1: Persistir contraseña inicial y enviarla en email de onboarding

**Files:**
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/onboarding-email.service.spec.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/onboarding-email.service.ts`
- Modify: `apps/psp-api/prisma/schema.prisma`
- Create: `apps/psp-api/prisma/migrations/20260504110000_merchant_portal_password_hash/migration.sql`

- [ ] **Step 1: Write failing service test for password generation/persistence**

```ts
it('stores merchant portal password hash when creating an onboarding application', async () => {
  // ...setup...
  await service.createApplication({ name: 'Ada', email: 'ada@example.com', phone: '+34600000000' });

  expect(tx.merchant.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      merchantPortalPasswordHash: expect.any(String),
    }),
  });
});
```

- [ ] **Step 2: Write failing email test for onboarding credentials payload**

```ts
expect(emailService.sendOnboardingLink).toHaveBeenCalledWith({
  to: 'ada@example.com',
  contactName: 'Ada Lovelace',
  onboardingUrl: 'https://onboarding.example.com/onboarding/plain_token',
  loginEmail: 'ada@example.com',
  initialPassword: expect.any(String),
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/onboarding-email.service.spec.ts`  
Expected: FAIL por campos/tipos inexistentes (`merchantPortalPasswordHash`, `loginEmail`, `initialPassword`).

- [ ] **Step 4: Add Prisma field and migration (minimal DB change)**

```prisma
model Merchant {
  // ...
  merchantPortalPasswordHash String? @map("merchant_portal_password_hash")
}
```

```sql
ALTER TABLE "Merchant"
ADD COLUMN "merchant_portal_password_hash" TEXT;
```

- [ ] **Step 5: Implement password generation + hash persistence in onboarding service**

```ts
const initialPassword = randomBytes(18).toString('base64url');
const merchantPortalPasswordHash = await bcrypt.hash(initialPassword, 12);

const merchant = await tx.merchant.create({
  data: {
    name: dto.name,
    apiKeyHash: placeholderHash,
    webhookSecretCiphertext,
    merchantPortalPasswordHash,
    isActive: false,
    deactivatedAt: now,
  },
});
```

- [ ] **Step 6: Extend onboarding email contract/template**

```ts
export type SendOnboardingEmailInput = {
  to: string;
  contactName: string;
  onboardingUrl: string;
  loginEmail: string;
  initialPassword: string;
};
```

```ts
text:
  `Hola ${input.contactName},\n\n` +
  `Acceso portal merchant:\n` +
  `Email: ${input.loginEmail}\n` +
  `Contraseña: ${input.initialPassword}\n\n` +
  `Completa onboarding en: ${input.onboardingUrl}`,
```

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/onboarding-email.service.spec.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/psp-api/prisma/schema.prisma apps/psp-api/prisma/migrations apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts apps/psp-api/src/merchant-onboarding/onboarding-email.service.ts apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts apps/psp-api/src/merchant-onboarding/onboarding-email.service.spec.ts
git commit -m "feat(api): generate merchant login password in onboarding creation"
```

---

### Task 2: Exponer endpoint interno API para login merchant por email+password

**Files:**
- Create: `apps/psp-api/src/merchant-onboarding/dto/merchant-portal-login.dto.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding-ops.controller.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`

- [ ] **Step 1: Write failing tests for login validation service**

```ts
it('authenticates merchant by contact email and password hash', async () => {
  prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({
    merchantId: 'm_1',
    status: 'DOCUMENTATION_PENDING',
    rejectionReason: null,
    merchant: { merchantPortalPasswordHash: await bcrypt.hash('Secret123!', 12) },
  });

  await expect(service.validateMerchantPortalLogin('ada@example.com', 'Secret123!')).resolves.toEqual({
    merchantId: 'm_1',
    onboardingStatus: 'DOCUMENTATION_PENDING',
    rejectionReason: null,
  });
});
```

- [ ] **Step 2: Write failing controller test for internal endpoint**

```ts
// POST /api/v1/merchant-onboarding/ops/merchant-login
// expects InternalSecretGuard + 200/401 behavior
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/merchant-onboarding.controller.spec.ts`  
Expected: FAIL por método/controlador/DTO inexistentes.

- [ ] **Step 4: Create DTO + controller route**

```ts
export class MerchantPortalLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
```

```ts
@Post('merchant-login')
loginMerchant(@Body() dto: MerchantPortalLoginDto) {
  return this.service.validateMerchantPortalLogin(dto.email, dto.password);
}
```

- [ ] **Step 5: Implement service authentication logic**

```ts
const application = await this.prisma.merchantOnboardingApplication.findFirst({
  where: { contactEmail: normalizeEmail(email) },
  orderBy: { createdAt: 'desc' },
  select: {
    merchantId: true,
    status: true,
    rejectionReason: true,
    merchant: { select: { merchantPortalPasswordHash: true } },
  },
});

if (!application?.merchant?.merchantPortalPasswordHash) {
  throw new UnauthorizedException('Invalid credentials');
}
const ok = await bcrypt.compare(password, application.merchant.merchantPortalPasswordHash);
if (!ok) throw new UnauthorizedException('Invalid credentials');
```

- [ ] **Step 6: Run tests to verify GREEN**

Run: `npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/merchant-onboarding.controller.spec.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/psp-api/src/merchant-onboarding/dto/merchant-portal-login.dto.ts apps/psp-api/src/merchant-onboarding/merchant-onboarding-ops.controller.ts apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts
git commit -m "feat(api): add internal merchant login validation endpoint"
```

---

### Task 3: Migrar backoffice login merchant a email+password y ampliar claims

**Files:**
- Modify: `apps/psp-backoffice/src/lib/server/auth/session-claims.ts`
- Modify: `apps/psp-backoffice/src/lib/session-types.ts`
- Modify: `apps/psp-backoffice/src/lib/server/read-layout-session.ts`
- Modify: `apps/psp-backoffice/src/app/api/auth/session/route.ts`
- Modify: `apps/psp-backoffice/src/app/api/auth/session/route.spec.ts`
- Modify: `apps/psp-backoffice/src/app/login/page.tsx`

- [ ] **Step 1: Write failing tests for new merchant login body**

```ts
body: JSON.stringify({ mode: "merchant", email: "ada@example.com", password: "Secret123!" })
// expect 200 + JWT payload includes onboardingStatus
```

- [ ] **Step 2: Write failing tests for claims validation parsing**

```ts
expect(() =>
  validateSessionClaims({
    sub: "merchant:m1",
    role: "merchant",
    merchantId: "m1",
    onboardingStatus: "REJECTED",
    rejectionReason: "Missing docs",
  }),
).not.toThrow();
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- src/app/api/auth/session/route.spec.ts src/lib/server/internal-route-auth.spec.ts`  
Expected: FAIL por shape antigua de merchant login y claims incompletos.

- [ ] **Step 4: Extend session claims/session types**

```ts
type MerchantOnboardingStatus = "DOCUMENTATION_PENDING" | "IN_REVIEW" | "ACTIVE" | "REJECTED";

export type SessionClaims =
  | { sub: string; role: "admin" }
  | {
      sub: string;
      role: "merchant";
      merchantId: string;
      onboardingStatus: MerchantOnboardingStatus;
      rejectionReason?: string | null;
    };
```

- [ ] **Step 5: Replace merchant credential validation in session route**

```ts
const upstream = await proxyInternalPost<{
  merchantId: string;
  onboardingStatus: MerchantOnboardingStatus;
  rejectionReason: string | null;
}>({
  path: "/api/v1/merchant-onboarding/ops/merchant-login",
  body: { email: data.email.trim(), password: data.password },
});
```

```ts
jwt = await signSession(
  {
    sub: `merchant:${upstream.merchantId}`,
    role: "merchant",
    merchantId: upstream.merchantId,
    onboardingStatus: upstream.onboardingStatus,
    rejectionReason: upstream.rejectionReason,
  },
  jwtSecret,
);
```

- [ ] **Step 6: Update login UI inputs/copy**

```tsx
<input id="email" type="email" autoComplete="email" required />
<input id="password" type="password" autoComplete="current-password" required />
```

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npm run test -- src/app/api/auth/session/route.spec.ts src/lib/server/internal-route-auth.spec.ts src/proxy.spec.ts`  
Expected: PASS (con ajustes mínimos en fixtures legacy).

- [ ] **Step 8: Commit**

```bash
git add apps/psp-backoffice/src/lib/server/auth/session-claims.ts apps/psp-backoffice/src/lib/session-types.ts apps/psp-backoffice/src/lib/server/read-layout-session.ts apps/psp-backoffice/src/app/api/auth/session/route.ts apps/psp-backoffice/src/app/api/auth/session/route.spec.ts apps/psp-backoffice/src/app/login/page.tsx
git commit -m "feat(backoffice): switch merchant login to email and password"
```

---

### Task 4: Enforzar bloqueo total para merchants no ACTIVE (proxy + BFF + pantalla)

**Files:**
- Create: `apps/psp-backoffice/src/app/merchant-status/page.tsx`
- Modify: `apps/psp-backoffice/src/proxy.ts`
- Modify: `apps/psp-backoffice/src/proxy.spec.ts`
- Modify: `apps/psp-backoffice/src/lib/server/internal-route-auth.ts`
- Modify: `apps/psp-backoffice/src/lib/server/internal-route-scope.ts`
- Modify: `apps/psp-backoffice/src/components/app-shell.tsx`

- [ ] **Step 1: Write failing proxy test for non-active merchant redirect**

```ts
it("redirects non-active merchant to /merchant-status", async () => {
  const jwt = await signSession({
    sub: "merchant:m1",
    role: "merchant",
    merchantId: "m1",
    onboardingStatus: "IN_REVIEW",
    rejectionReason: null,
  }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
  // expect redirect to /merchant-status
});
```

- [ ] **Step 2: Write failing BFF auth test for non-active merchant**

```ts
it("returns 403 for merchant internal route when onboardingStatus is not ACTIVE", async () => {
  // enforceInternalRouteAuth should return { ok: false, response: 403 }
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- src/proxy.spec.ts src/lib/server/internal-route-auth.spec.ts`  
Expected: FAIL.

- [ ] **Step 4: Implement status gating in internal auth**

```ts
if (claims.role === "merchant" && claims.onboardingStatus !== "ACTIVE") {
  return {
    ok: false,
    response: NextResponse.json({ message: "Merchant onboarding is not active" }, { status: 403 }),
  };
}
```

- [ ] **Step 5: Implement status gating in proxy + dedicated status page**

```ts
const isMerchantStatusRoute = pathname === "/merchant-status";
if (session?.role === "merchant" && session.onboardingStatus !== "ACTIVE" && !isMerchantStatusRoute) {
  return NextResponse.redirect(new URL("/merchant-status", req.nextUrl));
}
```

```tsx
// /merchant-status page
const isRejected = session?.role === "merchant" && session.onboardingStatus === "REJECTED";
const message = isRejected
  ? `Rechazado por el siguiente motivo: ${session.rejectionReason ?? "no especificado"}`
  : "Pendiente de revisión de documentación";
```

- [ ] **Step 6: Keep AppShell out of blocked route**

```tsx
if (pathname === "/merchant-status") {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
```

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npm run test -- src/proxy.spec.ts src/lib/server/internal-route-auth.spec.ts src/app/api/internal/transactions/route.spec.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/psp-backoffice/src/app/merchant-status/page.tsx apps/psp-backoffice/src/proxy.ts apps/psp-backoffice/src/proxy.spec.ts apps/psp-backoffice/src/lib/server/internal-route-auth.ts apps/psp-backoffice/src/lib/server/internal-route-scope.ts apps/psp-backoffice/src/components/app-shell.tsx
git commit -m "feat(backoffice): enforce full lock for non-active merchants"
```

---

### Task 5: Cierre de documentación SSOT y verificación final

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- Modify: `docs/testing-status.md`

- [ ] **Step 1: Update monorepo context**

```md
- Merchant portal login migrado a email+password (sin compatibilidad con token HMAC legacy).
- API interna `merchant-onboarding/ops/merchant-login` valida credenciales y devuelve onboarding status.
```

- [ ] **Step 2: Update backoffice local context**

```md
- `/login` merchant usa `email + password`.
- Merchants no `ACTIVE` se redirigen a `/merchant-status` y no acceden a `/api/internal/*`.
```

- [ ] **Step 3: Update testing status doc with new coverage**

```md
- Añadidas pruebas: login merchant email/password, claims con onboardingStatus, bloqueo proxy y bloqueo BFF para merchants no activos.
```

- [ ] **Step 4: Run focused verification suites**

Run: `npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/merchant-onboarding.controller.spec.ts` (en `apps/psp-api`)  
Expected: PASS.

Run: `npm run test -- src/app/api/auth/session/route.spec.ts src/proxy.spec.ts src/lib/server/internal-route-auth.spec.ts` (en `apps/psp-backoffice`)  
Expected: PASS.

- [ ] **Step 5: Run safety gates**

Run: `npm run lint` (en `apps/psp-api`)  
Expected: exit 0.

Run: `npm run lint && npm run typecheck` (en `apps/psp-backoffice`)  
Expected: exit 0.

- [ ] **Step 6: Final commit**

```bash
git add PROJECT_CONTEXT.md apps/psp-backoffice/BACKOFFICE_CONTEXT.md docs/testing-status.md
git commit -m "docs: align context and test status for merchant auth migration"
```


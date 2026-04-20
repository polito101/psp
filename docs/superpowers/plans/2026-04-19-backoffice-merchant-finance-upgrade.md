# Backoffice Merchant Finance Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al merchant una vista financiera completa en backoffice: transacciones operativas + desglose bruto/comisión/neto + estado de settlements/payouts por moneda.

**Architecture:** Se amplía la superficie interna de `psp-api` con endpoints read-only de finanzas por merchant (resumen, transacciones con fee quote y settlements/payouts). El backoffice mantiene patrón BFF (`/api/internal/*`) para no exponer secretos y agrega una nueva pantalla `merchant finance` consumiendo esos contratos. Se implementa en TDD: primero tests de API/BFF/UI, luego código mínimo para pasar.

**Tech Stack:** NestJS 11, Prisma 7, Next.js 16 App Router, React Query 5, Vitest, Jest/Supertest, TypeScript estricto.

---

## Estructura de archivos objetivo

### API (`apps/psp-api`)

- **Modificar:** `src/payments-v2/payments-v2-internal.controller.ts`
  - Exponer endpoints internos de finanzas de merchant bajo `/api/v2/payments/ops/merchants/:merchantId/finance/*`.
- **Modificar:** `src/payments-v2/payments-v2.service.ts`
  - Implementar queries agregadas para `summary`, `transactions` (con gross/fee/net) y `payouts`.
- **Crear:** `src/payments-v2/dto/ops-merchant-finance-summary-query.dto.ts`
  - Validar parámetros de rango/currency/provider para resumen.
- **Crear:** `src/payments-v2/dto/ops-merchant-finance-transactions-query.dto.ts`
  - Validar filtros y cursor para listado financiero.
- **Crear:** `src/payments-v2/dto/ops-merchant-finance-payouts-query.dto.ts`
  - Validar filtros de estado/divisa/rango para payouts.
- **Modificar:** `test/integration/payments-v2.integration.spec.ts`
  - Cubrir nuevos endpoints internos y shape del contrato.
- **Crear:** `src/payments-v2/payments-v2-merchant-finance.spec.ts`
  - Unit tests para agregados gross/net y edge cases (sin fee quote, sin payouts).

### Backoffice (`apps/psp-backoffice`)

- **Crear:** `src/app/api/internal/merchants/[merchantId]/finance/summary/route.ts`
- **Crear:** `src/app/api/internal/merchants/[merchantId]/finance/transactions/route.ts`
- **Crear:** `src/app/api/internal/merchants/[merchantId]/finance/payouts/route.ts`
  - Proxy server-side de los tres nuevos endpoints internos API.
- **Modificar:** `src/lib/api/contracts.ts`
  - Tipos TS del dominio merchant finance (summary, filas financieras, payouts, settlement mode net/gross).
- **Modificar:** `src/lib/api/client.ts`
  - Nuevas funciones `fetchMerchantFinanceSummary`, `fetchMerchantFinanceTransactions`, `fetchMerchantFinancePayouts`.
- **Crear:** `src/components/merchant-finance/merchant-finance-dashboard.tsx`
  - Pantalla principal con KPIs (bruto/comisión/neto), tabla de transacciones y tabla de payouts.
- **Crear:** `src/app/merchants/[merchantId]/finance/page.tsx`
  - Entry point de ruta App Router.
- **Modificar:** `src/components/transactions/transactions-dashboard.tsx`
  - CTA contextual “Ver finanzas merchant” al seleccionar fila o en acciones.
- **Modificar:** `src/components/transactions/payment-detail-view.tsx`
  - Enlace directo al dashboard financiero del merchant del pago.
- **Crear:** `src/lib/server/merchant-finance-api.spec.ts`
  - Unit tests del BFF para routes nuevas.

### Documentación

- **Modificar:** `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
  - Documentar nueva ruta de producto y BFF.
- **Modificar:** `PROJECT_CONTEXT.md`
  - Reflejar nuevos endpoints internos financieros.
- **Modificar:** `docs/testing-status.md`
  - Actualizar inventario/matriz de cobertura tras agregar specs.

---

### Task 1: Contrato API de finanzas merchant (summary + transactions + payouts)

**Files:**
- Create: `apps/psp-api/src/payments-v2/dto/ops-merchant-finance-summary-query.dto.ts`
- Create: `apps/psp-api/src/payments-v2/dto/ops-merchant-finance-transactions-query.dto.ts`
- Create: `apps/psp-api/src/payments-v2/dto/ops-merchant-finance-payouts-query.dto.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2-internal.controller.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.service.ts`
- Test: `apps/psp-api/src/payments-v2/payments-v2-merchant-finance.spec.ts`

- [ ] **Step 1: Escribir test unitario fallido para summary gross/net**

```ts
it('returns gross/fee/net totals for merchant and currency', async () => {
  prisma.paymentFeeQuote.aggregate.mockResolvedValue({
    _sum: { grossMinor: 12_000, feeMinor: 450, netMinor: 11_550 },
  });

  const result = await service.getOpsMerchantFinanceSummary('merch_1', {
    currency: 'EUR',
    createdFrom: '2026-04-01T00:00:00.000Z',
    createdTo: '2026-04-30T23:59:59.999Z',
  });

  expect(result.totals).toEqual({
    grossMinor: '12000',
    feeMinor: '450',
    netMinor: '11550',
  });
});
```

- [ ] **Step 2: Ejecutar test y verificar fallo**

Run: `cd apps/psp-api && npm run test -- src/payments-v2/payments-v2-merchant-finance.spec.ts`
Expected: FAIL con `getOpsMerchantFinanceSummary is not a function` o contrato faltante.

- [ ] **Step 3: Implementar DTOs y endpoints internos mínimos**

```ts
@Get('ops/merchants/:merchantId/finance/summary')
async merchantFinanceSummary(
  @Param('merchantId') merchantId: string,
  @Query() query: OpsMerchantFinanceSummaryQueryDto,
) {
  return this.payments.getOpsMerchantFinanceSummary(merchantId, query);
}
```

```ts
@Get('ops/merchants/:merchantId/finance/transactions')
async merchantFinanceTransactions(
  @Param('merchantId') merchantId: string,
  @Query() query: OpsMerchantFinanceTransactionsQueryDto,
) {
  return this.payments.listOpsMerchantFinanceTransactions(merchantId, query);
}
```

```ts
@Get('ops/merchants/:merchantId/finance/payouts')
async merchantFinancePayouts(
  @Param('merchantId') merchantId: string,
  @Query() query: OpsMerchantFinancePayoutsQueryDto,
) {
  return this.payments.listOpsMerchantFinancePayouts(merchantId, query);
}
```

- [ ] **Step 4: Implementar lógica de servicio para bruto/comisión/neto y listados**

```ts
async getOpsMerchantFinanceSummary(merchantId: string, query: OpsMerchantFinanceSummaryQueryDto) {
  const where = this.buildMerchantFinanceWhere(merchantId, query);
  const sums = await this.prisma.paymentFeeQuote.aggregate({
    where,
    _sum: { grossMinor: true, feeMinor: true, netMinor: true },
  });

  return {
    merchantId,
    currency: query.currency?.toUpperCase() ?? null,
    totals: {
      grossMinor: BigInt(sums._sum.grossMinor ?? 0).toString(),
      feeMinor: BigInt(sums._sum.feeMinor ?? 0).toString(),
      netMinor: BigInt(sums._sum.netMinor ?? 0).toString(),
    },
  };
}
```

- [ ] **Step 5: Re-ejecutar tests y commitear**

Run: `cd apps/psp-api && npm run test -- src/payments-v2/payments-v2-merchant-finance.spec.ts`
Expected: PASS.

```bash
git add apps/psp-api/src/payments-v2/dto/ops-merchant-finance-summary-query.dto.ts apps/psp-api/src/payments-v2/dto/ops-merchant-finance-transactions-query.dto.ts apps/psp-api/src/payments-v2/dto/ops-merchant-finance-payouts-query.dto.ts apps/psp-api/src/payments-v2/payments-v2-internal.controller.ts apps/psp-api/src/payments-v2/payments-v2.service.ts apps/psp-api/src/payments-v2/payments-v2-merchant-finance.spec.ts
git commit -m "feat(api): expose merchant finance internal endpoints"
```

---

### Task 2: Cobertura de integración API para contrato financiero merchant

**Files:**
- Modify: `apps/psp-api/test/integration/payments-v2.integration.spec.ts`
- Modify: `apps/psp-api/test/integration/helpers/integration-app.ts`
- Test: `apps/psp-api/test/integration/payments-v2.integration.spec.ts`

- [ ] **Step 1: Agregar test de integración fallido para summary/payouts**

```ts
it('returns merchant finance summary and payouts via internal secret', async () => {
  const merchant = await createMerchantViaHttp(app);
  const payment = await createAndCapturePayment(app, merchant.apiKey, 2_500, 'EUR');
  await settlements.createPayout({ merchantId: merchant.id, currency: 'EUR', now: new Date(Date.now() + 86_400_000) });

  const summary = await request(app.getHttpServer())
    .get(`/api/v2/payments/ops/merchants/${merchant.id}/finance/summary?currency=EUR`)
    .set('X-Internal-Secret', process.env.INTERNAL_SECRET ?? 'dev-internal')
    .expect(200);

  expect(summary.body.totals.grossMinor).toBeDefined();

  const payouts = await request(app.getHttpServer())
    .get(`/api/v2/payments/ops/merchants/${merchant.id}/finance/payouts?currency=EUR`)
    .set('X-Internal-Secret', process.env.INTERNAL_SECRET ?? 'dev-internal')
    .expect(200);

  expect(Array.isArray(payouts.body.items)).toBe(true);
});
```

- [ ] **Step 2: Ejecutar integración y comprobar fallo**

Run: `cd apps/psp-api && npm run test:integration -- test/integration/payments-v2.integration.spec.ts`
Expected: FAIL con `Cannot GET /api/v2/payments/ops/merchants/.../finance/...`.

- [ ] **Step 3: Ajustar response shape final y serialización de enteros**

```ts
return {
  items: rows.map((row) => ({
    payoutId: row.id,
    status: row.status,
    currency: row.currency,
    grossMinor: BigInt(row.grossMinor).toString(),
    feeMinor: BigInt(row.feeMinor).toString(),
    netMinor: BigInt(row.netMinor).toString(),
    createdAt: row.createdAt,
  })),
  page: { hasNextPage, hasPrevPage, pageSize },
};
```

- [ ] **Step 4: Re-ejecutar integración completa del archivo**

Run: `cd apps/psp-api && npm run test:integration -- test/integration/payments-v2.integration.spec.ts`
Expected: PASS para casos existentes y nuevos.

- [ ] **Step 5: Commit de cobertura de integración**

```bash
git add apps/psp-api/test/integration/payments-v2.integration.spec.ts apps/psp-api/test/integration/helpers/integration-app.ts
git commit -m "test(api): cover merchant finance internal contract"
```

---

### Task 3: BFF backoffice para endpoints financieros de merchant

**Files:**
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/summary/route.ts`
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/transactions/route.ts`
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/payouts/route.ts`
- Modify: `apps/psp-backoffice/src/lib/api/contracts.ts`
- Modify: `apps/psp-backoffice/src/lib/api/client.ts`
- Test: `apps/psp-backoffice/src/lib/server/merchant-finance-api.spec.ts`

- [ ] **Step 1: Crear test fallido de route proxy + auth**

```ts
it('returns 401 when missing backoffice auth header', async () => {
  const req = new NextRequest('http://localhost:3005/api/internal/merchants/m_1/finance/summary');
  const res = await GET(req, { params: Promise.resolve({ merchantId: 'm_1' }) });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Ejecutar tests Vitest y validar fallo**

Run: `cd apps/psp-backoffice && npm run test -- src/lib/server/merchant-finance-api.spec.ts`
Expected: FAIL porque las rutas no existen.

- [ ] **Step 3: Implementar BFF routes con validación y proxy seguro**

```ts
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ merchantId: string }> },
) {
  const unauthorized = enforceInternalRouteAuth(request);
  if (unauthorized) return unauthorized;

  const { merchantId } = await context.params;
  const params = request.nextUrl.searchParams;
  const data = await proxyInternalGet<MerchantFinanceSummaryResponse>({
    path: `/api/v2/payments/ops/merchants/${encodeURIComponent(merchantId)}/finance/summary`,
    searchParams: params,
  });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Extender contratos y cliente backoffice**

```ts
export type MerchantFinanceSummaryResponse = {
  merchantId: string;
  currency: string | null;
  totals: { grossMinor: string; feeMinor: string; netMinor: string };
  settlements: { pendingMinor: string; availableMinor: string; paidMinor: string };
};
```

```ts
export async function fetchMerchantFinanceSummary(
  merchantId: string,
  filters: MerchantFinanceFilters,
): Promise<MerchantFinanceSummaryResponse> {
  const params = new URLSearchParams();
  if (filters.currency) params.set('currency', filters.currency);
  const response = await fetch(`/api/internal/merchants/${encodeURIComponent(merchantId)}/finance/summary?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return parseResponse<MerchantFinanceSummaryResponse>(response);
}
```

- [ ] **Step 5: Re-ejecutar tests y commit**

Run: `cd apps/psp-backoffice && npm run test -- src/lib/server/merchant-finance-api.spec.ts`
Expected: PASS.

```bash
git add apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/summary/route.ts apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/transactions/route.ts apps/psp-backoffice/src/app/api/internal/merchants/[merchantId]/finance/payouts/route.ts apps/psp-backoffice/src/lib/api/contracts.ts apps/psp-backoffice/src/lib/api/client.ts apps/psp-backoffice/src/lib/server/merchant-finance-api.spec.ts
git commit -m "feat(backoffice): add merchant finance bff endpoints"
```

---

### Task 4: Nueva vista merchant finance en backoffice

**Files:**
- Create: `apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.tsx`
- Create: `apps/psp-backoffice/src/app/merchants/[merchantId]/finance/page.tsx`
- Modify: `apps/psp-backoffice/src/components/transactions/transactions-dashboard.tsx`
- Modify: `apps/psp-backoffice/src/components/transactions/payment-detail-view.tsx`
- Test: `apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.spec.tsx`

- [ ] **Step 1: Escribir test de UI fallido para KPIs gross/net y payouts**

```tsx
it('renders gross fee net cards and payouts table', async () => {
  render(<MerchantFinanceDashboard merchantId="merch_1" />);
  expect(await screen.findByText('Volumen bruto')).toBeInTheDocument();
  expect(screen.getByText('Comisiones')).toBeInTheDocument();
  expect(screen.getByText('Neto liquidable')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: /payouts/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Ejecutar test y confirmar fallo**

Run: `cd apps/psp-backoffice && npm run test -- src/components/merchant-finance/merchant-finance-dashboard.spec.tsx`
Expected: FAIL por componente/ruta inexistente.

- [ ] **Step 3: Implementar componente principal con React Query**

```tsx
const summaryQuery = useQuery({
  queryKey: ['merchant-finance-summary', merchantId, filters],
  queryFn: () => fetchMerchantFinanceSummary(merchantId, filters),
  refetchInterval: 30_000,
});

const txQuery = useQuery({
  queryKey: ['merchant-finance-transactions', merchantId, filters, cursor],
  queryFn: () => fetchMerchantFinanceTransactions(merchantId, { ...filters, pageSize: 20, ...cursor }),
});
```

- [ ] **Step 4: Integrar navegación desde transacciones y detalle**

```tsx
<DropdownMenuItem
  onClick={() => {
    router.push(`/merchants/${row.original.merchantId}/finance`);
  }}
>
  Ver finanzas merchant
</DropdownMenuItem>
```

```tsx
<Link
  href={`/merchants/${d.merchantId}/finance`}
  className="text-sm font-medium text-[var(--primary)] hover:underline"
>
  Ver finanzas del merchant
</Link>
```

- [ ] **Step 5: Re-ejecutar test de UI y commit**

Run: `cd apps/psp-backoffice && npm run test -- src/components/merchant-finance/merchant-finance-dashboard.spec.tsx`
Expected: PASS.

```bash
git add apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.tsx apps/psp-backoffice/src/app/merchants/[merchantId]/finance/page.tsx apps/psp-backoffice/src/components/transactions/transactions-dashboard.tsx apps/psp-backoffice/src/components/transactions/payment-detail-view.tsx apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.spec.tsx
git commit -m "feat(backoffice): add merchant finance dashboard"
```

---

### Task 5: Hardening funcional (net vs gross, edge cases, vacíos)

**Files:**
- Modify: `apps/psp-api/src/payments-v2/payments-v2-merchant-finance.spec.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.service.ts`
- Modify: `apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.tsx`
- Test: `apps/psp-api/test/integration/payments-v2.integration.spec.ts`
- Test: `apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.spec.tsx`

- [ ] **Step 1: Test fallido de edge case sin fee quote (fallback seguro)**

```ts
it('falls back to payment amount as gross when fee quote is missing', async () => {
  prisma.payment.findMany.mockResolvedValue([
    { id: 'pay_1', amountMinor: 3000, paymentFeeQuote: null },
  ] as any);

  const result = await service.listOpsMerchantFinanceTransactions('merch_1', { pageSize: 25 });
  expect(result.items[0]).toMatchObject({
    grossMinor: '3000',
    feeMinor: '0',
    netMinor: '3000',
  });
});
```

- [ ] **Step 2: Ejecutar y verificar fallo**

Run: `cd apps/psp-api && npm run test -- src/payments-v2/payments-v2-merchant-finance.spec.ts`
Expected: FAIL por fallback no implementado.

- [ ] **Step 3: Implementar fallback explícito y estado vacío en UI**

```ts
const grossMinor = quote?.grossMinor ?? payment.amountMinor;
const feeMinor = quote?.feeMinor ?? 0;
const netMinor = quote?.netMinor ?? payment.amountMinor;
```

```tsx
if (summaryQuery.isSuccess && txQuery.data?.items.length === 0) {
  return <p className="text-sm text-slate-500">No hay transacciones financieras para el filtro aplicado.</p>;
}
```

- [ ] **Step 4: Correr tests de API y UI**

Run: `cd apps/psp-api && npm run test -- src/payments-v2/payments-v2-merchant-finance.spec.ts && npm run test:integration -- test/integration/payments-v2.integration.spec.ts`
Expected: PASS.

Run: `cd apps/psp-backoffice && npm run test -- src/components/merchant-finance/merchant-finance-dashboard.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit de hardening**

```bash
git add apps/psp-api/src/payments-v2/payments-v2-merchant-finance.spec.ts apps/psp-api/src/payments-v2/payments-v2.service.ts apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.tsx apps/psp-backoffice/src/components/merchant-finance/merchant-finance-dashboard.spec.tsx apps/psp-api/test/integration/payments-v2.integration.spec.ts
git commit -m "fix(finance): harden net gross calculations and empty states"
```

---

### Task 6: Documentación, estado de testing y validación final

**Files:**
- Modify: `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/testing-status.md`

- [ ] **Step 1: Actualizar contexto backoffice con nueva ruta y BFF**

```md
- Nueva ruta de producto: `/merchants/[merchantId]/finance`.
- Nuevos proxies BFF:
  - `GET /api/internal/merchants/:merchantId/finance/summary`
  - `GET /api/internal/merchants/:merchantId/finance/transactions`
  - `GET /api/internal/merchants/:merchantId/finance/payouts`
```

- [ ] **Step 2: Actualizar contexto global con endpoints internos financieros**

```md
- Payments v2 internal agrega finanzas merchant:
  - `GET /api/v2/payments/ops/merchants/:merchantId/finance/summary`
  - `GET /api/v2/payments/ops/merchants/:merchantId/finance/transactions`
  - `GET /api/v2/payments/ops/merchants/:merchantId/finance/payouts`
```

- [ ] **Step 3: Actualizar matriz de `docs/testing-status.md`**

```md
| `merchant-finance backoffice` | Si | N/A | No | Cubierto | Dashboard financiero con KPIs gross/fee/net, listados y payouts. |
```

- [ ] **Step 4: Ejecutar validación final repo por app**

Run API:
`cd apps/psp-api && npm run lint && npm run test && npm run test:integration -- test/integration/payments-v2.integration.spec.ts && npm run build`
Expected: PASS sin errores.

Run Backoffice:
`cd apps/psp-backoffice && npm run lint && npm run typecheck && npm run test && npm run build`
Expected: PASS sin errores.

- [ ] **Step 5: Commit final de docs**

```bash
git add apps/psp-backoffice/BACKOFFICE_CONTEXT.md PROJECT_CONTEXT.md docs/testing-status.md
git commit -m "docs: document merchant finance flows and test coverage"
```

---

## Self-Review

### 1) Spec coverage

- **Settlements:** cubierto por endpoint de `payouts` + saldos `pending/available/paid` en `summary`.
- **Transacciones:** cubierto por listado financiero con cursor y filtros.
- **Bruto / neto / comisiones:** cubierto en KPIs y en cada fila transaccional (`grossMinor`, `feeMinor`, `netMinor`).
- **Needs merchant:** cubierto con navegación contextual desde transacción/detalle al dashboard de su merchant.

No gaps detectados contra el pedido actual.

### 2) Placeholder scan

- Sin `TODO`, `TBD` ni referencias ambiguas.
- Cada tarea incluye archivos concretos, snippets y comandos ejecutables.
- Cada tarea incluye paso de test antes y después de implementar.

### 3) Type consistency

- Se usa nomenclatura consistente en todo el plan:
  - `getOpsMerchantFinanceSummary`
  - `listOpsMerchantFinanceTransactions`
  - `listOpsMerchantFinancePayouts`
  - `MerchantFinanceSummaryResponse`
  - `grossMinor`, `feeMinor`, `netMinor`

Sin inconsistencias de naming detectadas.


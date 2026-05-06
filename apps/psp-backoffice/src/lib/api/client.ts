import type {
  MerchantIndustry,
  MerchantRegistrationStatus,
  MerchantOnboardingApplicationDetail,
  MerchantOnboardingApplicationsResponse,
  MerchantFinancePayoutsFilters,
  MerchantFinancePayoutsResponse,
  MerchantFinanceSummaryFilters,
  MerchantFinanceSummaryResponse,
  MerchantFinanceTransactionsFilters,
  MerchantFinanceTransactionsResponse,
  MerchantPaymentMethodRow,
  MerchantProviderRateRow,
  MerchantsOpsDetailResponse,
  MerchantsOpsDirectoryResponse,
  MerchantsOpsMerchantSummary,
  OpsDashboardVolumeUsdFilters,
  OpsDashboardVolumeUsdResponse,
  OpsPaymentDetailResponse,
  OpsPaymentActionResponse,
  OpsPaymentsSummaryDailyResponse,
  OpsPaymentsSummaryHourlyResponse,
  OpsPaymentsSummaryResponse,
  OpsTransactionCountsFilters,
  OpsTransactionCountsResponse,
  OpsTransactionsResponse,
  OpsVolumeHourlyMetric,
  OpsVolumeHourlyResponse,
  PaymentMethodRouteRow,
  PaymentProviderConfigRow,
  ProviderHealthResponse,
  ResendPaymentNotificationResponse,
  SettlementAvailableBalanceResponse,
  SettlementInboxFilters,
  SettlementRequestRow,
  SettlementRequestsListResponse,
  TransactionsFilters,
} from "@/lib/api/contracts";
import type { OpsPaymentProvider } from "@/lib/api/payment-providers";

/**
 * Error del cliente BFF con mensaje seguro para UI (`publicMessage` / `message`) y detalle interno en `cause`.
 * No exponer `cause` en pantalla; usar solo para logs/monitoring.
 */
export class BffClientError extends Error {
  readonly publicMessage: string;
  readonly statusCode?: number;

  constructor(options: { publicMessage: string; cause?: unknown; statusCode?: number }) {
    super(options.publicMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BffClientError";
    this.publicMessage = options.publicMessage;
    this.statusCode = options.statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Mensajes HTTP genéricos para UI; el detalle del servidor va en `cause`, no aquí. */
function publicMessageForHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "No tienes permiso para esta acción o la sesión expiró.";
  }
  if (status === 404) {
    return "No se encontró el recurso solicitado.";
  }
  if (status === 408 || status === 504) {
    return "Tiempo de espera agotado. Inténtalo de nuevo.";
  }
  if (status === 429) {
    return "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
  }
  if (status >= 500) {
    return "El servicio no está disponible temporalmente. Inténtalo más tarde.";
  }
  return "No se pudo completar la solicitud. Inténtalo de nuevo.";
}

/** Incluye cookies (p. ej. `backoffice_admin_token` tras `/login`) en peticiones al BFF. */
const internalBffInit: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

/** Cabeceras para mutaciones BFF (`POST`/`PATCH` bajo `/api/internal/*`). */
const backofficeMutationHeaders = {
  "Content-Type": "application/json",
  "X-Backoffice-Mutation": "1",
} satisfies HeadersInit;

const BFF_CLIENT_TIMEOUT_MIN_MS = 10_000;
const BFF_CLIENT_TIMEOUT_MAX_MS = 120_000;

function getBffClientTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_BFF_FETCH_TIMEOUT_MS?.trim();
  if (!raw) return 90_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 90_000;
  return Math.min(BFF_CLIENT_TIMEOUT_MAX_MS, Math.max(BFF_CLIENT_TIMEOUT_MIN_MS, n));
}

type BffFetchAbortHandle = {
  signal: AbortSignal;
  /** Limpia timers y listeners del fallback; llamar siempre en `finally`. */
  dispose: () => void;
};

/**
 * Señal de timeout para `fetch`, con soporte amplio de navegadores y combinación opcional con `userSignal`.
 * - `AbortSignal.timeout` cuando exista y no haya señal externa.
 * - `AbortSignal.any` cuando haya que unir timeout + señal del caller.
 * - Si no, `AbortController` + `setTimeout` y propagación manual de abort.
 */
function createBffFetchAbort(ms: number, userSignal?: AbortSignal | null): BffFetchAbortHandle {
  const noop = () => {};

  if (userSignal?.aborted) {
    return { signal: userSignal, dispose: noop };
  }

  const hasAbortSignal = typeof AbortSignal !== "undefined";
  const hasTimeout = hasAbortSignal && typeof AbortSignal.timeout === "function";
  const hasAny = hasAbortSignal && typeof AbortSignal.any === "function";

  if (hasTimeout && !userSignal) {
    return { signal: AbortSignal.timeout(ms), dispose: noop };
  }

  if (hasTimeout && userSignal && hasAny) {
    return {
      signal: AbortSignal.any([AbortSignal.timeout(ms), userSignal]),
      dispose: noop,
    };
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const onUserAbort = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (userSignal) {
    userSignal.addEventListener("abort", onUserAbort);
  }

  timeoutId = setTimeout(() => {
    timeoutId = undefined;
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }, ms);

  const dispose = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (userSignal) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
  };

  return { signal: controller.signal, dispose };
}

/**
 * `fetch` al BFF same-origin con tope de tiempo. Si el Route Handler espera indefinidamente a psp-api,
 * sin esto el cliente queda en carga perpetua (React Query `isLoading`).
 */
async function internalBffFetch(input: string, init?: RequestInit): Promise<Response> {
  const ms = getBffClientTimeoutMs();
  const { signal, dispose } = createBffFetchAbort(ms, init?.signal ?? null);
  try {
    return await globalThis.fetch(input, {
      ...internalBffInit,
      ...init,
      signal,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      const internalDetail = new Error(
        `Tiempo de espera agotado (${ms} ms) al llamar al panel. Comprueba que psp-api responda, que PSP_API_BASE_URL apunte a ese servicio y que PSP_API_PROXY_TIMEOUT_MS en el backoffice cubra el cold start (Render free).`,
      );
      throw new BffClientError({
        publicMessage: "Tiempo de espera agotado. Inténtalo de nuevo.",
        cause: internalDetail,
      });
    }
    throw new BffClientError({
      publicMessage: "No se pudo completar la solicitud. Inténtalo de nuevo.",
      cause: err,
    });
  } finally {
    dispose();
  }
}

function toSearchParams(filters: TransactionsFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("pageSize", String(filters.pageSize));
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.cursorCreatedAt) params.set("cursorCreatedAt", filters.cursorCreatedAt);
  if (filters.cursorId) params.set("cursorId", filters.cursorId);
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.paymentId) params.set("paymentId", filters.paymentId);
  if (filters.status) params.set("status", filters.status);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.payerCountry) params.set("payerCountry", filters.payerCountry);
  if (filters.paymentMethodCode) params.set("paymentMethodCode", filters.paymentMethodCode);
  if (filters.paymentMethodFamily) params.set("paymentMethodFamily", filters.paymentMethodFamily);
  if (filters.weekday !== undefined) params.set("weekday", String(filters.weekday));
  if (filters.merchantActive === false) params.set("merchantActive", "false");
  if (filters.merchantActive === true) params.set("merchantActive", "true");
  if (filters.includeTotal === false) params.set("includeTotal", "false");
  if (filters.includeTotal === true) params.set("includeTotal", "true");
  return params;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let internalDetail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) internalDetail = payload.message;
    } catch {
      // no-op
    }
    throw new BffClientError({
      publicMessage: publicMessageForHttpStatus(response.status),
      statusCode: response.status,
      cause: new Error(internalDetail),
    });
  }

  return (await response.json()) as T;
}

export async function fetchOpsTransactions(filters: TransactionsFilters): Promise<OpsTransactionsResponse> {
  const params = toSearchParams(filters).toString();
  const response = await internalBffFetch(`/api/internal/transactions?${params}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsTransactionsResponse>(response);
}

export async function fetchOpsTransactionCounts(
  filters: OpsTransactionCountsFilters,
): Promise<OpsTransactionCountsResponse> {
  const params = new URLSearchParams();
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.paymentId) params.set("paymentId", filters.paymentId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.payerCountry) params.set("payerCountry", filters.payerCountry);
  if (filters.paymentMethodCode) params.set("paymentMethodCode", filters.paymentMethodCode);
  if (filters.paymentMethodFamily) params.set("paymentMethodFamily", filters.paymentMethodFamily);
  if (filters.weekday !== undefined) params.set("weekday", String(filters.weekday));
  if (filters.merchantActive === false) params.set("merchantActive", "false");
  if (filters.merchantActive === true) params.set("merchantActive", "true");
  const response = await internalBffFetch(`/api/internal/transactions/counts?${params.toString()}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsTransactionCountsResponse>(response);
}

export type OpsVolumeHourlyFilters = {
  merchantId?: string;
  provider?: OpsPaymentProvider;
  currency?: string;
  metric?: OpsVolumeHourlyMetric;
  /** YYYY-MM-DD (día UTC de comparación, estrictamente anterior a hoy UTC). */
  compareUtcDate?: string;
};

export type OpsPaymentsSummaryFilters = {
  currentFrom: string;
  currentTo: string;
  compareFrom: string;
  compareTo: string;
  merchantId?: string;
  provider?: OpsPaymentProvider;
  currency?: string;
};

export async function fetchOpsPaymentsSummary(
  filters: OpsPaymentsSummaryFilters,
): Promise<OpsPaymentsSummaryResponse> {
  const params = new URLSearchParams();
  params.set("currentFrom", filters.currentFrom);
  params.set("currentTo", filters.currentTo);
  params.set("compareFrom", filters.compareFrom);
  params.set("compareTo", filters.compareTo);
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency);
  const qs = params.toString();
  const response = await internalBffFetch(`/api/internal/transactions/summary?${qs}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentsSummaryResponse>(response);
}

export async function fetchOpsPaymentsSummaryDaily(
  filters: OpsPaymentsSummaryFilters,
): Promise<OpsPaymentsSummaryDailyResponse> {
  const params = new URLSearchParams();
  params.set("currentFrom", filters.currentFrom);
  params.set("currentTo", filters.currentTo);
  params.set("compareFrom", filters.compareFrom);
  params.set("compareTo", filters.compareTo);
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency);
  const qs = params.toString();
  const response = await internalBffFetch(`/api/internal/transactions/summary-daily?${qs}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentsSummaryDailyResponse>(response);
}

export async function fetchOpsPaymentsSummaryHourly(
  filters: OpsPaymentsSummaryFilters,
): Promise<OpsPaymentsSummaryHourlyResponse> {
  const params = new URLSearchParams();
  params.set("currentFrom", filters.currentFrom);
  params.set("currentTo", filters.currentTo);
  params.set("compareFrom", filters.compareFrom);
  params.set("compareTo", filters.compareTo);
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency);
  const qs = params.toString();
  const response = await internalBffFetch(`/api/internal/transactions/summary-hourly?${qs}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentsSummaryHourlyResponse>(response);
}

function opsDashboardVolumeUsdParams(filters: OpsDashboardVolumeUsdFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.paymentId) params.set("paymentId", filters.paymentId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.payerCountry) params.set("payerCountry", filters.payerCountry);
  if (filters.paymentMethodCode) params.set("paymentMethodCode", filters.paymentMethodCode);
  if (filters.paymentMethodFamily) params.set("paymentMethodFamily", filters.paymentMethodFamily);
  if (filters.weekday !== undefined) params.set("weekday", String(filters.weekday));
  if (filters.merchantActive === false) params.set("merchantActive", "false");
  if (filters.merchantActive === true) params.set("merchantActive", "true");
  return params;
}

export async function fetchOpsDashboardVolumeUsd(
  filters: OpsDashboardVolumeUsdFilters = {},
): Promise<OpsDashboardVolumeUsdResponse> {
  const qs = opsDashboardVolumeUsdParams(filters).toString();
  const response = await internalBffFetch(
    `/api/internal/transactions/dashboard-volume-usd${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<OpsDashboardVolumeUsdResponse>(response);
}

export async function fetchOpsVolumeHourly(
  filters: OpsVolumeHourlyFilters = {},
): Promise<OpsVolumeHourlyResponse> {
  const params = new URLSearchParams();
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.metric) params.set("metric", filters.metric);
  if (filters.compareUtcDate) params.set("compareUtcDate", filters.compareUtcDate);
  const qs = params.toString();
  const response = await internalBffFetch(`/api/internal/transactions/volume-hourly${qs ? `?${qs}` : ""}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsVolumeHourlyResponse>(response);
}

export async function fetchOpsPaymentDetail(paymentId: string): Promise<OpsPaymentDetailResponse> {
  const encoded = encodeURIComponent(paymentId);
  const response = await internalBffFetch(`/api/internal/payments/${encoded}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentDetailResponse>(response);
}

export async function fetchPaymentAction(paymentId: string): Promise<OpsPaymentActionResponse> {
  const encoded = encodeURIComponent(paymentId);
  const response = await internalBffFetch(`/api/internal/payments/${encoded}/action`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentActionResponse>(response);
}

export async function resendPaymentNotification(
  paymentId: string,
  deliveryId: string,
): Promise<ResendPaymentNotificationResponse> {
  const pe = encodeURIComponent(paymentId);
  const de = encodeURIComponent(deliveryId);
  const response = await internalBffFetch(`/api/internal/payments/${pe}/notifications/${de}/resend`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: JSON.stringify({}),
  });
  return parseResponse<ResendPaymentNotificationResponse>(response);
}

export async function fetchProviderHealth(): Promise<ProviderHealthResponse> {
  const response = await internalBffFetch("/api/internal/provider-health", {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<ProviderHealthResponse>(response);
}

function merchantFinanceSummaryParams(filters: MerchantFinanceSummaryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency.toUpperCase());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  return params;
}

export async function fetchMerchantFinanceSummary(
  merchantId: string,
  filters: MerchantFinanceSummaryFilters = {},
): Promise<MerchantFinanceSummaryResponse> {
  const qs = merchantFinanceSummaryParams(filters).toString();
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(
    `/api/internal/merchants/${encoded}/finance/summary${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<MerchantFinanceSummaryResponse>(response);
}

function merchantFinanceTransactionsParams(filters: MerchantFinanceTransactionsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page != null) params.set("page", String(filters.page));
  if (filters.pageSize != null) params.set("pageSize", String(filters.pageSize));
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.cursorCreatedAt) params.set("cursorCreatedAt", filters.cursorCreatedAt);
  if (filters.cursorId) params.set("cursorId", filters.cursorId);
  if (filters.status) params.set("status", filters.status);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency.toUpperCase());
  if (filters.paymentId) params.set("paymentId", filters.paymentId);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.includeTotal === false) params.set("includeTotal", "false");
  if (filters.includeTotal === true) params.set("includeTotal", "true");
  return params;
}

export async function fetchMerchantFinanceTransactions(
  merchantId: string,
  filters: MerchantFinanceTransactionsFilters = {},
): Promise<MerchantFinanceTransactionsResponse> {
  const qs = merchantFinanceTransactionsParams(filters).toString();
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(
    `/api/internal/merchants/${encoded}/finance/transactions${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<MerchantFinanceTransactionsResponse>(response);
}

function merchantFinancePayoutsParams(filters: MerchantFinancePayoutsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page != null) params.set("page", String(filters.page));
  if (filters.pageSize != null) params.set("pageSize", String(filters.pageSize));
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.cursorCreatedAt) params.set("cursorCreatedAt", filters.cursorCreatedAt);
  if (filters.cursorId) params.set("cursorId", filters.cursorId);
  if (filters.status) params.set("status", filters.status);
  if (filters.currency) params.set("currency", filters.currency.toUpperCase());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.includeTotal === false) params.set("includeTotal", "false");
  if (filters.includeTotal === true) params.set("includeTotal", "true");
  return params;
}

export async function fetchMerchantFinancePayouts(
  merchantId: string,
  filters: MerchantFinancePayoutsFilters = {},
): Promise<MerchantFinancePayoutsResponse> {
  const qs = merchantFinancePayoutsParams(filters).toString();
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(
    `/api/internal/merchants/${encoded}/finance/payouts${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<MerchantFinancePayoutsResponse>(response);
}

export async function fetchSettlementAvailableBalance(
  merchantId: string,
  currency?: string,
): Promise<SettlementAvailableBalanceResponse> {
  const params = new URLSearchParams();
  if (currency) params.set("currency", currency.toUpperCase());
  const qs = params.toString();
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(
    `/api/internal/settlements/merchants/${encoded}/available-balance${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<SettlementAvailableBalanceResponse>(response);
}

export async function fetchSettlementRequestsForMerchant(
  merchantId: string,
): Promise<SettlementRequestsListResponse> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/settlements/merchants/${encoded}/requests`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<SettlementRequestsListResponse>(response);
}

export async function createSettlementRequest(
  merchantId: string,
  options: { currency?: string; notes?: string } = {},
): Promise<SettlementRequestRow> {
  const params = new URLSearchParams();
  if (options.currency) params.set("currency", options.currency.toUpperCase());
  const qs = params.toString();
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(
    `/api/internal/settlements/merchants/${encoded}/requests${qs ? `?${qs}` : ""}`,
    {
      ...internalBffInit,
      method: "POST",
      headers: backofficeMutationHeaders,
      body: JSON.stringify({ notes: options.notes }),
    },
  );
  return parseResponse<SettlementRequestRow>(response);
}

export async function fetchSettlementInbox(
  filters: SettlementInboxFilters = {},
): Promise<SettlementRequestsListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const response = await internalBffFetch(
    `/api/internal/settlements/requests/inbox${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<SettlementRequestsListResponse>(response);
}

export async function approveSettlementRequest(
  requestId: string,
  body: { reviewedNotes?: string } = {},
): Promise<SettlementRequestRow> {
  const encoded = encodeURIComponent(requestId);
  const response = await internalBffFetch(`/api/internal/settlements/requests/${encoded}/approve`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<SettlementRequestRow>(response);
}

export async function rejectSettlementRequest(
  requestId: string,
  body: { reviewedNotes?: string } = {},
): Promise<SettlementRequestRow> {
  const encoded = encodeURIComponent(requestId);
  const response = await internalBffFetch(`/api/internal/settlements/requests/${encoded}/reject`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<SettlementRequestRow>(response);
}

export async function fetchMerchantsOpsDirectory(): Promise<MerchantsOpsDirectoryResponse> {
  const response = await internalBffFetch("/api/internal/merchants/ops/directory", {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantsOpsDirectoryResponse>(response);
}

export async function fetchMerchantsOpsDetail(merchantId: string): Promise<MerchantsOpsDetailResponse> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/detail`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantsOpsDetailResponse>(response);
}

export async function patchMerchantOpsActive(
  merchantId: string,
  body: { isActive: boolean },
): Promise<MerchantsOpsMerchantSummary> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/active`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<MerchantsOpsMerchantSummary>(response);
}

export type PatchMerchantAccountBody = {
  name?: string;
  email?: string;
  contactName?: string;
  contactPhone?: string;
  websiteUrl?: string | null;
  isActive?: boolean;
  registrationStatus?: MerchantRegistrationStatus;
  registrationNumber?: string | null;
  industry?: MerchantIndustry;
};

export async function patchMerchantOpsAccount(
  merchantId: string,
  body: PatchMerchantAccountBody,
): Promise<MerchantsOpsMerchantSummary> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/account`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<MerchantsOpsMerchantSummary>(response);
}

export async function fetchMerchantPaymentMethods(
  merchantId: string,
): Promise<MerchantPaymentMethodRow[]> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/payment-methods`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantPaymentMethodRow[]>(response);
}

export type PatchMerchantPaymentMethodBody = {
  merchantEnabled?: boolean;
  adminEnabled?: boolean;
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
  visibleToMerchant?: boolean;
  lastChangedBy?: string;
};

export async function patchMerchantPaymentMethod(
  merchantId: string,
  mpmId: string,
  body: PatchMerchantPaymentMethodBody,
): Promise<MerchantPaymentMethodRow> {
  const encMerchant = encodeURIComponent(merchantId);
  const encMpm = encodeURIComponent(mpmId);
  const response = await internalBffFetch(
    `/api/internal/merchants/ops/${encMerchant}/payment-methods/${encMpm}`,
    {
      ...internalBffInit,
      method: "PATCH",
      headers: backofficeMutationHeaders,
      body: JSON.stringify(body),
    },
  );
  return parseResponse<MerchantPaymentMethodRow>(response);
}

export async function fetchMerchantOnboardingApplications(): Promise<MerchantOnboardingApplicationsResponse> {
  const response = await internalBffFetch("/api/internal/crm/onboarding", {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantOnboardingApplicationsResponse>(response);
}

export async function fetchMerchantOnboardingApplication(
  applicationId: string,
): Promise<MerchantOnboardingApplicationDetail> {
  const encoded = encodeURIComponent(applicationId);
  const response = await internalBffFetch(`/api/internal/crm/onboarding/${encoded}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantOnboardingApplicationDetail>(response);
}

export async function approveMerchantOnboardingApplication(applicationId: string): Promise<unknown> {
  const encoded = encodeURIComponent(applicationId);
  const response = await internalBffFetch(`/api/internal/crm/onboarding/${encoded}/approve`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
  });
  return parseResponse<unknown>(response);
}

export async function rejectMerchantOnboardingApplication(
  applicationId: string,
  body: { reason: string },
): Promise<unknown> {
  const encoded = encodeURIComponent(applicationId);
  const response = await internalBffFetch(`/api/internal/crm/onboarding/${encoded}/reject`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<unknown>(response);
}

export async function resendMerchantOnboardingLink(applicationId: string): Promise<unknown> {
  const encoded = encodeURIComponent(applicationId);
  const response = await internalBffFetch(`/api/internal/crm/onboarding/${encoded}/resend-link`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
  });
  return parseResponse<unknown>(response);
}

export type PaymentMethodRoutesFilters = {
  countryCode?: string;
  providerId?: string;
  channel?: PaymentMethodRouteRow["channel"];
  isActive?: boolean;
};

function paymentMethodRoutesSearchParams(filters: PaymentMethodRoutesFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.countryCode) params.set("countryCode", filters.countryCode.trim().toUpperCase());
  if (filters.providerId) params.set("providerId", filters.providerId.trim());
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.isActive === true) params.set("isActive", "true");
  if (filters.isActive === false) params.set("isActive", "false");
  return params;
}

export async function fetchPaymentProviders(): Promise<PaymentProviderConfigRow[]> {
  const response = await internalBffFetch("/api/internal/payment-providers", {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<PaymentProviderConfigRow[]>(response);
}

export async function createPaymentProvider(body: unknown): Promise<PaymentProviderConfigRow> {
  const response = await internalBffFetch("/api/internal/payment-providers", {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseResponse<PaymentProviderConfigRow>(response);
}

export async function patchPaymentProvider(
  providerId: string,
  body: unknown,
): Promise<PaymentProviderConfigRow> {
  const encoded = encodeURIComponent(providerId);
  const response = await internalBffFetch(`/api/internal/payment-providers/${encoded}`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseResponse<PaymentProviderConfigRow>(response);
}

export async function fetchPaymentMethodRoutes(
  filters: PaymentMethodRoutesFilters = {},
): Promise<PaymentMethodRouteRow[]> {
  const qs = paymentMethodRoutesSearchParams(filters).toString();
  const response = await internalBffFetch(`/api/internal/payment-method-routes${qs ? `?${qs}` : ""}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<PaymentMethodRouteRow[]>(response);
}

export async function createPaymentMethodRoute(body: unknown): Promise<PaymentMethodRouteRow> {
  const response = await internalBffFetch("/api/internal/payment-method-routes", {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseResponse<PaymentMethodRouteRow>(response);
}

export async function patchPaymentMethodRoute(
  routeId: string,
  body: unknown,
): Promise<PaymentMethodRouteRow> {
  const encoded = encodeURIComponent(routeId);
  const response = await internalBffFetch(`/api/internal/payment-method-routes/${encoded}`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseResponse<PaymentMethodRouteRow>(response);
}

export async function patchPaymentMethodRouteWeight(
  routeId: string,
  weight: number,
): Promise<PaymentMethodRouteRow> {
  const encoded = encodeURIComponent(routeId);
  const response = await internalBffFetch(`/api/internal/payment-method-routes/${encoded}/weight`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: JSON.stringify({ weight }),
  });
  return parseResponse<PaymentMethodRouteRow>(response);
}

export async function fetchMerchantProviderRates(merchantId: string): Promise<MerchantProviderRateRow[]> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/provider-rates`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantProviderRateRow[]>(response);
}

export async function upsertMerchantProviderRate(
  merchantId: string,
  body: unknown,
): Promise<MerchantProviderRateRow> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/provider-rates`, {
    ...internalBffInit,
    method: "POST",
    headers: backofficeMutationHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return parseResponse<MerchantProviderRateRow>(response);
}

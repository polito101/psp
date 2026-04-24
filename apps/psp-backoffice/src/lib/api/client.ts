import type {
  MerchantFinancePayoutsFilters,
  MerchantFinancePayoutsResponse,
  MerchantFinanceSummaryFilters,
  MerchantFinanceSummaryResponse,
  MerchantFinanceTransactionsFilters,
  MerchantFinanceTransactionsResponse,
  MerchantPaymentMethodRow,
  MerchantsOpsDetailResponse,
  MerchantsOpsDirectoryResponse,
  MerchantsOpsMerchantSummary,
  OpsDashboardVolumeUsdFilters,
  OpsDashboardVolumeUsdResponse,
  OpsPaymentDetailResponse,
  OpsTransactionCountsFilters,
  OpsTransactionCountsResponse,
  OpsTransactionsResponse,
  OpsVolumeHourlyMetric,
  OpsVolumeHourlyResponse,
  ProviderHealthResponse,
  SettlementAvailableBalanceResponse,
  SettlementInboxFilters,
  SettlementRequestRow,
  SettlementRequestsListResponse,
  TransactionsFilters,
} from "@/lib/api/contracts";
import type { OpsPaymentProvider } from "@/lib/api/payment-providers";

/** Incluye cookies (p. ej. `backoffice_admin_token` tras `/login`) en peticiones al BFF. */
const internalBffInit: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

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
    let message = "Unexpected API error";
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchOpsTransactions(filters: TransactionsFilters): Promise<OpsTransactionsResponse> {
  const params = toSearchParams(filters).toString();
  const response = await fetch(`/api/internal/transactions?${params}`, {
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
  const response = await fetch(`/api/internal/transactions/counts?${params.toString()}`, {
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
  const response = await fetch(
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
  const response = await fetch(`/api/internal/transactions/volume-hourly${qs ? `?${qs}` : ""}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsVolumeHourlyResponse>(response);
}

export async function fetchOpsPaymentDetail(paymentId: string): Promise<OpsPaymentDetailResponse> {
  const encoded = encodeURIComponent(paymentId);
  const response = await fetch(`/api/internal/payments/${encoded}`, {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<OpsPaymentDetailResponse>(response);
}

export async function fetchProviderHealth(): Promise<ProviderHealthResponse> {
  const response = await fetch("/api/internal/provider-health", {
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
  const response = await fetch(
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
  const response = await fetch(
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
  const response = await fetch(
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
  const response = await fetch(
    `/api/internal/settlements/merchants/${encoded}/available-balance${qs ? `?${qs}` : ""}`,
    { ...internalBffInit, method: "GET" },
  );
  return parseResponse<SettlementAvailableBalanceResponse>(response);
}

export async function fetchSettlementRequestsForMerchant(
  merchantId: string,
): Promise<SettlementRequestsListResponse> {
  const encoded = encodeURIComponent(merchantId);
  const response = await fetch(`/api/internal/settlements/merchants/${encoded}/requests`, {
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
  const response = await fetch(
    `/api/internal/settlements/merchants/${encoded}/requests${qs ? `?${qs}` : ""}`,
    {
      ...internalBffInit,
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const response = await fetch(
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
  const response = await fetch(`/api/internal/settlements/requests/${encoded}/approve`, {
    ...internalBffInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<SettlementRequestRow>(response);
}

export async function rejectSettlementRequest(
  requestId: string,
  body: { reviewedNotes?: string } = {},
): Promise<SettlementRequestRow> {
  const encoded = encodeURIComponent(requestId);
  const response = await fetch(`/api/internal/settlements/requests/${encoded}/reject`, {
    ...internalBffInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<SettlementRequestRow>(response);
}

export async function fetchMerchantsOpsDirectory(): Promise<MerchantsOpsDirectoryResponse> {
  const response = await fetch("/api/internal/merchants/ops/directory", {
    ...internalBffInit,
    method: "GET",
  });
  return parseResponse<MerchantsOpsDirectoryResponse>(response);
}

export async function fetchMerchantsOpsDetail(merchantId: string): Promise<MerchantsOpsDetailResponse> {
  const encoded = encodeURIComponent(merchantId);
  const response = await fetch(`/api/internal/merchants/ops/${encoded}/detail`, {
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
  const response = await fetch(`/api/internal/merchants/ops/${encoded}/active`, {
    ...internalBffInit,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<MerchantsOpsMerchantSummary>(response);
}

export async function fetchMerchantPaymentMethods(
  merchantId: string,
): Promise<MerchantPaymentMethodRow[]> {
  const encoded = encodeURIComponent(merchantId);
  const response = await fetch(`/api/internal/merchants/ops/${encoded}/payment-methods`, {
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
  const response = await fetch(
    `/api/internal/merchants/ops/${encMerchant}/payment-methods/${encMpm}`,
    {
      ...internalBffInit,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return parseResponse<MerchantPaymentMethodRow>(response);
}

import type {
  MerchantFinancePayoutsFilters,
  MerchantFinancePayoutsResponse,
  MerchantFinanceSummaryFilters,
  MerchantFinanceSummaryResponse,
  MerchantFinanceTransactionsFilters,
  MerchantFinanceTransactionsResponse,
  OpsPaymentDetailResponse,
  OpsTransactionCountsFilters,
  OpsTransactionCountsResponse,
  OpsTransactionsResponse,
  OpsVolumeHourlyResponse,
  ProviderHealthResponse,
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
};

export async function fetchOpsVolumeHourly(
  filters: OpsVolumeHourlyFilters = {},
): Promise<OpsVolumeHourlyResponse> {
  const params = new URLSearchParams();
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.currency) params.set("currency", filters.currency);
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

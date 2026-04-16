import type {
  OpsPaymentDetailResponse,
  OpsTransactionCountsFilters,
  OpsTransactionCountsResponse,
  OpsTransactionsResponse,
  OpsVolumeHourlyResponse,
  ProviderHealthResponse,
  TransactionsFilters,
} from "@/lib/api/contracts";

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
    method: "GET",
    cache: "no-store",
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
    method: "GET",
    cache: "no-store",
  });
  return parseResponse<OpsTransactionCountsResponse>(response);
}

export type OpsVolumeHourlyFilters = {
  merchantId?: string;
  provider?: "stripe" | "mock";
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
  const response = await fetch(
    `/api/internal/transactions/volume-hourly${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );
  return parseResponse<OpsVolumeHourlyResponse>(response);
}

export async function fetchOpsPaymentDetail(paymentId: string): Promise<OpsPaymentDetailResponse> {
  const encoded = encodeURIComponent(paymentId);
  const response = await fetch(`/api/internal/payments/${encoded}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseResponse<OpsPaymentDetailResponse>(response);
}

export async function fetchProviderHealth(): Promise<ProviderHealthResponse> {
  const response = await fetch("/api/internal/provider-health", {
    method: "GET",
    cache: "no-store",
  });
  return parseResponse<ProviderHealthResponse>(response);
}

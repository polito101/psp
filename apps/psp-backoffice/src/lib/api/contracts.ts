export type TransactionStatus =
  | "pending"
  | "processing"
  | "requires_action"
  | "authorized"
  | "succeeded"
  | "failed"
  | "canceled"
  | "refunded";

export type TransactionProvider = "stripe" | "mock";

export type OpsTransactionLastAttempt = {
  id: string;
  operation: "create" | "capture" | "cancel" | "refund";
  provider: string;
  attemptNo: number;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: string;
};

export type OpsTransactionItem = {
  id: string;
  merchantId: string;
  merchantName: string;
  status: TransactionStatus;
  statusReason: string | null;
  amountMinor: number;
  currency: string;
  selectedProvider: string | null;
  providerRef: string | null;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  canceledAt: string | null;
  routingReasonCode: string | null;
  lastAttempt: OpsTransactionLastAttempt | null;
};

export type OpsTransactionsResponse = {
  items: OpsTransactionItem[];
  page: {
    pageSize: number;
    /** `null` cuando la petición va con `includeTotal=false` (sin COUNT en servidor). */
    total: number | null;
    totalPages: number | null;
    hasPrevPage: boolean;
    hasNextPage: boolean;
  };
  cursors: {
    prev: { createdAt: string; id: string } | null;
    next: { createdAt: string; id: string } | null;
  };
};

export type ProviderHealthStatus = {
  provider: string;
  open: boolean;
  failures: number;
  openedUntil: number;
};

export type ProviderHealthResponse = {
  providers: ProviderHealthStatus[];
};

export type TransactionsFilters = {
  pageSize: number;
  cursorCreatedAt?: string;
  cursorId?: string;
  direction?: "next" | "prev";
  merchantId?: string;
  paymentId?: string;
  status?: TransactionStatus;
  provider?: TransactionProvider;
  createdFrom?: string;
  createdTo?: string;
  /** Si es false, el BFF/API omiten el agregado total (menos carga en DB con polling). */
  includeTotal?: boolean;
};

export type OpsPaymentAttemptDetail = {
  id: string;
  operation: string;
  provider: string;
  attemptNo: number;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  providerPaymentId: string | null;
  createdAt: string;
  responsePayload: unknown | null;
};

export type OpsPaymentDetailResponse = {
  id: string;
  merchantId: string;
  merchantName: string;
  status: TransactionStatus;
  statusReason: string | null;
  amountMinor: number;
  currency: string;
  selectedProvider: string | null;
  providerRef: string | null;
  idempotencyKey: string | null;
  paymentLinkId: string | null;
  rail: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  canceledAt: string | null;
  attempts: OpsPaymentAttemptDetail[];
};

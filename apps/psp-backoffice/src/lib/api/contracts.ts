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
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
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
  page: number;
  pageSize: number;
  merchantId?: string;
  paymentId?: string;
  status?: TransactionStatus;
  provider?: TransactionProvider;
  createdFrom?: string;
  createdTo?: string;
};

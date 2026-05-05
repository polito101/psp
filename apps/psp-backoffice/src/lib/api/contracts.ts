import type { OpsPaymentProvider } from "./payment-providers";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "requires_action"
  | "authorized"
  | "succeeded"
  | "disputed"
  | "dispute_lost"
  | "failed"
  | "canceled"
  | "refunded";

export type TransactionProvider = OpsPaymentProvider;

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
  payerCountry?: string;
  paymentMethodCode?: string;
  paymentMethodFamily?: string;
  weekday?: number;
  merchantActive?: boolean;
  /** Si es false, el BFF/API omiten el agregado total (menos carga en DB con polling). */
  includeTotal?: boolean;
};

/** Filtros base del listado ops (sin paginación ni estado) para el agregado de conteos por status. */
export type OpsTransactionCountsFilters = Pick<
  TransactionsFilters,
  | "merchantId"
  | "paymentId"
  | "provider"
  | "createdFrom"
  | "createdTo"
  | "payerCountry"
  | "paymentMethodCode"
  | "paymentMethodFamily"
  | "weekday"
  | "merchantActive"
>;

export type OpsTransactionCountsResponse = {
  total: number;
  /** Claves = valores de `Payment.status` en DB. */
  byStatus: Record<string, number>;
};

/** Respuesta de `GET .../ops/dashboard/volume-usd` (montos USD minor como string). */
export type OpsDashboardVolumeUsdResponse = {
  viewCurrency: "USD";
  asOf: string;
  paidUsdMinor: string;
  pendingUsdMinor: string;
  failedOrExpiredUsdMinor: string;
  conversionUnavailable: boolean;
};

export type OpsDashboardVolumeUsdFilters = Pick<
  TransactionsFilters,
  | "merchantId"
  | "paymentId"
  | "provider"
  | "createdFrom"
  | "createdTo"
  | "payerCountry"
  | "paymentMethodCode"
  | "paymentMethodFamily"
  | "weekday"
  | "merchantActive"
>;

export type SettlementAvailableBalanceResponse = {
  availableNetMinor: number;
};

export type SettlementRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAID"
  | "CANCELED";

export type SettlementInboxFilters = {
  status?: SettlementRequestStatus;
};

export type SettlementRequestRow = {
  id: string;
  merchantId: string;
  currency: string;
  requestedNetMinor: number;
  status: SettlementRequestStatus | string;
  payoutId: string | null;
  /** Suma net minor liquidada en la aprobación (varios payouts si hubo tandas). */
  paidNetMinor?: number | null;
  /** false si quedó saldo AVAILABLE tras aprobar. */
  settledAllAvailable?: boolean;
  notes: string | null;
  requestedByRole: string;
  reviewedNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SettlementRequestsListResponse = {
  items: SettlementRequestRow[];
};

export type MerchantRegistrationStatus =
  | "LEAD"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVE";

export type MerchantIndustry =
  | "CLOUD_COMPUTING"
  | "CRYPTO"
  | "FOREX"
  | "GAMBLING"
  | "PSP"
  | "OTHER";

export type MerchantAccountStatus = "ENABLED" | "DISABLED";

export type MerchantsOpsDirectoryRow = {
  id: string;
  mid: string;
  name: string;
  email: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  registrationStatus: MerchantRegistrationStatus;
  industry: MerchantIndustry;
  apiKeyExpiresAt: string | null;
  apiKeyRevokedAt: string | null;
  createdAt: string;
};

/** `GET .../merchants/ops/directory` devuelve un array plano. */
export type MerchantsOpsDirectoryResponse = MerchantsOpsDirectoryRow[];

export type MerchantsOpsMerchantSummary = {
  id: string;
  mid: string;
  name: string;
  email: string | null;
  contactName: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  registrationNumber: string | null;
  registrationStatus: MerchantRegistrationStatus;
  industry: MerchantIndustry;
  createdAt?: string;
};

export type MerchantsOpsRecentPayment = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
};

export type PaymentMethodDefinitionSummary = {
  id: string;
  code: string;
  label: string;
  provider: string;
  category: string;
  active: boolean;
  createdAt: string;
};

export type MerchantPaymentMethodRow = {
  id: string;
  merchantId: string;
  definitionId: string;
  merchantEnabled: boolean;
  adminEnabled: boolean;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  visibleToMerchant: boolean;
  lastChangedBy: string | null;
  createdAt: string;
  updatedAt: string;
  definition?: PaymentMethodDefinitionSummary;
};

export type MerchantsOpsDetailResponse = {
  merchant: MerchantsOpsMerchantSummary & {
    apiKeyExpiresAt: string | null;
    apiKeyRevokedAt: string | null;
    createdAt: string;
  };
  recentPayments: MerchantsOpsRecentPayment[];
  settlementRequests: SettlementRequestRow[];
  paymentMethods: MerchantPaymentMethodRow[];
  latestOnboardingApplication: MerchantOnboardingApplicationDetail | null;
  onboardingEvents: MerchantOnboardingEvent[];
  /** Límite aplicado en API: se devuelven como mucho estos eventos (los más recientes). */
  onboardingEventsLimit: number;
};

export type OpsVolumeHourlyMetric = "volume_gross" | "volume_net" | "succeeded_count";

/** Respuesta de `GET .../ops/transactions/volume-hourly` (límites de día en UTC). */
export type OpsVolumeHourlyResponse = {
  dayBoundary: "UTC";
  currency: string;
  metric: OpsVolumeHourlyMetric;
  /** `currency_minor`: importe en unidades menores; `count`: número de pagos succeeded. */
  valueUnit: "currency_minor" | "count";
  /** Día calendario UTC de la serie discontinua (comparación con hoy). */
  compareUtcDate: string;
  status: string;
  labels: string[];
  /**
   * Acumulado por hora; `null` en horas futuras del día actual (UTC).
   * Se serializa como string decimal (bigint) para evitar pérdida de precisión fuera de `MAX_SAFE_INTEGER`.
   */
  todayCumulativeVolumeMinor: (string | null)[];
  compareCumulativeVolumeMinor: string[];
  totals: {
    todayVolumeMinor: string;
    compareDayVolumeMinor: string;
  };
};

export type OpsPaymentsSummaryBucket = {
  paymentsTotal: string;
  grossVolumeMinor: string;
  netVolumeMinor: string;
  paymentErrorsTotal: string;
};

/** Respuesta de `GET .../ops/transactions/summary` (agregados por ventana `created_at`). */
export type OpsPaymentsSummaryResponse = {
  currency: string | null;
  current: OpsPaymentsSummaryBucket;
  compare: OpsPaymentsSummaryBucket;
};

export type OpsPaymentsSummaryDailySeries = {
  labels: string[];
  paymentsTotal: string[];
  grossVolumeMinor: string[];
  netVolumeMinor: string[];
  paymentErrorsTotal: string[];
};

/** Respuesta de `GET .../ops/transactions/summary-daily` (bucket diario UTC). */
export type OpsPaymentsSummaryDailyResponse = {
  granularity: "daily";
  currency: string | null;
  current: OpsPaymentsSummaryDailySeries;
  compare: OpsPaymentsSummaryDailySeries;
};

/** Respuesta de `GET .../ops/transactions/summary-hourly` (24 buckets UTC 0–23 por día). */
export type OpsPaymentsSummaryHourlyResponse = {
  granularity: "hourly";
  currency: string | null;
  current: OpsPaymentsSummaryDailySeries;
  compare: OpsPaymentsSummaryDailySeries;
};

/** Serie diaria u horaria del resumen ops (misma forma de `current` / `compare`). */
export type OpsPaymentsSummaryChartResponse = OpsPaymentsSummaryDailyResponse | OpsPaymentsSummaryHourlyResponse;

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
  /** Solo presente si la API/BFF se pidió con `includePayload=true` (depuración). */
  responsePayload?: unknown | null;
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
  /** Total de intentos persistidos para este pago. */
  attemptsTotal: number;
  /** True si la lista `attempts` está acotada (solo los más recientes). */
  attemptsTruncated: boolean;
  attempts: OpsPaymentAttemptDetail[];
};

/** Respuesta de `GET .../ops/merchants/:merchantId/finance/summary` (montos en minor como string). */
export type MerchantFinanceSummaryResponse = {
  merchantId: string;
  currency: string | null;
  totals: {
    grossMinor: string;
    feeMinor: string;
    netMinor: string;
  };
};

export type MerchantFinanceTransactionItem = {
  id: string;
  paymentId: string;
  merchantId: string;
  provider: string;
  selectedProvider: string | null;
  status: string;
  currency: string;
  settlementMode: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  createdAt: string;
  paymentCreatedAt: string;
};

/** Paginación keyset/cursor de listados finance por merchant (misma forma que `PaymentsV2Service`). */
export type MerchantFinanceListPage = {
  pageSize: number;
  /** `null` cuando la petición va con `includeTotal=false` (sin COUNT en servidor). */
  total: number | null;
  totalPages: number | null;
  hasPrevPage: boolean;
  hasNextPage: boolean;
};

export type MerchantFinanceListCursors = {
  prev: { createdAt: string; id: string } | null;
  next: { createdAt: string; id: string } | null;
};

/** Respuesta de `GET .../ops/merchants/:merchantId/finance/transactions`. */
export type MerchantFinanceTransactionsResponse = {
  items: MerchantFinanceTransactionItem[];
  page: MerchantFinanceListPage;
  cursors: MerchantFinanceListCursors;
};

export type MerchantFinancePayoutItem = {
  id: string;
  merchantId: string;
  currency: string;
  status: string;
  windowStartAt: string;
  windowEndAt: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  createdAt: string;
};

/** Respuesta de `GET .../ops/merchants/:merchantId/finance/payouts`. */
export type MerchantFinancePayoutsResponse = {
  items: MerchantFinancePayoutItem[];
  page: MerchantFinanceListPage;
  cursors: MerchantFinanceListCursors;
};

export type MerchantFinanceSummaryFilters = {
  provider?: TransactionProvider;
  currency?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type MerchantFinanceTransactionsFilters = {
  page?: number;
  pageSize?: number;
  cursorCreatedAt?: string;
  cursorId?: string;
  direction?: "next" | "prev";
  status?: TransactionStatus;
  provider?: TransactionProvider;
  currency?: string;
  paymentId?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Si es `false`, el API omite COUNT; `page.total` y `page.totalPages` serán `null`. */
  includeTotal?: boolean;
};

export type MerchantFinancePayoutsFilters = {
  page?: number;
  pageSize?: number;
  cursorCreatedAt?: string;
  cursorId?: string;
  direction?: "next" | "prev";
  status?: "CREATED" | "SENT" | "FAILED";
  currency?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Si es `false`, el API omite COUNT; `page.total` y `page.totalPages` serán `null`. */
  includeTotal?: boolean;
};

export type MerchantOnboardingStatus =
  | "ACCOUNT_CREATED"
  | "DOCUMENTATION_PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVE";

export type MerchantOnboardingChecklistStatus = "PENDING" | "COMPLETED" | "BLOCKED";

export type MerchantOnboardingMerchantSummary = {
  id: string;
  name: string;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
};

export type MerchantOnboardingChecklistItem = {
  id: string;
  applicationId: string;
  key: string;
  label: string;
  status: MerchantOnboardingChecklistStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantOnboardingEvent = {
  id: string;
  applicationId: string;
  type: string;
  actorType: "SYSTEM" | "MERCHANT" | "ADMIN";
  actorId: string | null;
  message: string;
  metadata?: unknown | null;
  createdAt: string;
};

export type MerchantOnboardingApplicationListItem = {
  id: string;
  merchantId: string;
  status: MerchantOnboardingStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  tradeName: string | null;
  legalName: string | null;
  country: string | null;
  website: string | null;
  businessType: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  merchant: MerchantOnboardingMerchantSummary | null;
  checklistItems: MerchantOnboardingChecklistItem[];
};

export type MerchantOnboardingApplicationsResponse = {
  items: MerchantOnboardingApplicationListItem[];
  total: number;
  pageSize: number;
};

export type MerchantOnboardingApplicationDetail = MerchantOnboardingApplicationListItem & {
  events: MerchantOnboardingEvent[];
};

export type MerchantOnboardingTokenResponse = {
  id: string;
  applicationId: string;
  expiresAt: string;
  application: {
    id: string;
    status: MerchantOnboardingStatus;
  };
};

export type PaymentProviderConfigRow = {
  id: string;
  name: string;
  description: string | null;
  integrationBaseUrl: string;
  initPaymentResource: string;
  isConfigured: boolean;
  isActive: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentMethodRouteRow = {
  id: string;
  providerId: string;
  methodCode: string;
  methodName: string;
  countryCode: string;
  countryName?: string | null;
  countryImageName?: string | null;
  channel: "CASH" | "ONLINE" | "CREDIT_CARD" | "CRYPTO";
  integrationMode: "S2S" | "REDIRECTION" | "HOSTED_PAGE";
  requestTemplate: "REDIRECT_SIMPLE" | "SPEI_BANK_TRANSFER";
  integrationCode?: string | null;
  checkoutUrlTemplate?: string | null;
  expirationTimeOffset?: number;
  weight: number;
  isActive: boolean;
  isPublished: boolean;
  routeConfigJson?: unknown | null;
  createdAt?: string;
  updatedAt?: string;
  provider?: PaymentProviderConfigRow;
  currencies: Array<{ currency: string; minAmount: string; maxAmount: string; isDefault: boolean }>;
};

export type MerchantProviderRateRow = {
  id: string;
  merchantId: string;
  providerId: string;
  countryCode: string;
  percentage: string;
  fixed: string;
  minRateDiscount: string;
  applyToCustomer: boolean;
  fxSpread: string;
  fxMarkup: string;
  disableIndustryValidation?: boolean;
  cashEnabled?: boolean;
  creditCardEnabled?: boolean;
  cryptoEnabled?: boolean;
  onlineEnabled?: boolean;
  cashMinAmount?: string;
  creditCardMinAmount?: string;
  cryptoMinAmount?: string;
  onlineMinAmount?: string;
  isActive: boolean;
  provider?: { id: string; name: string };
};

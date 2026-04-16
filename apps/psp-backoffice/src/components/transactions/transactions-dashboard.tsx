"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  AlertCircle,
  BarChart3,
  CircleCheck,
  Download,
  LayoutGrid,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Settings2,
  Timer,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";
import { fetchOpsTransactionCounts, fetchOpsTransactions } from "@/lib/api/client";
import type { TransactionProvider, TransactionStatus, TransactionsFilters } from "@/lib/api/contracts";
import {
  formatAmountMinor,
  formatShortDateTime,
  mapOpsItemToTableRow,
  type TransactionTableRow,
} from "@/lib/ops-transaction-display";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { VisaMark } from "./visa-mark";

const DEFAULT_REFRESH_INTERVAL_MS = 8_000;
const MIN_REFRESH_INTERVAL_MS = 2_000;
const MAX_REFRESH_INTERVAL_MS = 60_000;

function parseRefreshIntervalMs(raw: string | undefined): number {
  const parsed = raw ? Number(raw) : DEFAULT_REFRESH_INTERVAL_MS;
  const safe = Number.isFinite(parsed) ? parsed : DEFAULT_REFRESH_INTERVAL_MS;
  return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, safe));
}

const REFRESH_INTERVAL_MS = parseRefreshIntervalMs(process.env.NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS);
const PAGE_SIZE = 20;

const TABS = [
  { id: "pagos" as const, label: "Pagos" },
  { id: "transferencias" as const, label: "Transferencias" },
  { id: "recargas" as const, label: "Recargas" },
  { id: "actividad" as const, label: "Toda la actividad" },
];

type SummaryCardKey =
  | "all"
  | "succeeded"
  | "refunded"
  | "disputed"
  | "error"
  | "not_captured";

/** Estilos por tarjeta: contenedor inactivo, anillo/icono al seleccionar, icono inactivo. */
const SUMMARY_CARD_VISUAL: Record<
  SummaryCardKey,
  {
    label: string;
    icon: LucideIcon;
    /** Fondo/borde suave cuando no está seleccionada */
    surface: string;
    /** Contenedor del icono (no seleccionado) */
    iconWrap: string;
    /** Contenedor del icono (seleccionado) */
    iconWrapActive: string;
    /** Número cuando está seleccionada */
    countActive: string;
  }
> = {
  all: {
    label: "Todos",
    icon: LayoutGrid,
    surface: "border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 hover:border-slate-300 hover:shadow-md",
    iconWrap: "bg-slate-100 text-slate-600 ring-1 ring-slate-200/80",
    iconWrapActive: "bg-slate-900 text-white ring-0 shadow-inner",
    countActive: "text-slate-900",
  },
  succeeded: {
    label: "Exitosos",
    icon: CircleCheck,
    surface:
      "border-emerald-200/70 bg-gradient-to-br from-white to-emerald-50/50 hover:border-emerald-300/90 hover:shadow-md hover:shadow-emerald-500/5",
    iconWrap: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60",
    iconWrapActive: "bg-emerald-600 text-white ring-0 shadow-emerald-900/20",
    countActive: "text-emerald-950",
  },
  refunded: {
    label: "Reembolsados",
    icon: RotateCcw,
    surface:
      "border-sky-200/70 bg-gradient-to-br from-white to-sky-50/40 hover:border-sky-300/90 hover:shadow-md hover:shadow-sky-500/5",
    iconWrap: "bg-sky-100 text-sky-700 ring-1 ring-sky-200/60",
    iconWrapActive: "bg-sky-600 text-white ring-0",
    countActive: "text-sky-950",
  },
  disputed: {
    label: "Disputados",
    icon: Scale,
    surface: "border-amber-200/60 bg-gradient-to-br from-amber-50/30 to-white",
    iconWrap: "bg-amber-100 text-amber-700 ring-1 ring-amber-200/50",
    iconWrapActive: "bg-amber-600 text-white ring-0",
    countActive: "text-amber-950",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    surface:
      "border-rose-200/80 bg-gradient-to-br from-white to-rose-50/45 hover:border-rose-300 hover:shadow-md hover:shadow-rose-500/5",
    iconWrap: "bg-rose-100 text-rose-600 ring-1 ring-rose-200/70",
    iconWrapActive: "bg-rose-600 text-white ring-0",
    countActive: "text-rose-950",
  },
  not_captured: {
    label: "No capturado",
    icon: Timer,
    surface:
      "border-violet-200/70 bg-gradient-to-br from-white to-violet-50/40 hover:border-violet-300/90 hover:shadow-md hover:shadow-violet-500/5",
    iconWrap: "bg-violet-100 text-violet-700 ring-1 ring-violet-200/60",
    iconWrapActive: "bg-violet-600 text-white ring-0",
    countActive: "text-violet-950",
  },
};

const SUMMARY_CARD_ORDER: SummaryCardKey[] = [
  "all",
  "succeeded",
  "refunded",
  "disputed",
  "error",
  "not_captured",
];

const STATUS_LABELS_ES: Record<TransactionStatus, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  requires_action: "Requiere acción",
  authorized: "Autorizado",
  succeeded: "Exitoso",
  failed: "Error",
  canceled: "Cancelado",
  refunded: "Reembolsado",
};

type TabId = (typeof TABS)[number]["id"];

type AdvancedFilters = {
  dateFrom: string;
  dateTo: string;
  paymentId: string;
  merchantId: string;
  provider: "" | TransactionProvider;
  statusFilter: "" | TransactionStatus;
  amountMin: string;
  amountMax: string;
  currencies: string[];
};

const EMPTY_ADVANCED: AdvancedFilters = {
  dateFrom: "",
  dateTo: "",
  paymentId: "",
  merchantId: "",
  provider: "",
  statusFilter: "",
  amountMin: "",
  amountMax: "",
  currencies: [],
};

type DialogKey =
  | null
  | "create"
  | "analyze"
  | "columns"
  | "date"
  | "amount"
  | "currency"
  | "status"
  | "method"
  | "more";

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.valueOf())) return undefined;
  return asDate.toISOString();
}

function filtersStableKey(f: Omit<TransactionsFilters, "pageSize" | "includeTotal">): string {
  return JSON.stringify({
    merchantId: f.merchantId,
    paymentId: f.paymentId,
    status: f.status,
    provider: f.provider,
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
  });
}

/** Estado de tarjeta resumen → filtro `status` de la API (una sola banda). */
function summaryToApiStatus(key: SummaryCardKey): TransactionStatus | undefined {
  if (key === "all") return undefined;
  if (key === "succeeded") return "succeeded";
  if (key === "refunded") return "refunded";
  if (key === "error") return "failed";
  if (key === "not_captured") return "authorized";
  return undefined;
}

function getEffectiveApiStatus(
  summaryKey: SummaryCardKey,
  chipStatus: "" | TransactionStatus,
): TransactionStatus | undefined {
  if (summaryKey === "disputed") return undefined;
  const fromCard = summaryToApiStatus(summaryKey);
  if (fromCard) return fromCard;
  return chipStatus || undefined;
}

function applyClientRowFilters(rows: TransactionTableRow[], f: AdvancedFilters): TransactionTableRow[] {
  return rows.filter((row) => {
    if (f.amountMin !== "") {
      const min = Number(f.amountMin.replace(",", ".")) * 100;
      if (!Number.isFinite(min) || row.amountMinor < min) return false;
    }
    if (f.amountMax !== "") {
      const max = Number(f.amountMax.replace(",", ".")) * 100;
      if (!Number.isFinite(max) || row.amountMinor > max) return false;
    }
    if (f.currencies.length > 0 && !f.currencies.includes(row.currency.toUpperCase())) return false;
    return true;
  });
}

/** Carácter significativo tras espacios iniciales que Excel/Sheets tratan como inicio de fórmula en CSV. */
const CSV_FORMULA_TRIGGER = /^\s*[=+\-@]/;

/**
 * Evita CSV injection (fórmulas al abrir en Excel/Sheets) y escapa comillas dobles para el formato RFC 4180.
 *
 * @param value Valor bruto de celda antes de envolver en comillas.
 * @returns Texto seguro para interpolar dentro de `"..."` en una línea CSV.
 */
function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const neutralized = CSV_FORMULA_TRIGGER.test(raw) ? `'${raw}` : raw;
  return neutralized.replaceAll('"', '""');
}

function exportCsv(rows: TransactionTableRow[]) {
  const headers = [
    "ID",
    "Importe",
    "Estado",
    "Método de pago",
    "Descripción",
    "Cliente",
    "Fecha",
    "Fecha de reembolso",
    "Motivo",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      formatAmountMinor(row.amountMinor, row.currency),
      STATUS_LABELS_ES[row.status],
      row.paymentMethodLast4 ? `•••• ${row.paymentMethodLast4}` : "—",
      row.description || "",
      row.customer ?? "—",
      formatShortDateTime(row.createdAt),
      row.refundedAt ? formatShortDateTime(row.refundedAt) : "—",
      row.reasonLabel ?? "—",
    ]
      .map((cell) => `"${sanitizeCsvCell(cell)}"`)
      .join(","),
  );
  const csv = [headers.map((h) => `"${sanitizeCsvCell(h)}"`).join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transacciones-ops-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_VISIBILITY: VisibilityState = {
  amount: true,
  status: true,
  method: true,
  desc: true,
  customer: true,
  date: true,
  refundDate: true,
  reason: true,
};

export function TransactionsDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("pagos");
  const [summaryKey, setSummaryKey] = useState<SummaryCardKey>("all");
  const [applied, setApplied] = useState<AdvancedFilters>(EMPTY_ADVANCED);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(EMPTY_ADVANCED);
  const [cursorStack, setCursorStack] = useState<({ createdAt: string; id: string } | null)[]>([null]);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [dialog, setDialog] = useState<DialogKey>(null);

  const listBase = useMemo(
    (): Omit<TransactionsFilters, "pageSize" | "includeTotal" | "cursorCreatedAt" | "cursorId" | "direction"> => ({
      merchantId: applied.merchantId.trim() || undefined,
      paymentId: applied.paymentId.trim() || undefined,
      provider: applied.provider || undefined,
      createdFrom: toIsoDate(applied.dateFrom),
      createdTo: toIsoDate(applied.dateTo),
    }),
    [applied],
  );

  const effectiveStatus = useMemo(
    () => getEffectiveApiStatus(summaryKey, applied.statusFilter),
    [summaryKey, applied.statusFilter],
  );

  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const page = cursorStack.length;

  const listFilters: TransactionsFilters = useMemo(
    () => ({
      ...listBase,
      pageSize: PAGE_SIZE,
      direction: "next",
      ...(summaryKey === "disputed" ? {} : effectiveStatus ? { status: effectiveStatus } : {}),
      ...(cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {}),
    }),
    [listBase, effectiveStatus, cursor, summaryKey],
  );

  const filterKey = useMemo(() => filtersStableKey(listFilters), [listFilters]);
  const lastTotalsKeyRef = useRef<string | null>(null);
  const forceIncludeTotalRef = useRef(true);
  const lastKnownTotalsRef = useRef<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });

  const listEnabled = activeTab === "pagos" && summaryKey !== "disputed";

  const transactionsQuery = useQuery({
    queryKey: ["dashboard-ops-transactions", listFilters],
    queryFn: async () => {
      const includeTotal =
        lastTotalsKeyRef.current !== filterKey || forceIncludeTotalRef.current;
      forceIncludeTotalRef.current = false;
      const data = await fetchOpsTransactions({ ...listFilters, includeTotal });
      if (typeof data.page.total === "number" && typeof data.page.totalPages === "number") {
        lastTotalsKeyRef.current = filterKey;
      }
      return data;
    },
    enabled: listEnabled,
    refetchInterval: listEnabled ? REFRESH_INTERVAL_MS : false,
  });

  useEffect(() => {
    const t = transactionsQuery.data?.page.total;
    const tp = transactionsQuery.data?.page.totalPages;
    if (typeof t === "number" && typeof tp === "number") {
      lastKnownTotalsRef.current = { total: t, totalPages: tp };
    }
  }, [transactionsQuery.data?.page.total, transactionsQuery.data?.page.totalPages]);

  const displayTotal =
    transactionsQuery.data?.page.total != null
      ? transactionsQuery.data.page.total
      : lastKnownTotalsRef.current.total;
  const displayTotalPages =
    transactionsQuery.data?.page.totalPages != null
      ? transactionsQuery.data.page.totalPages
      : lastKnownTotalsRef.current.totalPages;

  const countsFilterKey = useMemo(() => filtersStableKey(listBase), [listBase]);

  const countsQuery = useQuery({
    queryKey: ["dashboard-ops-counts", countsFilterKey],
    queryFn: () => fetchOpsTransactionCounts(listBase),
    enabled: activeTab === "pagos",
    staleTime: 15_000,
  });

  const countsData = countsQuery.data;
  const cAll: number | null = countsData !== undefined ? countsData.total : null;
  const cSucceeded: number | null =
    countsData !== undefined ? (countsData.byStatus.succeeded ?? 0) : null;
  const cRefunded: number | null =
    countsData !== undefined ? (countsData.byStatus.refunded ?? 0) : null;
  const cFailed: number | null = countsData !== undefined ? (countsData.byStatus.failed ?? 0) : null;
  const cCanceled: number | null =
    countsData !== undefined ? (countsData.byStatus.canceled ?? 0) : null;
  const cAuthorized: number | null =
    countsData !== undefined ? (countsData.byStatus.authorized ?? 0) : null;

  const cardCount = useCallback(
    (key: SummaryCardKey): number | null => {
      if (key === "disputed") return null;
      if (key === "all") return cAll;
      if (key === "succeeded") return cSucceeded;
      if (key === "refunded") return cRefunded;
      if (key === "error") {
        if (cFailed == null || cCanceled == null) return null;
        return cFailed + cCanceled;
      }
      if (key === "not_captured") return cAuthorized;
      return null;
    },
    [cAll, cSucceeded, cRefunded, cFailed, cCanceled, cAuthorized],
  );

  const mappedRows: TransactionTableRow[] = useMemo(() => {
    const items = transactionsQuery.data?.items ?? [];
    return items.map(mapOpsItemToTableRow);
  }, [transactionsQuery.data?.items]);

  const pageRows = useMemo(
    () => applyClientRowFilters(mappedRows, applied),
    [mappedRows, applied],
  );

  const toggleSelection = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedOnPage = useMemo(
    () => pageRows.filter((r) => selection.has(r.id)).length,
    [pageRows, selection],
  );
  const allOnPageSelected = pageRows.length > 0 && selectedOnPage === pageRows.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  const toggleSelectAllPage = useCallback(() => {
    setSelection((prev) => {
      const ids = pageRows.map((r) => r.id);
      if (ids.length === 0) return prev;
      const next = new Set(prev);
      const allSel = ids.every((id) => next.has(id));
      if (allSel) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, [pageRows]);

  const columns = useMemo<ColumnDef<TransactionTableRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allOnPageSelected}
            indeterminate={someOnPageSelected}
            onChange={() => toggleSelectAllPage()}
            aria-label="Seleccionar todas en esta página"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selection.has(row.original.id)}
            onChange={() => toggleSelection(row.original.id)}
            aria-label={`Seleccionar ${row.original.id}`}
          />
        ),
        enableHiding: false,
      },
      {
        id: "amount",
        header: "Importe",
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">
            {formatAmountMinor(row.original.amountMinor, row.original.currency)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Estado",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "method",
        header: "Método de pago",
        cell: ({ row }) =>
          row.original.paymentMethodLast4 ? (
            <span className="inline-flex items-center gap-2">
              <VisaMark />
              <span className="text-slate-700">•••• {row.original.paymentMethodLast4}</span>
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        id: "desc",
        header: "Descripción",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-700">{row.original.description}</span>
        ),
      },
      {
        id: "customer",
        header: "Cliente",
        cell: ({ row }) => <span className="text-slate-700">{row.original.customer ?? ""}</span>,
      },
      {
        id: "date",
        header: "Fecha",
        cell: ({ row }) => formatShortDateTime(row.original.createdAt),
      },
      {
        id: "refundDate",
        header: "Fecha de reembolso",
        cell: ({ row }) =>
          row.original.refundedAt ? formatShortDateTime(row.original.refundedAt) : "—",
      },
      {
        id: "reason",
        header: "Motivo",
        cell: ({ row }) =>
          row.original.reasonLabel ? (
            <span className="inline-flex items-center gap-1 text-sm text-slate-700">
              <Mail className="size-3.5 text-slate-500" aria-hidden />
              {row.original.reasonLabel}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <DropdownMenu
            trigger={<span className="text-lg leading-none text-slate-500">⋯</span>}
            align="end"
          >
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(row.original.id);
              }}
            >
              Copiar ID
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                router.push(`/payments/${row.original.id}`);
              }}
            >
              Ver detalle
            </DropdownMenuItem>
          </DropdownMenu>
        ),
        enableHiding: false,
      },
    ],
    [allOnPageSelected, someOnPageSelected, selection, toggleSelectAllPage, toggleSelection, router],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: pageRows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const openDialog = (key: DialogKey) => {
    if (key === "date" || key === "amount" || key === "currency" || key === "status" || key === "method" || key === "more") {
      setDraftAdvanced({ ...applied });
    }
    setDialog(key);
  };

  const applyDraftFilters = () => {
    setApplied({ ...draftAdvanced });
    setCursorStack([null]);
    forceIncludeTotalRef.current = true;
    setDialog(null);
  };

  const clearAdvanced = () => {
    setDraftAdvanced(EMPTY_ADVANCED);
    setApplied(EMPTY_ADVANCED);
    setCursorStack([null]);
    forceIncludeTotalRef.current = true;
    setDialog(null);
  };

  const analyzeStats = useMemo(() => {
    const byApi: Partial<Record<TransactionStatus, number | null>> = {
      succeeded: cSucceeded,
      refunded: cRefunded,
      failed: cFailed,
      canceled: cCanceled,
      authorized: cAuthorized,
      pending: null,
      processing: null,
      requires_action: null,
    };
    let pageMinor = 0;
    for (const r of pageRows) pageMinor += r.amountMinor;
    return { byApi, pageMinor, displayTotal };
  }, [cSucceeded, cRefunded, cFailed, cCanceled, cAuthorized, pageRows, displayTotal]);

  const pageSumMajors = analyzeStats.pageMinor / 100;

  return (
    <div className="rounded-xl border border-[#e3e8ee] bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Transacciones</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#e3e8ee] bg-white"
              disabled={activeTab === "pagos" && summaryKey === "disputed"}
              onClick={() => {
                forceIncludeTotalRef.current = true;
                void transactionsQuery.refetch();
                void countsQuery.refetch();
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refrescar
            </Button>
            <Button type="button" variant="primary" className="gap-1.5" onClick={() => openDialog("create")}>
              <Plus className="size-4 shrink-0" aria-hidden />
              Crear pago
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 border-[#e3e8ee] bg-white"
              onClick={() => openDialog("analyze")}
            >
              <BarChart3 className="size-4" aria-hidden />
              Analizar
            </Button>
          </div>
        </div>

        <nav className="flex gap-6 border-b border-[#e3e8ee]" aria-label="Secciones">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                setCursorStack([null]);
                setSelection(new Set());
              }}
              className={cn(
                "-mb-px border-b-2 pb-3 text-sm font-medium transition-colors",
                activeTab === t.id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {SUMMARY_CARD_ORDER.map((key) => {
            const n = cardCount(key);
            const meta = SUMMARY_CARD_VISUAL[key];
            const Icon = meta.icon;
            const selected = summaryKey === key;
            const disabled = key === "disputed";
            const errorBreakdown =
              key === "error" && cFailed != null && cCanceled != null
                ? { failed: cFailed, canceled: cCanceled }
                : null;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                title={disabled ? "No hay estado disputado en el modelo API actual" : undefined}
                onClick={() => {
                  if (disabled) return;
                  setSummaryKey(key);
                  setCursorStack([null]);
                  forceIncludeTotalRef.current = true;
                }}
                className={cn(
                  "group relative min-w-0 w-full rounded-2xl border px-3 py-3 text-left shadow-sm transition-all duration-200 sm:px-3.5 sm:py-3.5",
                  meta.surface,
                  selected &&
                    "border-[var(--primary)] shadow-[0_0_0_1px_var(--primary),0_8px_24px_-4px_rgba(99,91,255,0.18)] ring-1 ring-[var(--primary)]/25",
                  !selected && !disabled && "active:scale-[0.99]",
                  disabled && "cursor-not-allowed opacity-55 grayscale-[0.35]",
                )}
              >
                <div className="flex items-start gap-2.5 sm:gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 sm:size-10",
                      selected ? meta.iconWrapActive : meta.iconWrap,
                    )}
                    aria-hidden
                  >
                    <Icon className="size-4 stroke-[2.25] sm:size-[1.125rem]" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p
                      className={cn(
                        "text-[10px] font-semibold uppercase leading-tight tracking-wider sm:text-[11px]",
                        selected ? "text-slate-700" : "text-slate-500 group-hover:text-slate-600",
                      )}
                    >
                      {meta.label}
                    </p>
                    {key === "error" ? (
                      errorBreakdown ? (
                        <div className="mt-1 space-y-1">
                          <div className="flex items-baseline justify-between gap-1.5 leading-tight">
                            <span className="text-[10px] font-semibold text-rose-800/90 sm:text-[11px]">Errores</span>
                            <span
                              className={cn(
                                "text-lg font-bold tabular-nums tracking-tight sm:text-xl",
                                selected ? meta.countActive : "text-slate-900",
                              )}
                            >
                              {errorBreakdown.failed.toLocaleString("es")}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-1.5 leading-tight">
                            <span className="text-[10px] font-semibold text-slate-600 sm:text-[11px]">Cancelados</span>
                            <span
                              className={cn(
                                "text-lg font-bold tabular-nums tracking-tight sm:text-xl",
                                selected ? meta.countActive : "text-slate-800",
                              )}
                            >
                              {errorBreakdown.canceled.toLocaleString("es")}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p
                          className={cn(
                            "mt-0.5 text-xl font-bold tabular-nums tracking-tight sm:text-2xl",
                            selected ? meta.countActive : "text-slate-800",
                          )}
                        >
                          <span className="inline-block font-semibold tabular-nums text-slate-400 animate-pulse">
                            ···
                          </span>
                        </p>
                      )
                    ) : (
                      <p
                        className={cn(
                          "mt-0.5 text-xl font-bold tabular-nums tracking-tight sm:text-2xl",
                          selected ? meta.countActive : "text-slate-800",
                        )}
                      >
                        {key === "disputed" || n != null ? (
                          n == null ? (
                            "—"
                          ) : (
                            n.toLocaleString("es")
                          )
                        ) : (
                          <span className="inline-block font-semibold tabular-nums text-slate-400 animate-pulse">
                            ···
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {selected ? (
                  <span
                    className="pointer-events-none absolute inset-x-2 bottom-1.5 h-0.5 rounded-full bg-[var(--primary)]/35 sm:inset-x-3 sm:bottom-2"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox
              checked={allOnPageSelected}
              indeterminate={someOnPageSelected}
              disabled={pageRows.length === 0}
              onChange={() => toggleSelectAllPage()}
              aria-label="Seleccionar todas en esta página"
            />
            {(
              [
                ["date", "+ Fecha y hora"],
                ["amount", "+ Importe"],
                ["currency", "+ Divisa"],
                ["status", "+ Estado"],
                ["method", "+ Proveedor"],
                ["more", "+ Más filtros"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-[#e3e8ee] bg-white text-slate-700"
                onClick={() => openDialog(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#e3e8ee] bg-white"
              onClick={() => exportCsv(pageRows)}
            >
              <Download className="size-4" aria-hidden />
              Exportar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#e3e8ee] bg-white"
              onClick={() => openDialog("columns")}
            >
              <Settings2 className="size-4" aria-hidden />
              Editar columnas
            </Button>
          </div>
        </div>

        {activeTab !== "pagos" ? (
          <p className="rounded-lg border border-dashed border-[#e3e8ee] bg-slate-50/50 py-12 text-center text-sm text-slate-500">
            Sin datos en esta vista.
          </p>
        ) : summaryKey === "disputed" ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50/80 py-8 text-center text-sm text-amber-900">
            El modelo de pagos v2 no expone un estado disputado en el listado operativo. Usa filtros de estado reales
            desde el chip Estado o el{" "}
            <Link href="/monitor" className="font-medium underline">
              monitor API
            </Link>
            .
          </p>
        ) : (
          <>
            {transactionsQuery.isError ? (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle size={16} />
                {(transactionsQuery.error as Error).message}
              </div>
            ) : null}

            <p className="text-xs text-slate-500">
              Importe y divisa en chips se filtran sobre la página cargada (el backend no soporta esos campos en ops).
              {summaryKey === "error" ? (
                <>
                  {" "}
                  La tarjeta desglosa API <code className="rounded bg-slate-100 px-0.5">failed</code> y{" "}
                  <code className="rounded bg-slate-100 px-0.5">canceled</code>; la tabla con esta tarjeta filtra solo{" "}
                  <code className="rounded bg-slate-100 px-0.5">failed</code> (usa el chip Estado para listar cancelados).
                </>
              ) : null}
            </p>

            <TableContainer className="rounded-lg border border-[#e3e8ee]">
              <Table className="min-w-[1100px]">
                <THead className="bg-white">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id} className="border-b border-[#e3e8ee]">
                      {hg.headers.map((h) => (
                        <TH
                          key={h.id}
                          className="whitespace-nowrap px-4 py-3 text-xs font-semibold normal-case tracking-normal text-slate-600 first:rounded-tl-lg last:rounded-tr-lg"
                        >
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </TH>
                      ))}
                    </tr>
                  ))}
                </THead>
                <TBody className="divide-y divide-[#e3e8ee] bg-white">
                  {transactionsQuery.isLoading ? (
                    <tr>
                      <TD colSpan={columns.length} className="py-12 text-center text-slate-500">
                        Cargando transacciones…
                      </TD>
                    </tr>
                  ) : pageRows.length === 0 ? (
                    <tr>
                      <TD colSpan={columns.length} className="py-12 text-center text-slate-500">
                        Sin resultados para los filtros actuales.
                      </TD>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer hover:bg-slate-50/80"
                        onClick={(event) => {
                          const el = event.target as HTMLElement;
                          if (el.closest("button, a, input, label, [data-prevent-row-nav]")) {
                            return;
                          }
                          router.push(`/payments/${row.original.id}`);
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TD key={cell.id} className="whitespace-nowrap px-4 py-3.5 align-middle">
                            {cell.column.id === "actions" ? (
                              <span data-prevent-row-nav>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </TD>
                        ))}
                      </tr>
                    ))
                  )}
                </TBody>
              </Table>
            </TableContainer>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Página {page} de {displayTotalPages}
                {typeof displayTotal === "number" ? <> · Total {displayTotal} partidas</> : null}
                {pageRows.length ? (
                  <>
                    {" "}
                    · Esta vista: {pageRows.length} fila{pageRows.length === 1 ? "" : "s"}
                  </>
                ) : null}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-[#e3e8ee] bg-white"
                  disabled={page <= 1 || !transactionsQuery.data?.page.hasPrevPage}
                  onClick={() => setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-[#e3e8ee] bg-white"
                  disabled={!transactionsQuery.data?.page.hasNextPage || !transactionsQuery.data?.cursors.next}
                  onClick={() => {
                    const next = transactionsQuery.data?.cursors.next ?? null;
                    if (!next) return;
                    setCursorStack((prev) => [...prev, next]);
                  }}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={dialog === "create"} onOpenChange={(o) => !o && setDialog(null)} title="Crear pago" description="Los pagos se originan desde tu integración contra psp-api.">
        <p className="text-sm text-slate-600">
          Este backoffice no crea pagos directamente. Expón un checkout o llama a{" "}
          <code className="rounded bg-slate-100 px-1">POST /api/v2/payments</code> con la API key del merchant.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Para seguimiento operativo de intentos y proveedores, abre el{" "}
          <Link href="/monitor" className="font-medium text-[var(--primary)] underline">
            monitor operativo (API)
          </Link>
          .
        </p>
        <Button type="button" className="mt-4 w-full" variant="primary" onClick={() => setDialog(null)}>
          Entendido
        </Button>
      </Dialog>

      <Dialog open={dialog === "analyze"} onOpenChange={(o) => !o && setDialog(null)} title="Analizar" description="Totales por estado (API) con los mismos filtros de lista salvo tarjeta resumen. Volumen de página: solo filas visibles tras filtros locales.">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Total (API)</dt>
            <dd className="font-medium">{displayTotal ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Suma importe página visible</dt>
            <dd className="font-medium">
              {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                pageSumMajors,
              )}
              <span className="block text-xs font-normal text-slate-500">
                Unidades mayores agregadas (puede mezclar divisas).
              </span>
            </dd>
          </div>
          <div className="border-t border-[#e3e8ee] pt-2">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Por estado (conteo API)</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {(Object.keys(STATUS_LABELS_ES) as TransactionStatus[]).map((s) => (
                <li key={s} className="flex justify-between">
                  <span>{STATUS_LABELS_ES[s]}</span>
                  <span className="tabular-nums">
                    {analyzeStats.byApi[s] == null ? "—" : analyzeStats.byApi[s]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Button type="button" className="mt-2 w-full" variant="outline" onClick={() => setDialog(null)}>
            Cerrar
          </Button>
        </dl>
      </Dialog>

      <Dialog open={dialog === "columns"} onOpenChange={(o) => !o && setDialog(null)} title="Editar columnas" description="Mostrar u ocultar columnas de la tabla.">
        <ul className="space-y-2">
          {(
            [
              ["amount", "Importe"],
              ["status", "Estado"],
              ["method", "Método de pago"],
              ["desc", "Descripción"],
              ["customer", "Cliente"],
              ["date", "Fecha"],
              ["refundDate", "Fecha de reembolso"],
              ["reason", "Motivo"],
            ] as const
          ).map(([id, label]) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="text-sm">{label}</span>
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={columnVisibility[id] !== false}
                onChange={() =>
                  setColumnVisibility((v) => {
                    const visible = v[id] !== false;
                    const next = { ...v };
                    if (visible) next[id] = false;
                    else delete next[id];
                    return next;
                  })
                }
              />
            </li>
          ))}
        </ul>
        <Button type="button" className="mt-4 w-full" variant="primary" onClick={() => setDialog(null)}>
          Listo
        </Button>
      </Dialog>

      <Dialog open={dialog === "date"} onOpenChange={(o) => !o && setDialog(null)} title="Fecha y hora" description="Mapea a createdFrom / createdTo en la API.">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">Desde</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm"
              value={draftAdvanced.dateFrom}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, dateFrom: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Hasta</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm"
              value={draftAdvanced.dateTo}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, dateTo: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={clearAdvanced}>
              Limpiar todo
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={applyDraftFilters}>
              Aplicar
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={dialog === "amount"} onOpenChange={(o) => !o && setDialog(null)} title="Importe" description="Filtro local sobre la página devuelta por el servidor (no hay query por importe en ops).">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">Mínimo (mayor)</label>
            <input
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm"
              value={draftAdvanced.amountMin}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, amountMin: e.target.value }))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Máximo (mayor)</label>
            <input
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm"
              value={draftAdvanced.amountMax}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, amountMax: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="primary" size="sm" onClick={applyDraftFilters}>
              Aplicar
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={dialog === "currency"} onOpenChange={(o) => !o && setDialog(null)} title="Divisa" description="Filtro local ISO (p. ej. EUR, USD) sobre la página cargada.">
        <div className="space-y-2">
          {(["EUR", "USD", "GBP"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={draftAdvanced.currencies.includes(c)}
                onChange={() =>
                  setDraftAdvanced((d) => ({
                    ...d,
                    currencies: d.currencies.includes(c)
                      ? d.currencies.filter((x) => x !== c)
                      : [...d.currencies, c],
                  }))
                }
              />
              {c}
            </label>
          ))}
          <Button type="button" className="mt-2 w-full" variant="primary" size="sm" onClick={applyDraftFilters}>
            Aplicar
          </Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "status"} onOpenChange={(o) => !o && setDialog(null)} title="Estado" description="Se aplica solo si la tarjeta resumen está en «Todos».">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="st"
              checked={draftAdvanced.statusFilter === ""}
              onChange={() => setDraftAdvanced((d) => ({ ...d, statusFilter: "" }))}
            />
            Cualquiera
          </label>
          {(Object.keys(STATUS_LABELS_ES) as TransactionStatus[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="st"
                checked={draftAdvanced.statusFilter === s}
                onChange={() => setDraftAdvanced((d) => ({ ...d, statusFilter: s }))}
              />
              {STATUS_LABELS_ES[s]}
            </label>
          ))}
        </div>
        <Button type="button" className="mt-3 w-full" variant="primary" size="sm" onClick={applyDraftFilters}>
          Aplicar
        </Button>
      </Dialog>

      <Dialog open={dialog === "method"} onOpenChange={(o) => !o && setDialog(null)} title="Proveedor" description="Mapea al query `provider` de la API (stripe | mock).">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pv"
              checked={draftAdvanced.provider === ""}
              onChange={() => setDraftAdvanced((d) => ({ ...d, provider: "" }))}
            />
            Todos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pv"
              checked={draftAdvanced.provider === "stripe"}
              onChange={() => setDraftAdvanced((d) => ({ ...d, provider: "stripe" }))}
            />
            Stripe
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pv"
              checked={draftAdvanced.provider === "mock"}
              onChange={() => setDraftAdvanced((d) => ({ ...d, provider: "mock" }))}
            />
            Mock
          </label>
        </div>
        <Button type="button" className="mt-3 w-full" variant="primary" size="sm" onClick={applyDraftFilters}>
          Aplicar
        </Button>
      </Dialog>

      <Dialog open={dialog === "more"} onOpenChange={(o) => !o && setDialog(null)} title="Más filtros" description="merchantId y paymentId en la API.">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">merchantId</label>
            <input
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm font-mono"
              value={draftAdvanced.merchantId}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, merchantId: e.target.value }))}
              placeholder="uuid…"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">paymentId</label>
            <input
              className="mt-1 w-full rounded-md border border-[#e3e8ee] px-2 py-1.5 text-sm font-mono"
              value={draftAdvanced.paymentId}
              onChange={(e) => setDraftAdvanced((d) => ({ ...d, paymentId: e.target.value }))}
              placeholder="pay_…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraftAdvanced(EMPTY_ADVANCED)}>
              Reiniciar borrador
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={applyDraftFilters}>
              Aplicar
            </Button>
          </div>
        </div>
      </Dialog>

    </div>
  );
}

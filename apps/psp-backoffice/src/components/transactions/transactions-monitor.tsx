"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { AlertCircle, Clock3, RefreshCw } from "lucide-react";
import type {
  OpsTransactionItem,
  TransactionProvider,
  TransactionStatus,
  TransactionsFilters,
} from "@/lib/api/contracts";
import { fetchOpsTransactions, fetchProviderHealth } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

const REFRESH_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS ?? 8_000);
const DEFAULT_PAGE_SIZE = 25;

type FilterDraft = {
  merchantId: string;
  paymentId: string;
  status: "" | TransactionStatus;
  provider: "" | TransactionProvider;
  createdFrom: string;
  createdTo: string;
};

function statusVariant(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "succeeded" || status === "authorized") return "success";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "requires_action" || status === "processing" || status === "pending") {
    return "warning";
  }
  return "neutral";
}

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.valueOf())) return undefined;
  return asDate.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function buildFilters(base: FilterDraft, page: number): TransactionsFilters {
  return {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    merchantId: base.merchantId || undefined,
    paymentId: base.paymentId || undefined,
    status: base.status || undefined,
    provider: base.provider || undefined,
    createdFrom: toIsoDate(base.createdFrom),
    createdTo: toIsoDate(base.createdTo),
  };
}

export function TransactionsMonitor() {
  const [page, setPage] = useState(1);
  const [selectedTransaction, setSelectedTransaction] = useState<OpsTransactionItem | null>(null);
  const [draft, setDraft] = useState<FilterDraft>({
    merchantId: "",
    paymentId: "",
    status: "",
    provider: "",
    createdFrom: "",
    createdTo: "",
  });
  const [appliedDraft, setAppliedDraft] = useState<FilterDraft>(draft);

  const filters = useMemo(() => buildFilters(appliedDraft, page), [appliedDraft, page]);

  const transactionsQuery = useQuery({
    queryKey: ["ops-transactions", filters],
    queryFn: () => fetchOpsTransactions(filters),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const providerHealthQuery = useQuery({
    queryKey: ["provider-health"],
    queryFn: fetchProviderHealth,
    refetchInterval: 15_000,
  });

  const columns = useMemo<ColumnDef<OpsTransactionItem>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Payment",
        cell: ({ row }) => (
          <button
            type="button"
            className="font-medium text-slate-900 underline-offset-4 hover:underline"
            onClick={() => setSelectedTransaction(row.original)}
          >
            {row.original.id}
          </button>
        ),
      },
      {
        accessorKey: "merchantName",
        header: "Merchant",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-900">{row.original.merchantName}</p>
            <p className="text-xs text-slate-500">{row.original.merchantId}</p>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge>,
      },
      {
        accessorKey: "selectedProvider",
        header: "Proveedor",
        cell: ({ row }) => row.original.selectedProvider ?? "-",
      },
      {
        accessorKey: "routingReasonCode",
        header: "Motivo ruteo/fallo",
        cell: ({ row }) => row.original.routingReasonCode ?? "-",
      },
      {
        accessorKey: "amountMinor",
        header: "Monto",
        cell: ({ row }) => {
          const value = row.original.amountMinor / 100;
          return new Intl.NumberFormat("es-ES", {
            style: "currency",
            currency: row.original.currency,
          }).format(value);
        },
      },
      {
        accessorKey: "lastAttempt",
        header: "Ultimo intento",
        cell: ({ row }) => {
          const attempt = row.original.lastAttempt;
          if (!attempt) return "-";
          return (
            <div className="text-xs">
              <p>{attempt.operation}</p>
              <p className="text-slate-500">{attempt.latencyMs ? `${attempt.latencyMs} ms` : "-"}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Creado",
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: transactionsQuery.data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Monitor transaccional</CardTitle>
            <CardDescription>
              Seguimiento operativo en tiempo real con ruteo e intentos por proveedor.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => transactionsQuery.refetch()}
            disabled={transactionsQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            Refrescar
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Input
              placeholder="merchantId"
              value={draft.merchantId}
              onChange={(event) => setDraft((prev) => ({ ...prev, merchantId: event.target.value }))}
            />
            <Input
              placeholder="paymentId"
              value={draft.paymentId}
              onChange={(event) => setDraft((prev) => ({ ...prev, paymentId: event.target.value }))}
            />
            <Select
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as FilterDraft["status"] }))}
            >
              <option value="">Todos los estados</option>
              <option value="pending">pending</option>
              <option value="processing">processing</option>
              <option value="requires_action">requires_action</option>
              <option value="authorized">authorized</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
              <option value="refunded">refunded</option>
            </Select>
            <Select
              value={draft.provider}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, provider: event.target.value as FilterDraft["provider"] }))
              }
            >
              <option value="">Todos los proveedores</option>
              <option value="stripe">stripe</option>
              <option value="mock">mock</option>
            </Select>
            <Input
              type="datetime-local"
              value={draft.createdFrom}
              onChange={(event) => setDraft((prev) => ({ ...prev, createdFrom: event.target.value }))}
            />
            <Input
              type="datetime-local"
              value={draft.createdTo}
              onChange={(event) => setDraft((prev) => ({ ...prev, createdTo: event.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock3 size={14} />
              Auto-refresh cada {Math.floor(REFRESH_INTERVAL_MS / 1000)}s
            </div>
            <Button
              size="sm"
              onClick={() => {
                setPage(1);
                setAppliedDraft(draft);
              }}
            >
              Aplicar filtros
            </Button>
          </div>

          {transactionsQuery.isError ? (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={16} />
              {(transactionsQuery.error as Error).message}
            </div>
          ) : null}

          <TableContainer>
            <Table>
              <THead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TH key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TH>
                    ))}
                  </tr>
                ))}
              </THead>
              <TBody>
                {transactionsQuery.isLoading ? (
                  <tr>
                    <TD colSpan={columns.length} className="py-8 text-center text-slate-500">
                      Cargando transacciones...
                    </TD>
                  </tr>
                ) : table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <TD colSpan={columns.length} className="py-8 text-center text-slate-500">
                      Sin resultados para los filtros actuales.
                    </TD>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      {row.getVisibleCells().map((cell) => (
                        <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                      ))}
                    </tr>
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Total: {transactionsQuery.data?.page.total ?? 0} - Pagina {transactionsQuery.data?.page.page ?? 1} de{" "}
              {transactionsQuery.data?.page.totalPages ?? 1}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!transactionsQuery.data?.page.hasNextPage}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Health de proveedores</CardTitle>
          <CardDescription>Estado actual de circuit breaker por proveedor.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(providerHealthQuery.data?.providers ?? []).map((provider) => (
              <Badge key={provider.provider} variant={provider.open ? "danger" : "success"}>
                {provider.provider} · {provider.open ? "open" : "healthy"} · failures {provider.failures}
              </Badge>
            ))}
            {(providerHealthQuery.data?.providers ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Sin datos de health disponibles.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {selectedTransaction ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Detalle de transaccion</CardTitle>
              <CardDescription>{selectedTransaction.id}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedTransaction(null)}>
              Cerrar
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-slate-500">Merchant:</span> {selectedTransaction.merchantName}
              </p>
              <p>
                <span className="text-slate-500">Estado:</span> {selectedTransaction.status}
              </p>
              <p>
                <span className="text-slate-500">Proveedor:</span> {selectedTransaction.selectedProvider ?? "-"}
              </p>
              <p>
                <span className="text-slate-500">Motivo:</span> {selectedTransaction.routingReasonCode ?? "-"}
              </p>
            </div>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-slate-500">Creado:</span> {formatDate(selectedTransaction.createdAt)}
              </p>
              <p>
                <span className="text-slate-500">Ultimo intento:</span>{" "}
                {formatDate(selectedTransaction.lastAttempt?.createdAt ?? null)}
              </p>
              <p>
                <span className="text-slate-500">Operacion:</span>{" "}
                {selectedTransaction.lastAttempt?.operation ?? "-"}
              </p>
              <p>
                <span className="text-slate-500">Error:</span>{" "}
                {selectedTransaction.lastAttempt?.errorMessage ?? "-"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

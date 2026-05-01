"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMerchantOnboardingApplications } from "@/lib/api/client";
import type { MerchantOnboardingApplicationListItem, MerchantOnboardingStatus } from "@/lib/api/contracts";
import { formatShortDateTime } from "@/lib/ops-transaction-display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

const STATUS_LABELS: Record<MerchantOnboardingStatus, string> = {
  ACCOUNT_CREATED: "Cuenta creada",
  DOCUMENTATION_PENDING: "Documentación pendiente",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  ACTIVE: "Activa",
};

type BadgeVariant = "neutral" | "success" | "warning" | "danger";

function statusVariant(status: MerchantOnboardingStatus): BadgeVariant {
  if (status === "ACTIVE" || status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "IN_REVIEW") return "warning";
  return "neutral";
}

function merchantDisplayName(item: MerchantOnboardingApplicationListItem): string {
  return item.merchant?.name ?? item.tradeName ?? item.legalName ?? item.merchantId;
}

export function OnboardingApplicationsTable() {
  const applicationsQuery = useQuery({
    queryKey: ["merchant-onboarding-applications"],
    queryFn: () => fetchMerchantOnboardingApplications(),
    staleTime: 15_000,
  });

  const items = applicationsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CRM onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">Expedientes de alta merchant para revisión operativa.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Solicitudes</CardTitle>
          <CardDescription>Últimos {applicationsQuery.data?.pageSize ?? 50} expedientes</CardDescription>
        </CardHeader>
        <CardContent>
          {applicationsQuery.isLoading ? (
            <p className="text-sm text-slate-500">Cargando expedientes…</p>
          ) : applicationsQuery.isError ? (
            <p className="text-sm text-rose-700">No se pudo cargar el onboarding CRM.</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">No hay expedientes de onboarding.</p>
          ) : (
            <TableContainer>
              <Table aria-label="Expedientes de onboarding merchant">
                <THead>
                  <tr>
                    <TH scope="col">Merchant</TH>
                    <TH scope="col">Contacto</TH>
                    <TH scope="col">Estado</TH>
                    <TH scope="col">Creado</TH>
                    <TH scope="col">Enviado</TH>
                    <TH scope="col">Acción</TH>
                  </tr>
                </THead>
                <TBody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <TD>
                        <div className="font-medium text-slate-900">{merchantDisplayName(item)}</div>
                        <div className="mt-0.5 font-mono text-xs text-slate-500">{item.merchantId}</div>
                      </TD>
                      <TD>
                        <div className="font-medium text-slate-800">{item.contactName}</div>
                        <a
                          className="text-xs text-[var(--primary)] hover:underline"
                          href={`mailto:${item.contactEmail}`}
                        >
                          {item.contactEmail}
                        </a>
                      </TD>
                      <TD>
                        <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                      </TD>
                      <TD className="text-xs text-slate-500">{formatShortDateTime(item.createdAt)}</TD>
                      <TD className="text-xs text-slate-500">
                        {item.submittedAt ? formatShortDateTime(item.submittedAt) : "—"}
                      </TD>
                      <TD>
                        <Link
                          className="text-sm font-medium text-[var(--primary)] hover:underline"
                          href={`/crm/onboarding/${encodeURIComponent(item.id)}`}
                        >
                          Ver
                        </Link>
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMerchantOnboardingApplication } from "@/lib/api/client";
import type {
  MerchantOnboardingApplicationDetail,
  MerchantOnboardingChecklistStatus,
  MerchantOnboardingStatus,
} from "@/lib/api/contracts";
import { formatShortDateTime } from "@/lib/ops-transaction-display";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingActions } from "./onboarding-actions";

const STATUS_LABELS: Record<MerchantOnboardingStatus, string> = {
  ACCOUNT_CREATED: "Cuenta creada",
  DOCUMENTATION_PENDING: "Documentación pendiente",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  ACTIVE: "Activa",
};

const CHECKLIST_LABELS: Record<MerchantOnboardingChecklistStatus, string> = {
  PENDING: "Pendiente",
  COMPLETED: "Completado",
  BLOCKED: "Bloqueado",
};

type BadgeVariant = "neutral" | "success" | "warning" | "danger";

function statusVariant(status: MerchantOnboardingStatus): BadgeVariant {
  if (status === "ACTIVE" || status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "IN_REVIEW") return "warning";
  return "neutral";
}

function checklistVariant(status: MerchantOnboardingChecklistStatus): BadgeVariant {
  if (status === "COMPLETED") return "success";
  if (status === "BLOCKED") return "danger";
  return "neutral";
}

function merchantDisplayName(application: MerchantOnboardingApplicationDetail): string {
  return application.merchant?.name ?? application.tradeName ?? application.legalName ?? application.merchantId;
}

function OptionalValue({ value }: { value: string | null }) {
  return <>{value?.trim() ? value : "—"}</>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export function OnboardingApplicationDetail({ applicationId }: { applicationId: string }) {
  const applicationQuery = useQuery({
    queryKey: ["merchant-onboarding-application", applicationId],
    queryFn: () => fetchMerchantOnboardingApplication(applicationId),
    staleTime: 10_000,
  });

  const application = applicationQuery.data;

  if (applicationQuery.isLoading) {
    return <p className="text-sm text-slate-500">Cargando expediente…</p>;
  }

  if (applicationQuery.isError || !application) {
    return (
      <div className="space-y-4">
        <Link className="text-sm font-medium text-[var(--primary)] hover:underline" href="/crm/onboarding">
          Volver a CRM onboarding
        </Link>
        <p className="text-sm text-rose-700">No se pudo cargar el expediente de onboarding.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link className="text-sm font-medium text-[var(--primary)] hover:underline" href="/crm/onboarding">
          Volver a CRM onboarding
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{merchantDisplayName(application)}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{application.id}</p>
          </div>
          <Badge variant={statusVariant(application.status)}>{STATUS_LABELS[application.status]}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contacto</CardTitle>
              <CardDescription>Datos enviados al crear la solicitud.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">{application.contactName}</Field>
                <Field label="Email">
                  <a className="text-[var(--primary)] hover:underline" href={`mailto:${application.contactEmail}`}>
                    {application.contactEmail}
                  </a>
                </Field>
                <Field label="Teléfono">{application.contactPhone}</Field>
                <Field label="Merchant ID">
                  <span className="font-mono text-xs">{application.merchantId}</span>
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Negocio</CardTitle>
              <CardDescription>Perfil comercial y legal recibido desde el formulario público.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre comercial">
                  <OptionalValue value={application.tradeName} />
                </Field>
                <Field label="Razón legal">
                  <OptionalValue value={application.legalName} />
                </Field>
                <Field label="País">
                  <OptionalValue value={application.country} />
                </Field>
                <Field label="Tipo de negocio">
                  <OptionalValue value={application.businessType} />
                </Field>
                <Field label="Website">
                  {application.website ? (
                    <a
                      className="text-[var(--primary)] hover:underline"
                      href={application.website}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {application.website}
                    </a>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="Enviado">
                  {application.submittedAt ? formatShortDateTime(application.submittedAt) : "—"}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Checklist</CardTitle>
              <CardDescription>Estado operativo del alta merchant.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {application.checklistItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.label}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">{item.key}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={checklistVariant(item.status)}>{CHECKLIST_LABELS[item.status]}</Badge>
                      <span className="text-xs text-slate-500">
                        {item.completedAt ? formatShortDateTime(item.completedAt) : "—"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acciones</CardTitle>
              <CardDescription>Solo disponibles para estados accionables.</CardDescription>
            </CardHeader>
            <CardContent>
              <OnboardingActions applicationId={application.id} status={application.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fechas</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Field label="Creado">{formatShortDateTime(application.createdAt)}</Field>
                <Field label="Revisado">
                  {application.reviewedAt ? formatShortDateTime(application.reviewedAt) : "—"}
                </Field>
                <Field label="Aprobado">
                  {application.approvedAt ? formatShortDateTime(application.approvedAt) : "—"}
                </Field>
                <Field label="Rechazado">
                  {application.rejectedAt ? formatShortDateTime(application.rejectedAt) : "—"}
                </Field>
                <Field label="Activado">
                  {application.activatedAt ? formatShortDateTime(application.activatedAt) : "—"}
                </Field>
              </dl>
            </CardContent>
          </Card>

          {application.rejectionReason ? (
            <Card className="border-rose-200 bg-rose-50/60">
              <CardHeader>
                <CardTitle className="text-base">Motivo de rechazo</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-rose-900">{application.rejectionReason}</CardContent>
            </Card>
          ) : null}
        </aside>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial</CardTitle>
          <CardDescription>Eventos registrados para este expediente.</CardDescription>
        </CardHeader>
        <CardContent>
          {application.events.length === 0 ? (
            <p className="text-sm text-slate-500">Sin eventos registrados.</p>
          ) : (
            <ol className="space-y-3">
              {application.events.map((event) => (
                <li key={event.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{event.message}</p>
                    <span className="text-xs text-slate-500">{formatShortDateTime(event.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-mono">{event.type}</span> · {event.actorType}
                    {event.actorId ? ` · ${event.actorId}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

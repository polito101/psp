import { redirect } from "next/navigation";
import { AlertTriangle, Clock3, FileWarning, ShieldQuestion } from "lucide-react";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";
import type { MerchantOnboardingSessionStatus } from "@/lib/server/auth/session-claims";
import { getBackofficePortalMode, getPortalLoginPath } from "@/lib/server/portal-mode";

function statusHeading(status: MerchantOnboardingSessionStatus): string {
  switch (status) {
    case "ACCOUNT_CREATED":
      return "Cuenta creada";
    case "DOCUMENTATION_PENDING":
      return "Pendiente de documentación";
    case "IN_REVIEW":
      return "Expediente en revisión";
    case "APPROVED":
      return "Aprobación en curso";
    case "REJECTED":
      return "Expediente rechazado";
    case "ACTIVE":
      return "Portal activo";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusBody(status: MerchantOnboardingSessionStatus, rejectionReason: string | null): string {
  switch (status) {
    case "ACCOUNT_CREATED":
      return "Tu cuenta está creada. Completa la documentación que te hemos indicado por correo para continuar.";
    case "DOCUMENTATION_PENDING":
      return "Estamos pendientes de que envíes o completes la documentación del expediente.";
    case "IN_REVIEW":
      return "Tu documentación está siendo revisada por el equipo de Finara. Te notificaremos cuando haya novedades.";
    case "APPROVED":
      return "Tu expediente ha sido aprobado. En breve activaremos el acceso completo al portal.";
    case "REJECTED":
      return rejectionReason?.trim()
        ? `Rechazado por el siguiente motivo: ${rejectionReason.trim()}`
        : "Tu expediente ha sido rechazado. Si crees que es un error, contacta con soporte.";
    case "ACTIVE":
      return "Tu portal está operativo.";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusIcon(status: MerchantOnboardingSessionStatus) {
  switch (status) {
    case "REJECTED":
      return <AlertTriangle className="h-10 w-10 text-rose-600" aria-hidden />;
    case "DOCUMENTATION_PENDING":
    case "ACCOUNT_CREATED":
      return <FileWarning className="h-10 w-10 text-amber-600" aria-hidden />;
    case "IN_REVIEW":
    case "APPROVED":
      return <Clock3 className="h-10 w-10 text-sky-600" aria-hidden />;
    case "ACTIVE":
      return <ShieldQuestion className="h-10 w-10 text-slate-400" aria-hidden />;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export default async function MerchantStatusPage() {
  const session = await readLayoutSessionFromCookies();
  const loginPath = getPortalLoginPath(getBackofficePortalMode());
  if (!session || session.role !== "merchant") {
    redirect(loginPath);
  }
  if (session.onboardingStatus === "ACTIVE") {
    redirect("/");
  }

  const { onboardingStatus, rejectionReason } = session;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center gap-4 text-center">
          {statusIcon(onboardingStatus)}
          <h1 className="text-xl font-semibold text-slate-900">{statusHeading(onboardingStatus)}</h1>
          <p className="text-pretty text-sm leading-relaxed text-slate-600">
            {statusBody(onboardingStatus, rejectionReason)}
          </p>
        </div>
      </div>
    </div>
  );
}

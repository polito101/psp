"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveMerchantOnboardingApplication,
  rejectMerchantOnboardingApplication,
  resendMerchantOnboardingLink,
} from "@/lib/api/client";
import type { MerchantOnboardingStatus } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";

type Props = {
  applicationId: string;
  status: MerchantOnboardingStatus;
};

export function OnboardingActions({ applicationId, status }: Props) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function refreshOnboardingQueries() {
    await queryClient.invalidateQueries({ queryKey: ["merchant-onboarding-applications"] });
    await queryClient.invalidateQueries({ queryKey: ["merchant-onboarding-application", applicationId] });
  }

  function handleMutationError(err: unknown, fallback: string) {
    console.error(err);
    setError(fallback);
  }

  const approveMutation = useMutation({
    mutationFn: () => approveMerchantOnboardingApplication(applicationId),
    onSuccess: async () => {
      setError(null);
      setMessage("Solicitud aprobada y merchant activado.");
      await refreshOnboardingQueries();
    },
    onError: (err) => {
      setMessage(null);
      handleMutationError(err, "No se pudo aprobar la solicitud. Inténtalo de nuevo.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectMerchantOnboardingApplication(applicationId, { reason }),
    onSuccess: async () => {
      setError(null);
      setMessage("Solicitud rechazada.");
      setRejectReason("");
      await refreshOnboardingQueries();
    },
    onError: (err) => {
      setMessage(null);
      handleMutationError(err, "No se pudo rechazar la solicitud. Inténtalo de nuevo.");
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => resendMerchantOnboardingLink(applicationId),
    onSuccess: async () => {
      setError(null);
      setMessage("Link de onboarding reenviado.");
      await refreshOnboardingQueries();
    },
    onError: (err) => {
      setMessage(null);
      handleMutationError(err, "No se pudo reenviar el link. Inténtalo de nuevo.");
    },
  });

  const busy = approveMutation.isPending || rejectMutation.isPending || resendMutation.isPending;
  const canReview = status === "IN_REVIEW";
  const canResendLink = status === "DOCUMENTATION_PENDING";

  function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setMessage(null);
      setError("Indica un motivo de rechazo de al menos 3 caracteres.");
      return;
    }
    rejectMutation.mutate(reason);
  }

  if (!canReview && !canResendLink) {
    return (
      <p className="text-sm text-slate-600">
        No hay acciones para el estado actual ({status}). Aprobar y rechazar solo están disponibles cuando el
        expediente está <span className="font-medium">En revisión</span> (el merchant debe completar y enviar el
        formulario público de onboarding).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canResendLink && !canReview ? (
        <p className="text-sm text-slate-600">
          Aprobar y rechazar estarán disponibles cuando el estado pase a <span className="font-medium">En revisión</span>{" "}
          tras el envío del formulario por el merchant.
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {canReview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                setError(null);
                approveMutation.mutate();
              }}
            >
              Aprobar
            </Button>
          </div>

          <form className="space-y-2" onSubmit={submitReject}>
            <label htmlFor="onboarding-reject-reason" className="text-sm font-medium text-slate-800">
              Motivo de rechazo
            </label>
            <textarea
              id="onboarding-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              maxLength={2000}
              disabled={busy}
              className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_20%,transparent)] disabled:opacity-60"
              placeholder="Describe qué debe corregir el merchant"
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              Rechazar
            </Button>
          </form>
        </div>
      ) : null}

      {canResendLink ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            setError(null);
            resendMutation.mutate();
          }}
        >
          Reenviar link
        </Button>
      ) : null}
    </div>
  );
}

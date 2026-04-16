"use client";

import { useParams } from "next/navigation";
import { PaymentDetailView } from "@/components/transactions/payment-detail-view";

export default function PaymentDetailPage() {
  const params = useParams();
  const raw = params.paymentId;
  const paymentId = typeof raw === "string" ? decodeURIComponent(raw) : "";
  if (!paymentId) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Identificador de pago no válido.</p>
      </div>
    );
  }
  return <PaymentDetailView paymentId={paymentId} />;
}

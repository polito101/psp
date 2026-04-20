"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function MerchantFinanceLookupPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState("");

  const go = () => {
    const trimmed = merchantId.trim();
    if (!trimmed) return;
    router.push(`/merchants/${encodeURIComponent(trimmed)}/finance`);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Finanzas por merchant</h1>
        <p className="mt-2 text-sm text-slate-600">
          Introduce el identificador del merchant (por ejemplo el que ves en transacciones o en la URL del API).
          También puedes llegar aquí desde el detalle de un pago o el menú de acciones en la tabla de transacciones.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
          <Landmark className="size-5 text-slate-500" aria-hidden />
          <div>
            <CardTitle className="text-lg">Abrir panel</CardTitle>
            <CardDescription>Navega a bruto, comisiones, neto y listados de liquidación.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="merchant-id-lookup" className="text-xs font-medium text-slate-600">
              Merchant ID
            </label>
            <Input
              id="merchant-id-lookup"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") go();
              }}
              placeholder="m_…"
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <Button type="button" onClick={go} disabled={!merchantId.trim()}>
            Ir a finanzas
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import type { LayoutSession } from "@/lib/session-types";
import { AdminHomeDashboard } from "./admin-home-dashboard";
import { MerchantHomeDashboard } from "./merchant-home-dashboard";

export function HomeDashboard({ session }: { session: LayoutSession | null }) {
  if (session?.role === "merchant") {
    return <MerchantHomeDashboard merchantId={session.merchantId} />;
  }
  return <AdminHomeDashboard />;
}

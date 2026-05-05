import { PaymentProvidersDashboard } from "@/components/payment-providers/payment-providers-dashboard";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function PaymentProvidersPage() {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  return <PaymentProvidersDashboard />;
}

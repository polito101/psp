import { PaymentMethodRoutesDashboard } from "@/components/payment-methods/payment-method-routes-dashboard";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function PaymentMethodsPage() {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  return <PaymentMethodRoutesDashboard />;
}

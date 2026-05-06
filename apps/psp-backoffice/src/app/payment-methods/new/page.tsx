import { PaymentMethodRouteEditor } from "@/components/payment-methods/payment-method-route-editor";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function NewPaymentMethodRoutePage() {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  return <PaymentMethodRouteEditor routeId={null} />;
}

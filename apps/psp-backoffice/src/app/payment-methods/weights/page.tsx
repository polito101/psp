import { PaymentMethodWeightTab } from "@/components/payment-methods/payment-method-weight-tab";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function PaymentMethodWeightsPage() {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  return <PaymentMethodWeightTab />;
}

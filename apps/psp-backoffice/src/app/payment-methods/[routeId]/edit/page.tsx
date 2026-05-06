import { PaymentMethodRouteEditor } from "@/components/payment-methods/payment-method-route-editor";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

type PageProps = { params: Promise<{ routeId: string }> };

export default async function EditPaymentMethodRoutePage({ params }: PageProps) {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  const { routeId: raw } = await params;
  const routeId = decodeURIComponent(raw);
  return <PaymentMethodRouteEditor routeId={routeId} />;
}

import { SettlementInboxDashboard } from "@/components/settlements/settlement-inbox-dashboard";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function OperationsPage() {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  return <SettlementInboxDashboard />;
}

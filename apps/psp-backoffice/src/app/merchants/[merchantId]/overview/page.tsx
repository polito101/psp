import { MerchantOverviewDashboard } from "@/components/merchant-portal/merchant-overview-dashboard";
import { ensureMerchantPortalRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

type PageProps = { params: Promise<{ merchantId: string }> };

export default async function MerchantOverviewPage({ params }: PageProps) {
  const session = await readLayoutSessionFromCookies();
  const { merchantId: raw } = await params;
  const merchantId = decodeURIComponent(raw);
  ensureMerchantPortalRoute(session, merchantId);
  return <MerchantOverviewDashboard merchantId={merchantId} />;
}

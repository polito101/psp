import { MerchantAdminPanel } from "@/components/merchants/merchant-admin-panel";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

type PageProps = { params: Promise<{ merchantId: string }> };

export default async function MerchantAdminPage({ params }: PageProps) {
  const session = await readLayoutSessionFromCookies();
  ensureAdminRoute(session);
  const { merchantId: raw } = await params;
  const merchantId = decodeURIComponent(raw);
  return <MerchantAdminPanel merchantId={merchantId} />;
}

import { redirect } from "next/navigation";
import { MerchantsDirectoryTable } from "@/components/merchants/merchants-directory-table";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function MerchantsDirectoryPage() {
  const session = await readLayoutSessionFromCookies();
  if (session?.role === "merchant") {
    redirect(`/merchants/${encodeURIComponent(session.merchantId)}/overview`);
  }
  ensureAdminRoute(session);
  return <MerchantsDirectoryTable />;
}

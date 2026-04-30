import { redirect } from "next/navigation";
import { OnboardingApplicationsTable } from "@/components/crm/onboarding/onboarding-applications-table";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function CrmOnboardingPage() {
  const session = await readLayoutSessionFromCookies();
  if (session?.role === "merchant") {
    redirect(`/merchants/${encodeURIComponent(session.merchantId)}/overview`);
  }
  ensureAdminRoute(session);
  return <OnboardingApplicationsTable />;
}

import { redirect } from "next/navigation";
import { OnboardingApplicationDetail } from "@/components/crm/onboarding/onboarding-application-detail";
import { ensureAdminRoute } from "@/lib/server/ensure-merchant-portal-route";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

type PageProps = { params: Promise<{ applicationId: string }> };

export default async function CrmOnboardingDetailPage({ params }: PageProps) {
  const session = await readLayoutSessionFromCookies();
  if (session?.role === "merchant") {
    redirect(`/merchants/${encodeURIComponent(session.merchantId)}/overview`);
  }
  ensureAdminRoute(session);

  const { applicationId } = await params;
  return <OnboardingApplicationDetail applicationId={decodeURIComponent(applicationId)} />;
}

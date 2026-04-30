import { MerchantOnboardingForm } from "@/components/onboarding/merchant-onboarding-form";

type PageProps = { params: Promise<{ token: string }> };

export default async function MerchantOnboardingPage({ params }: PageProps) {
  const { token } = await params;
  return <MerchantOnboardingForm token={decodeURIComponent(token)} />;
}

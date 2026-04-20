import { MerchantFinanceDashboard } from "@/components/merchant-finance/merchant-finance-dashboard";

type PageProps = {
  params: Promise<{ merchantId: string }>;
};

export default async function MerchantFinancePage({ params }: PageProps) {
  const { merchantId } = await params;
  return <MerchantFinanceDashboard merchantId={merchantId} />;
}

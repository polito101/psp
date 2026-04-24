import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ merchantId: string }> };

export default async function MerchantIndexPage({ params }: PageProps) {
  const { merchantId } = await params;
  redirect(`/merchants/${encodeURIComponent(merchantId)}/overview`);
}

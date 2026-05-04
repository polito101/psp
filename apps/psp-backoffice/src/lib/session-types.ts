import type { MerchantOnboardingSessionStatus } from "@/lib/server/auth/session-claims";

export type LayoutSession =
  | { role: "admin" }
  | {
      role: "merchant";
      merchantId: string;
      onboardingStatus: MerchantOnboardingSessionStatus;
      rejectionReason: string | null;
    };

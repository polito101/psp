import { describe, expect, it } from "vitest";
import { routeWeightGroupKey } from "./payment-method-weight-tab";
import type { PaymentMethodRouteRow } from "@/lib/api/contracts";

function mockRoute(partial: Partial<PaymentMethodRouteRow> & Pick<PaymentMethodRouteRow, "id">): PaymentMethodRouteRow {
  return {
    providerId: "p1",
    methodCode: "mc",
    methodName: "mn",
    countryCode: "MX",
    channel: "ONLINE",
    integrationMode: "REDIRECTION",
    requestTemplate: "REDIRECT_SIMPLE",
    weight: 1,
    isActive: true,
    isPublished: false,
    currencies: [],
    ...partial,
  };
}

describe("routeWeightGroupKey", () => {
  it("agrupa por código, nombre, país y canal", () => {
    const a = mockRoute({ id: "a", methodCode: "x", methodName: "N", countryCode: "MX", channel: "CASH" });
    const b = mockRoute({ id: "b", methodCode: "x", methodName: "N", countryCode: "MX", channel: "CASH" });
    const c = mockRoute({ id: "c", methodCode: "y", methodName: "N", countryCode: "MX", channel: "CASH" });
    expect(routeWeightGroupKey(a)).toBe(routeWeightGroupKey(b));
    expect(routeWeightGroupKey(a)).not.toBe(routeWeightGroupKey(c));
  });
});

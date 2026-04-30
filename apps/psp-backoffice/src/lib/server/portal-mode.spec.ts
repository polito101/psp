import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackofficePortalModeMisconfiguredError,
  getBackofficePortalMode,
} from "./portal-mode";

describe("getBackofficePortalMode", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.BACKOFFICE_PORTAL_MODE;
    delete process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE;
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("throws BackofficePortalModeMisconfiguredError when both env vars are admin|merchant and differ", () => {
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    expect(() => getBackofficePortalMode()).toThrow(BackofficePortalModeMisconfiguredError);
    expect(() => getBackofficePortalMode()).toThrow(
      /BACKOFFICE_PORTAL_MODE \(admin\) and NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE \(merchant\)/,
    );
  });

  it("throws when server is merchant and public is admin", () => {
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    expect(() => getBackofficePortalMode()).toThrow(BackofficePortalModeMisconfiguredError);
  });

  it("does not throw when only BACKOFFICE_PORTAL_MODE is set to a valid mode", () => {
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    expect(getBackofficePortalMode()).toBe("admin");
  });

  it("does not throw when only NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE is set", () => {
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    expect(getBackofficePortalMode()).toBe("merchant");
  });

  it("does not throw when both match", () => {
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    expect(getBackofficePortalMode()).toBe("merchant");
  });

  it("ignores invalid BACKOFFICE_PORTAL_MODE for mismatch check and falls back to public", () => {
    process.env.BACKOFFICE_PORTAL_MODE = "staging";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    expect(getBackofficePortalMode()).toBe("admin");
  });
});

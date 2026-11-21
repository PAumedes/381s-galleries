import { describe, expect, it } from "vitest";
import * as galleries from "../app/lib/server/admin-galleries";

// T6.38: the facade keeps every name importers used before the split.
describe("T6.38 admin-galleries.ts public runtime exports", () => {
  it("exports the same names", () => {
    expect(Object.keys(galleries).sort()).toEqual(
      [
        "CLIENT_MAX",
        "PIN_MAX",
        "PIN_MIN",
        "REORDER_CHUNK",
        "SLUG_MAX",
        "TITLE_MAX",
        "countGalleries",
        "galleryAction",
        "isConstraintError",
        "listGalleries",
        "loadGalleryEdit",
        "photoSetVersion",
      ].sort(),
    );
  });
});

import * as activity from "../app/lib/server/admin-activity";

describe("T6.38 admin-activity.ts public runtime exports", () => {
  it("exports the same names", () => {
    expect(Object.keys(activity).sort()).toEqual(
      [
        "ACTIVITY_PAGE",
        "activityCsv",
        "favoritesTxt",
        "loadActivity",
        "loadFavoritesAdmin",
      ].sort(),
    );
  });
});

import * as googleAuth from "../app/lib/server/google-auth";

describe("T6.38 google-auth.ts public runtime exports", () => {
  it("exports the same names", () => {
    expect(Object.keys(googleAuth).sort()).toEqual(
      [
        "GoogleAuthError",
        "GoogleExchangeError",
        "buildAuthUrl",
        "disconnectGoogle",
        "exchangeCode",
        "getAccessToken",
        "handleCallback",
        "handleConnect",
        "isGoogleConnected",
      ].sort(),
    );
  });
});

import * as logo from "../app/lib/server/logo";

describe("T6.38 logo.ts public runtime exports", () => {
  it("exports the same names", () => {
    expect(Object.keys(logo).sort()).toEqual(
      [
        "LOGO_MAX_BYTES",
        "LOGO_TYPES",
        "LOGO_VARIANTS",
        "SETUP_BODY_MAX_BYTES",
        "getLogoVersions",
        "isLogoVariant",
        "readBodyLimited",
        "resetLogos",
        "saveLogo",
        "serveLogo",
        "validateLogo",
      ].sort(),
    );
  });
});

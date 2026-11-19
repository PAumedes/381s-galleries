import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { setFallbackMessages } from "../../app/i18n/fallback";
import { es } from "../../app/i18n/es";

// Admin components rendered without a root loader fall back to full Spanish.
setFallbackMessages(es);

afterEach(() => {
  cleanup();
});

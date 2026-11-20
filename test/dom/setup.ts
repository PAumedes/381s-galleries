import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { setFallbackMessages } from "../../app/i18n/fallback";
import { es } from "../../app/i18n/es";

// Admin components rendered without a root loader fall back to full Spanish.
setFallbackMessages(es);

// happy-dom ships Element.animate, which would make the lightbox's slide and
// swipe-down exit asynchronous in every test. Off by default (instant, as
// with reduced motion); the motion tests stub their own.
delete (Element.prototype as { animate?: unknown }).animate;

afterEach(() => {
  cleanup();
});

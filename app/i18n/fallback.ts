import { esPublic } from "./es.public";

let fallback: Readonly<Record<string, string>> = esPublic;

/**
 * Messages used when the root loader data is missing (error boundary, leaf
 * components rendered without a router in unit tests). Public Spanish only:
 * the admin strings are never part of a public bundle. Tests that render
 * admin components without a router call `setFallbackMessages(es)`.
 */
export const fallbackMessages = () => fallback;

export function setFallbackMessages(
  messages: Readonly<Record<string, string>>,
) {
  fallback = messages;
}

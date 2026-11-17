import { createContext } from "react-router";

/** Cloudflare ExecutionContext, set per request in workers/app.ts. */
export const executionContext = createContext<ExecutionContext>();

/** Per-request CSP nonce (see security-headers.ts), set in workers/app.ts. */
export const nonceContext = createContext<string>();

import { createContext } from "react-router";

/** Cloudflare ExecutionContext, set per request in workers/app.ts. */
export const executionContext = createContext<ExecutionContext>();

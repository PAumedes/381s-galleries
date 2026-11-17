import { RouterContextProvider, createRequestHandler } from "react-router";
import { executionContext, nonceContext } from "../app/lib/server/context";
import { assertDistinctSecrets } from "../app/lib/server/crypto";
import { getDrive } from "../app/lib/server/drive-factory";
import {
  applySecurityHeaders,
  makeNonce,
} from "../app/lib/server/security-headers";
import { runScheduledSync } from "../app/lib/server/sync";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    // Config error (reused secret): fail loudly rather than run with it.
    assertDistinctSecrets(env);
    const nonce = makeNonce();
    const context = new RouterContextProvider();
    context.set(executionContext, ctx);
    context.set(nonceContext, nonce);
    const res = await requestHandler(request, context);
    return applySecurityHeaders(res, {
      nonce,
      mock: env.DRIVE_MODE === "mock",
    });
  },
  async scheduled(_controller, env, ctx) {
    assertDistinctSecrets(env);
    // Cron (every 15 minutes). The promise rejects on failure so the run is
    // reported as failed; runScheduledSync stores a generic sync_last_error.
    ctx.waitUntil(runScheduledSync(env, getDrive(env)));
  },
} satisfies ExportedHandler<Env>;

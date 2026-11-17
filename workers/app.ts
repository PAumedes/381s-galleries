import { RouterContextProvider, createRequestHandler } from "react-router";
import { executionContext, nonceContext } from "../app/lib/server/context";
import { assertDistinctSecrets } from "../app/lib/server/crypto";
import {
  applySecurityHeaders,
  makeNonce,
} from "../app/lib/server/security-headers";
import { dispatchScheduled } from "../app/lib/server/scheduled";

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
  async scheduled(controller, env, ctx) {
    assertDistinctSecrets(env);
    // "*/15 * * * *" syncs Drive; "* * * * *" warms the R2 cache. The promise
    // rejects on failure so the run is reported as failed.
    ctx.waitUntil(dispatchScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;

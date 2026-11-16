import { RouterContextProvider, createRequestHandler } from "react-router";
import { executionContext } from "../app/lib/server/context";
import { getDrive } from "../app/lib/server/drive-factory";
import { runScheduledSync } from "../app/lib/server/sync";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, _env, ctx) {
    const context = new RouterContextProvider();
    context.set(executionContext, ctx);
    return requestHandler(request, context);
  },
  async scheduled(_controller, env, ctx) {
    // Cron (every 15 minutes). The promise rejects on failure so the run is
    // reported as failed; runScheduledSync stores a generic sync_last_error.
    ctx.waitUntil(runScheduledSync(env, getDrive(env)));
  },
} satisfies ExportedHandler<Env>;

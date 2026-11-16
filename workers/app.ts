import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, _env, _ctx) {
    // Cron stub (every 15 minutes): no-op until sync tasks exist.
  },
} satisfies ExportedHandler<Env>;

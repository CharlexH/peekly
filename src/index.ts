import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import type { } from "@cloudflare/workers-types";
import { collectRoute } from "./routes/collect";
import { trackerRoute } from "./routes/tracker";
import { authRoute } from "./routes/auth";
import { statsRoute } from "./routes/stats";
import { sitesRoute } from "./routes/sites";
import { funnelsRoute } from "./routes/funnels";
import { publicStatsRoute } from "./routes/public-stats";
import { authMiddleware } from "./middleware/auth";
import { handleWeeklyReport } from "./routes/cron";

const app = new Hono<{ Bindings: Env }>();

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// CORS for collect endpoint (permissive, validated per-site in handler)
app.use("/api/collect", cors({ origin: "*" }));

// Public routes
app.route("/api/collect", collectRoute);
app.route("/tracker.js", trackerRoute);
app.route("/api/auth", authRoute);
app.route("/api/public/:token", publicStatsRoute);

// Protected routes
app.use("/api/stats/*", authMiddleware);
app.use("/api/sites/*", authMiddleware);
app.use("/api/funnels/*", authMiddleware);
app.route("/api/stats", statsRoute);
app.route("/api/sites", sitesRoute);
app.route("/api/funnels", funnelsRoute);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleWeeklyReport(env));
  },
};

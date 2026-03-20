import { Hono } from "hono";
import type { Env, CollectPayload } from "../types";
import { generateVisitorHash, getDailySalt } from "../lib/visitor-hash";
import { parseUA } from "../lib/ua-parser";
import { nanoid } from "../lib/nanoid";
import { collectCors } from "../middleware/cors";

export const collectRoute = new Hono<{ Bindings: Env }>();

collectRoute.use("*", collectCors);

collectRoute.post("/", async (c) => {
  try {
    const payload = await c.req.json<CollectPayload>();

    // Validate required fields
    if (!payload.s || !payload.u || !payload.n) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Look up site by tracking ID
    const site = await c.env.DB.prepare(
      "SELECT id, domain FROM sites WHERE tracking_id = ?"
    )
      .bind(payload.s)
      .first<{ id: string; domain: string }>();

    if (!site) {
      return c.json({ error: "Invalid site" }, 404);
    }

    // Extract request info
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const country = c.req.header("cf-ipcountry") || null;
    const ua = c.req.header("user-agent") || "";
    const { browser, os } = parseUA(ua);

    // Generate daily visitor hash
    const salt = await getDailySalt(c.env.DB);
    const visitorHash = await generateVisitorHash(ip, ua, salt);

    const url = new URL(payload.u);
    const path = url.pathname;
    const referrer = payload.r ? extractDomain(payload.r) : null;
    const now = Math.floor(Date.now() / 1000);

    if (payload.n === "pageview") {
      // Check if this visitor already has a pageview in the last 30 min (for bounce detection)
      const recentView = await c.env.DB.prepare(
        "SELECT id FROM pageviews WHERE site_id = ? AND visitor_hash = ? AND timestamp > ? LIMIT 1"
      )
        .bind(site.id, visitorHash, now - 1800)
        .first<{ id: string }>();

      // Insert pageview
      await c.env.DB.prepare(
        `INSERT INTO pageviews (id, site_id, path, referrer, country, browser, os, screen_width, visitor_hash, is_bounce, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nanoid(),
          site.id,
          path,
          referrer,
          country,
          browser,
          os,
          payload.w || null,
          visitorHash,
          recentView ? 0 : 1,
          now
        )
        .run();

      // If visitor had a previous view, mark it as not a bounce
      if (recentView) {
        await c.env.DB.prepare(
          "UPDATE pageviews SET is_bounce = 0 WHERE id = ?"
        )
          .bind(recentView.id)
          .run();
      }
    } else if (payload.n === "pageleave") {
      // Update duration on most recent pageview
      const duration = payload.m?.d as number | undefined;
      if (duration && typeof duration === "number") {
        await c.env.DB.prepare(
          `UPDATE pageviews SET duration = ?
           WHERE site_id = ? AND visitor_hash = ? AND timestamp > ?
           ORDER BY timestamp DESC LIMIT 1`
        )
          .bind(Math.min(duration, 3600), site.id, visitorHash, now - 1800)
          .run();
      }
    } else {
      // Custom event
      await c.env.DB.prepare(
        `INSERT INTO events (id, site_id, name, path, metadata, visitor_hash, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nanoid(),
          site.id,
          payload.n,
          path,
          payload.m ? JSON.stringify(payload.m) : null,
          visitorHash,
          now
        )
        .run();
    }

    return c.body(null, 202);
  } catch (err) {
    console.error("Collect error:", err);
    return c.body(null, 202); // Don't expose errors to tracking script
  }
});

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url || null;
  }
}

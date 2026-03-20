import { Hono } from "hono";
import type { Env } from "../types";
import { getTimeRange } from "../lib/time";

export const statsRoute = new Hono<{ Bindings: Env }>();

function parseQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const siteId = c.req.query("site_id") || "";
  const period = c.req.query("period") || "30d";
  const start = c.req.query("start");
  const end = c.req.query("end");
  const range = getTimeRange(period, start, end);
  return { siteId, range };
}

// Summary: visitors, pageviews, bounce rate, avg duration
statsRoute.get("/summary", async (c) => {
  const { siteId, range } = parseQuery(c);

  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const result = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors,
      ROUND(AVG(CASE WHEN is_bounce = 1 THEN 100.0 ELSE 0.0 END), 1) as bounce_rate,
      ROUND(AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END), 0) as avg_duration
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
  `)
    .bind(siteId, range.start, range.end)
    .first();

  return c.json({
    pageviews: result?.pageviews ?? 0,
    visitors: result?.visitors ?? 0,
    bounce_rate: result?.bounce_rate ?? 0,
    avg_duration: result?.avg_duration ?? 0,
  });
});

// Timeseries: traffic over time
statsRoute.get("/timeseries", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const spanDays = (range.end - range.start) / 86400;
  // Use hourly buckets for periods <= 2 days, daily otherwise
  const bucketSize = spanDays <= 2 ? 3600 : 86400;

  const rows = await c.env.DB.prepare(`
    SELECT
      (timestamp / ? * ?) as bucket,
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(bucketSize, bucketSize, siteId, range.start, range.end)
    .all();

  return c.json({
    interval: bucketSize === 3600 ? "hour" : "day",
    data: rows.results.map((r: Record<string, unknown>) => ({
      timestamp: r.bucket as number,
      date: new Date((r.bucket as number) * 1000).toISOString(),
      pageviews: r.pageviews,
      visitors: r.visitors,
    })),
  });
});

// Top pages
statsRoute.get("/pages", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT path, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY path
    ORDER BY views DESC
    LIMIT 20
  `)
    .bind(siteId, range.start, range.end)
    .all();

  return c.json({ pages: rows.results });
});

// Referrers
statsRoute.get("/referrers", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT
      COALESCE(referrer, 'Direct') as source,
      COUNT(*) as views,
      COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY referrer
    ORDER BY views DESC
    LIMIT 20
  `)
    .bind(siteId, range.start, range.end)
    .all();

  return c.json({ referrers: rows.results });
});

// Devices: browser + OS breakdown
statsRoute.get("/devices", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const [browsers, os, screens] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT browser as name, COUNT(*) as count
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      GROUP BY browser ORDER BY count DESC LIMIT 10
    `).bind(siteId, range.start, range.end),
    c.env.DB.prepare(`
      SELECT os as name, COUNT(*) as count
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      GROUP BY os ORDER BY count DESC LIMIT 10
    `).bind(siteId, range.start, range.end),
    c.env.DB.prepare(`
      SELECT
        CASE
          WHEN screen_width < 768 THEN 'Mobile'
          WHEN screen_width < 1024 THEN 'Tablet'
          ELSE 'Desktop'
        END as device,
        COUNT(*) as count
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND screen_width IS NOT NULL
      GROUP BY device ORDER BY count DESC
    `).bind(siteId, range.start, range.end),
  ]);

  return c.json({
    browsers: browsers.results,
    os: os.results,
    devices: screens.results,
  });
});

// Countries
statsRoute.get("/countries", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT
      COALESCE(country, 'Unknown') as country,
      COUNT(*) as views,
      COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY country
    ORDER BY views DESC
    LIMIT 30
  `)
    .bind(siteId, range.start, range.end)
    .all();

  return c.json({ countries: rows.results });
});

// Custom events
statsRoute.get("/events", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT name, COUNT(*) as count, COUNT(DISTINCT visitor_hash) as visitors
    FROM events
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY name
    ORDER BY count DESC
    LIMIT 20
  `)
    .bind(siteId, range.start, range.end)
    .all();

  return c.json({ events: rows.results });
});

// Realtime: active visitors in last 5 minutes
statsRoute.get("/realtime", async (c) => {
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;

  const result = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT visitor_hash) as active_visitors
    FROM pageviews
    WHERE site_id = ? AND timestamp > ?
  `)
    .bind(siteId, fiveMinAgo)
    .first();

  const recentPages = await c.env.DB.prepare(`
    SELECT path, COUNT(*) as views
    FROM pageviews
    WHERE site_id = ? AND timestamp > ?
    GROUP BY path ORDER BY views DESC LIMIT 10
  `)
    .bind(siteId, fiveMinAgo)
    .all();

  return c.json({
    active_visitors: result?.active_visitors ?? 0,
    pages: recentPages.results,
  });
});

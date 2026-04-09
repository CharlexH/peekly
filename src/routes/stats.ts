import { Hono } from "hono";
import type { Env } from "../types";
import { getTimeRange, getPreviousRange } from "../lib/time";

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

  const prev = getPreviousRange(range);
  const summarySQL = `
    SELECT
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors,
      ROUND(AVG(CASE WHEN is_bounce = 1 THEN 100.0 ELSE 0.0 END), 1) as bounce_rate,
      ROUND(AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END), 0) as avg_duration
    FROM pageviews
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
  `;

  const [currentRes, prevRes] = await c.env.DB.batch([
    c.env.DB.prepare(summarySQL).bind(siteId, range.start, range.end),
    c.env.DB.prepare(summarySQL).bind(siteId, prev.start, prev.end),
  ]);

  const result = currentRes.results[0] as Record<string, unknown> | undefined;
  const prevResult = prevRes.results[0] as Record<string, unknown> | undefined;

  function delta(curr: number, previous: number): number | null {
    if (previous === 0) return curr > 0 ? 100 : null;
    return Math.round(((curr - previous) / previous) * 100);
  }

  const visitors = Number(result?.visitors ?? 0);
  const pageviews = Number(result?.pageviews ?? 0);
  const bounceRate = Number(result?.bounce_rate ?? 0);
  const avgDuration = Number(result?.avg_duration ?? 0);
  const prevVisitors = Number(prevResult?.visitors ?? 0);
  const prevPageviews = Number(prevResult?.pageviews ?? 0);
  const prevBounce = Number(prevResult?.bounce_rate ?? 0);
  const prevDuration = Number(prevResult?.avg_duration ?? 0);

  // Sparkline: daily visitors for last 7 days
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const sparkRows = await c.env.DB.prepare(`
    SELECT
      (timestamp / 86400 * 86400) as day,
      COUNT(DISTINCT visitor_hash) as visitors,
      COUNT(*) as pageviews
    FROM pageviews
    WHERE site_id = ? AND timestamp > ?
    GROUP BY day ORDER BY day ASC
  `)
    .bind(siteId, sevenDaysAgo)
    .all();

  return c.json({
    pageviews,
    visitors,
    bounce_rate: bounceRate,
    avg_duration: avgDuration,
    compare: {
      visitors: delta(visitors, prevVisitors),
      pageviews: delta(pageviews, prevPageviews),
      bounce_rate: delta(bounceRate, prevBounce),
      avg_duration: delta(avgDuration, prevDuration),
    },
    sparkline: sparkRows.results.map((r: Record<string, unknown>) => ({
      visitors: r.visitors as number,
      pageviews: r.pageviews as number,
    })),
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

// Entry pages (first page per session)
statsRoute.get("/entry-pages", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT path, COUNT(*) as entries, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews p
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      AND timestamp = (
        SELECT MIN(p2.timestamp) FROM pageviews p2
        WHERE p2.site_id = p.site_id
          AND p2.visitor_hash = p.visitor_hash
          AND (p2.timestamp / 1800) = (p.timestamp / 1800)
          AND p2.timestamp BETWEEN ? AND ?
      )
    GROUP BY path ORDER BY entries DESC LIMIT 20
  `)
    .bind(siteId, range.start, range.end, range.start, range.end)
    .all();

  return c.json({ entry_pages: rows.results });
});

// Exit pages (last page per session)
statsRoute.get("/exit-pages", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const rows = await c.env.DB.prepare(`
    SELECT path, COUNT(*) as exits, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews p
    WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      AND timestamp = (
        SELECT MAX(p2.timestamp) FROM pageviews p2
        WHERE p2.site_id = p.site_id
          AND p2.visitor_hash = p.visitor_hash
          AND (p2.timestamp / 1800) = (p.timestamp / 1800)
          AND p2.timestamp BETWEEN ? AND ?
      )
    GROUP BY path ORDER BY exits DESC LIMIT 20
  `)
    .bind(siteId, range.start, range.end, range.start, range.end)
    .all();

  return c.json({ exit_pages: rows.results });
});

// UTM campaigns
statsRoute.get("/utm", async (c) => {
  const { siteId, range } = parseQuery(c);
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const [sources, mediums, campaigns] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT utm_source as name, COUNT(*) as count, COUNT(DISTINCT visitor_hash) as visitors
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND utm_source IS NOT NULL
      GROUP BY utm_source ORDER BY count DESC LIMIT 20
    `).bind(siteId, range.start, range.end),
    c.env.DB.prepare(`
      SELECT utm_medium as name, COUNT(*) as count, COUNT(DISTINCT visitor_hash) as visitors
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND utm_medium IS NOT NULL
      GROUP BY utm_medium ORDER BY count DESC LIMIT 20
    `).bind(siteId, range.start, range.end),
    c.env.DB.prepare(`
      SELECT utm_campaign as name, COUNT(*) as count, COUNT(DISTINCT visitor_hash) as visitors
      FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND utm_campaign IS NOT NULL
      GROUP BY utm_campaign ORDER BY count DESC LIMIT 20
    `).bind(siteId, range.start, range.end),
  ]);

  return c.json({
    sources: sources.results,
    mediums: mediums.results,
    campaigns: campaigns.results,
  });
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

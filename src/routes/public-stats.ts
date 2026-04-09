import { Hono } from "hono";
import type { Env } from "../types";
import { getTimeRange, getPreviousRange } from "../lib/time";

export const publicStatsRoute = new Hono<{ Bindings: Env }>();

// Middleware: validate share token and resolve site_id
publicStatsRoute.use("*", async (c, next) => {
  const token = c.req.param("token") || c.req.query("token");
  if (!token) return c.json({ error: "Token required" }, 401);

  const site = await c.env.DB.prepare(
    "SELECT id, name, domain FROM sites WHERE share_token = ?"
  )
    .bind(token)
    .first<{ id: string; name: string; domain: string }>();

  if (!site) return c.json({ error: "Invalid or expired share link" }, 404);

  c.set("siteId" as never, site.id as never);
  c.set("siteName" as never, site.name as never);
  c.set("siteDomain" as never, site.domain as never);
  await next();
});

function parsePublicQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const period = c.req.query("period") || "30d";
  const start = c.req.query("start");
  const end = c.req.query("end");
  return getTimeRange(period, start, end);
}

publicStatsRoute.get("/info", async (c) => {
  return c.json({
    name: c.get("siteName" as never),
    domain: c.get("siteDomain" as never),
  });
});

publicStatsRoute.get("/summary", async (c) => {
  const siteId = c.get("siteId" as never) as string;
  const range = parsePublicQuery(c);
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

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const sparkRows = await c.env.DB.prepare(`
    SELECT (timestamp / 86400 * 86400) as day, COUNT(DISTINCT visitor_hash) as visitors, COUNT(*) as pageviews
    FROM pageviews WHERE site_id = ? AND timestamp > ? GROUP BY day ORDER BY day ASC
  `).bind(siteId, sevenDaysAgo).all();

  return c.json({
    pageviews, visitors, bounce_rate: bounceRate, avg_duration: avgDuration,
    compare: {
      visitors: delta(visitors, Number(prevResult?.visitors ?? 0)),
      pageviews: delta(pageviews, Number(prevResult?.pageviews ?? 0)),
      bounce_rate: delta(bounceRate, Number(prevResult?.bounce_rate ?? 0)),
      avg_duration: delta(avgDuration, Number(prevResult?.avg_duration ?? 0)),
    },
    sparkline: sparkRows.results.map((r: Record<string, unknown>) => ({
      visitors: r.visitors as number, pageviews: r.pageviews as number,
    })),
  });
});

publicStatsRoute.get("/timeseries", async (c) => {
  const siteId = c.get("siteId" as never) as string;
  const range = parsePublicQuery(c);
  const spanDays = (range.end - range.start) / 86400;
  const bucketSize = spanDays <= 2 ? 3600 : 86400;

  const rows = await c.env.DB.prepare(`
    SELECT (timestamp / ? * ?) as bucket, COUNT(*) as pageviews, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY bucket ORDER BY bucket ASC
  `).bind(bucketSize, bucketSize, siteId, range.start, range.end).all();

  return c.json({
    interval: bucketSize === 3600 ? "hour" : "day",
    data: rows.results.map((r: Record<string, unknown>) => ({
      timestamp: r.bucket as number,
      date: new Date((r.bucket as number) * 1000).toISOString(),
      pageviews: r.pageviews, visitors: r.visitors,
    })),
  });
});

publicStatsRoute.get("/pages", async (c) => {
  const siteId = c.get("siteId" as never) as string;
  const range = parsePublicQuery(c);
  const rows = await c.env.DB.prepare(`
    SELECT path, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY path ORDER BY views DESC LIMIT 20
  `).bind(siteId, range.start, range.end).all();
  return c.json({ pages: rows.results });
});

publicStatsRoute.get("/referrers", async (c) => {
  const siteId = c.get("siteId" as never) as string;
  const range = parsePublicQuery(c);
  const rows = await c.env.DB.prepare(`
    SELECT COALESCE(referrer, 'Direct') as source, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY referrer ORDER BY views DESC LIMIT 20
  `).bind(siteId, range.start, range.end).all();
  return c.json({ referrers: rows.results });
});

publicStatsRoute.get("/countries", async (c) => {
  const siteId = c.get("siteId" as never) as string;
  const range = parsePublicQuery(c);
  const rows = await c.env.DB.prepare(`
    SELECT COALESCE(country, 'Unknown') as country, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY country ORDER BY views DESC LIMIT 30
  `).bind(siteId, range.start, range.end).all();
  return c.json({ countries: rows.results });
});

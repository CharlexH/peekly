import { Hono } from "hono";
import type { Env } from "../types";
import { nanoid } from "../lib/nanoid";
import { getTimeRange } from "../lib/time";

export const funnelsRoute = new Hono<{ Bindings: Env }>();

interface FunnelStep {
  name: string;
  match_type: "path" | "event" | "starts_with" | "event_meta";
  match_value: string;
}

// List funnels for a site
funnelsRoute.get("/", async (c) => {
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required" }, 400);

  const funnels = await c.env.DB.prepare(
    "SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at DESC"
  ).bind(siteId).all();

  return c.json({ funnels: funnels.results });
});

// Create funnel
funnelsRoute.post("/", async (c) => {
  const body = await c.req.json<{ site_id: string; name: string; steps: FunnelStep[] }>();
  if (!body.site_id || !body.name || !body.steps?.length) {
    return c.json({ error: "site_id, name, and steps required" }, 400);
  }
  if (body.steps.length < 2) {
    return c.json({ error: "A funnel needs at least 2 steps" }, 400);
  }
  const validTypes = ["path", "event", "starts_with", "event_meta"];
  if (body.steps.some(s => s.match_type && !validTypes.includes(s.match_type))) {
    return c.json({ error: "Invalid match_type" }, 400);
  }

  const funnelId = nanoid(12);
  const stmts = [
    c.env.DB.prepare("INSERT INTO funnels (id, site_id, name) VALUES (?, ?, ?)")
      .bind(funnelId, body.site_id, body.name),
    ...body.steps.map((step, i) =>
      c.env.DB.prepare(
        "INSERT INTO funnel_steps (id, funnel_id, step_order, name, match_type, match_value) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(nanoid(12), funnelId, i, step.name, step.match_type || "path", step.match_value)
    ),
  ];

  await c.env.DB.batch(stmts);
  return c.json({ id: funnelId }, 201);
});

// Delete funnel
funnelsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM funnel_steps WHERE funnel_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM funnels WHERE id = ?").bind(id),
  ]);
  return c.json({ success: true });
});

// Analyze funnel — compute conversion at each step
funnelsRoute.get("/:id/analyze", async (c) => {
  const funnelId = c.req.param("id");
  const period = c.req.query("period") || "30d";
  const start = c.req.query("start");
  const end = c.req.query("end");
  const range = getTimeRange(period, start, end);

  // Get funnel + steps
  const funnel = await c.env.DB.prepare("SELECT * FROM funnels WHERE id = ?")
    .bind(funnelId).first<{ id: string; site_id: string; name: string }>();
  if (!funnel) return c.json({ error: "Funnel not found" }, 404);

  const steps = await c.env.DB.prepare(
    "SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY step_order ASC"
  ).bind(funnelId).all<{ id: string; step_order: number; name: string; match_type: string; match_value: string }>();

  if (!steps.results.length) return c.json({ error: "No steps" }, 400);

  // Sequential funnel: visitors must complete step N before qualifying for step N+1
  const stepResults: { name: string; visitors: number; conversion: number }[] = [];
  let eligibleVisitors: Set<string> | null = null;

  for (let i = 0; i < steps.results.length; i++) {
    const step = steps.results[i];
    let rows: { visitor_hash: string }[];

    if (step.match_type === "event") {
      const result = await c.env.DB.prepare(`
        SELECT DISTINCT visitor_hash
        FROM events
        WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND name = ?
      `).bind(funnel.site_id, range.start, range.end, step.match_value)
        .all<{ visitor_hash: string }>();
      rows = result.results;
    } else if (step.match_type === "starts_with") {
      const result = await c.env.DB.prepare(`
        SELECT DISTINCT visitor_hash
        FROM pageviews
        WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND path LIKE ? AND path != ?
      `).bind(funnel.site_id, range.start, range.end, step.match_value + "%", step.match_value)
        .all<{ visitor_hash: string }>();
      rows = result.results;
    } else if (step.match_type === "event_meta") {
      // Format: "eventName::jsonField::pattern"
      const parts = step.match_value.split("::");
      if (parts.length >= 3) {
        const [eventName, jsonField, pattern] = parts;
        const result = await c.env.DB.prepare(`
          SELECT DISTINCT visitor_hash
          FROM events
          WHERE site_id = ? AND timestamp BETWEEN ? AND ?
            AND name = ?
            AND json_extract(metadata, ?) LIKE ?
        `).bind(funnel.site_id, range.start, range.end, eventName, "$." + jsonField, "%" + pattern + "%")
          .all<{ visitor_hash: string }>();
        rows = result.results;
      }
    } else {
      const result = await c.env.DB.prepare(`
        SELECT DISTINCT visitor_hash
        FROM pageviews
        WHERE site_id = ? AND timestamp BETWEEN ? AND ? AND path = ?
      `).bind(funnel.site_id, range.start, range.end, step.match_value)
        .all<{ visitor_hash: string }>();
      rows = result.results;
    }

    const stepVisitors = new Set(rows.map(r => r.visitor_hash));

    // Intersect with eligible visitors from previous step
    if (eligibleVisitors !== null) {
      const intersected = new Set<string>();
      for (const v of stepVisitors) {
        if (eligibleVisitors.has(v)) intersected.add(v);
      }
      eligibleVisitors = intersected;
    } else {
      eligibleVisitors = stepVisitors;
    }

    const count = eligibleVisitors.size;
    const prevCount = i > 0 ? stepResults[i - 1].visitors : count;
    stepResults.push({
      name: step.name,
      visitors: count,
      conversion: prevCount > 0 ? Math.round((count / prevCount) * 100) : 0,
    });
  }

  return c.json({
    funnel: { id: funnel.id, name: funnel.name },
    steps: stepResults,
    overall: stepResults.length > 1 && stepResults[0].visitors > 0
      ? Math.round((stepResults[stepResults.length - 1].visitors / stepResults[0].visitors) * 100)
      : 0,
  });
});

import { Hono } from "hono";
import type { Env, Site } from "../types";
import { nanoid } from "../lib/nanoid";

export const sitesRoute = new Hono<{ Bindings: Env }>();

sitesRoute.get("/", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM sites ORDER BY created_at DESC").all<Site>();
  return c.json({ sites: result.results });
});

sitesRoute.post("/", async (c) => {
  const body = await c.req.json<{ name: string; domain: string }>();

  if (!body.name || !body.domain) {
    return c.json({ error: "Name and domain required" }, 400);
  }

  const id = nanoid(12);
  const trackingId = `pk_${nanoid(8)}`;

  await c.env.DB.prepare(
    "INSERT INTO sites (id, name, domain, tracking_id) VALUES (?, ?, ?, ?)"
  )
    .bind(id, body.name, body.domain.toLowerCase(), trackingId)
    .run();

  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE id = ?")
    .bind(id)
    .first<Site>();

  return c.json({ site }, 201);
});

// Enable/disable public sharing
sitesRoute.post("/:id/share", async (c) => {
  const id = c.req.param("id");
  const token = nanoid(16);
  await c.env.DB.prepare("UPDATE sites SET share_token = ? WHERE id = ?")
    .bind(token, id)
    .run();
  return c.json({ share_token: token });
});

sitesRoute.delete("/:id/share", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE sites SET share_token = NULL WHERE id = ?")
    .bind(id)
    .run();
  return c.json({ success: true });
});

sitesRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Delete associated data
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM pageviews WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM events WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
  ]);

  return c.json({ success: true });
});

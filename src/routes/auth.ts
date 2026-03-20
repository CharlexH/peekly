import { Hono } from "hono";
import type { Env } from "../types";
import { verifyPassword, signJWT, verifyJWT } from "../lib/crypto";

export const authRoute = new Hono<{ Bindings: Env }>();

authRoute.post("/login", async (c) => {
  const body = await c.req.json<{ password: string }>();

  if (!body.password) {
    return c.json({ error: "Password required" }, 400);
  }

  if (!c.env.AUTH_PASSWORD_HASH) {
    return c.json({ error: "Auth not configured" }, 500);
  }

  const valid = await verifyPassword(body.password, c.env.AUTH_PASSWORD_HASH);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    { sub: "admin", iat: now, exp: now + 7 * 86400 },
    c.env.JWT_SECRET
  );

  return c.json({ token });
});

authRoute.post("/verify", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ valid: false }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ valid: false }, 401);
  }

  return c.json({ valid: true, exp: payload.exp });
});

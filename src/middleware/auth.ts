import { Context, Next } from "hono";
import type { Env } from "../types";
import { verifyJWT } from "../lib/crypto";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await next();
}

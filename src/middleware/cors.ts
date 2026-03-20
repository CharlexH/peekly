import { Context, Next } from "hono";
import type { Env } from "../types";

export async function collectCors(c: Context<{ Bindings: Env }>, next: Next) {
  const origin = c.req.header("origin") || "";

  // Allow the collect endpoint from any origin — we validate site tracking_id in the handler
  c.header("Access-Control-Allow-Origin", origin || "*");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Max-Age", "86400");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
}

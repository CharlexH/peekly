import { Hono } from "hono";
import type { Env } from "../types";
import { TRACKER_SCRIPT } from "../tracker/script";

export const trackerRoute = new Hono<{ Bindings: Env }>();

trackerRoute.get("/", (c) => {
  return c.body(TRACKER_SCRIPT, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  });
});

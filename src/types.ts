export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  AUTH_PASSWORD_HASH: string;
  APP_NAME: string;
  REPORT_EMAIL?: string;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  tracking_id: string;
  share_token: string | null;
  created_at: number;
}

export interface Pageview {
  id: string;
  site_id: string;
  path: string;
  referrer: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  screen_width: number | null;
  visitor_hash: string;
  is_bounce: number;
  duration: number;
  timestamp: number;
}

export interface AnalyticsEvent {
  id: string;
  site_id: string;
  name: string;
  path: string | null;
  metadata: string | null;
  visitor_hash: string | null;
  timestamp: number;
}

export interface CollectPayload {
  n: string;       // event name ("pageview" or custom)
  u: string;       // page URL
  r?: string;      // referrer
  w?: number;      // screen width
  s: string;       // site tracking ID
  m?: Record<string, unknown>; // metadata (custom events or pageleave duration)
}

export interface StatsQuery {
  site_id: string;
  period: string;  // "today" | "7d" | "30d" | "90d" | "custom"
  start?: string;  // ISO date
  end?: string;    // ISO date
}

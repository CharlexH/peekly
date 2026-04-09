-- Peekly Analytics Schema

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  tracking_id TEXT NOT NULL UNIQUE,
  share_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sites_share_token ON sites(share_token);

CREATE TABLE IF NOT EXISTS pageviews (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  browser TEXT,
  os TEXT,
  screen_width INTEGER,
  visitor_hash TEXT NOT NULL,
  is_bounce INTEGER NOT NULL DEFAULT 1,
  duration INTEGER DEFAULT 0,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_pv_site_ts ON pageviews(site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_site_path ON pageviews(site_id, path, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_site_referrer ON pageviews(site_id, referrer, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_visitor ON pageviews(site_id, visitor_hash, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_site_utm ON pageviews(site_id, utm_source, timestamp);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  metadata TEXT,
  visitor_hash TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_ev_site_ts ON events(site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ev_site_name ON events(site_id, name, timestamp);

CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS funnel_steps (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'path',
  match_value TEXT NOT NULL,
  FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_funnel_site ON funnels(site_id);
CREATE INDEX IF NOT EXISTS idx_funnel_steps ON funnel_steps(funnel_id, step_order);

CREATE TABLE IF NOT EXISTS salts (
  date TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

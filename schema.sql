-- Peekly Analytics Schema

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  tracking_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_pv_site_ts ON pageviews(site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_site_path ON pageviews(site_id, path, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_site_referrer ON pageviews(site_id, referrer, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_visitor ON pageviews(site_id, visitor_hash, timestamp);

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

CREATE TABLE IF NOT EXISTS salts (
  date TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

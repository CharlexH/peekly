-- Funnel tracking tables
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

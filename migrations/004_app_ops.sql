-- App Ops sidecar tables.
-- These tables are independent from the existing website analytics model.

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  bundle_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS app_environments (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  collect_key TEXT UNIQUE,
  source_kind TEXT NOT NULL DEFAULT 'peekly',
  source_binding TEXT,
  source_database_name TEXT,
  is_production INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  UNIQUE(app_id, name)
);

CREATE INDEX IF NOT EXISTS idx_app_environments_app ON app_environments(app_id);

CREATE TABLE IF NOT EXISTS app_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  app_version TEXT,
  platform_version TEXT,
  country TEXT,
  install_hash TEXT,
  session_hash TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES app_environments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_events_app_env_ts ON app_events(app_id, environment_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_app_events_name_ts ON app_events(app_id, event_name, timestamp);

CREATE TABLE IF NOT EXISTS provider_usage_snapshots (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  window_start INTEGER,
  window_end INTEGER,
  source TEXT,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES app_environments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_app_env_metric ON provider_usage_snapshots(app_id, environment_id, provider, metric, captured_at);

CREATE TABLE IF NOT EXISTS provider_quota_snapshots (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  quota_type TEXT NOT NULL,
  used REAL,
  limit_value REAL,
  remaining REAL,
  unit TEXT,
  source TEXT,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES app_environments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_quota_app_env_type ON provider_quota_snapshots(app_id, environment_id, provider, quota_type, captured_at);

CREATE TABLE IF NOT EXISTS app_alerts (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  environment_id TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES app_environments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_app_alerts_app_status ON app_alerts(app_id, status, severity, created_at);

INSERT OR IGNORE INTO apps (id, name, slug, platform, bundle_id, status)
VALUES ('app_nians_storybook', '月光故事', 'nians-storybook', 'ios', 'com.charlex.nianstorybook', 'active');

INSERT OR IGNORE INTO app_environments (
  id,
  app_id,
  name,
  label,
  collect_key,
  source_kind,
  source_binding,
  source_database_name,
  is_production
)
VALUES
  (
    'env_nians_sandbox',
    'app_nians_storybook',
    'sandbox',
    'Sandbox / TestFlight',
    'pk_app_nians_sandbox',
    'nians_d1',
    'NIANS_SANDBOX_DB',
    'nians-storybook-ledger',
    0
  ),
  (
    'env_nians_production',
    'app_nians_storybook',
    'production',
    'Production',
    'pk_app_nians_prod',
    'nians_d1',
    'NIANS_PROD_DB',
    'nians-storybook-ledger-prod',
    1
  );

-- Add UTM tracking columns to pageviews
ALTER TABLE pageviews ADD COLUMN utm_source TEXT;
ALTER TABLE pageviews ADD COLUMN utm_medium TEXT;
ALTER TABLE pageviews ADD COLUMN utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_pv_site_utm ON pageviews(site_id, utm_source, timestamp);

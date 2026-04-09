-- Add share token for public dashboards
ALTER TABLE sites ADD COLUMN share_token TEXT;
CREATE INDEX IF NOT EXISTS idx_sites_share_token ON sites(share_token);

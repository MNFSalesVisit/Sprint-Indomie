-- Migration 012: API Usage Tracking for Super Admin Usage Monitor
-- Lightweight table to track internal API call counts per endpoint.
-- Rows older than 30 days are purged automatically by the usage-metrics API.

CREATE TABLE IF NOT EXISTS api_logs (
  id          bigserial       PRIMARY KEY,
  endpoint    text            NOT NULL,
  module      text            NOT NULL,  -- 'admin' | 'salesperson' | 'super-admin'
  called_at   timestamptz     NOT NULL DEFAULT now()
);

-- Indexes for fast aggregation queries used by the Usage Monitor dashboard
CREATE INDEX IF NOT EXISTS idx_api_logs_called_at ON api_logs (called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_module    ON api_logs (module,   called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint  ON api_logs (endpoint, called_at DESC);

-- Row-level security: service role only (no public access)
ALTER TABLE api_logs ENABLE ROW LEVEL SECURITY;

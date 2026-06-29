-- Aggregated daily edge-request counter (one row per date+module, never grows unbounded)
CREATE TABLE IF NOT EXISTS edge_usage (
  id            bigserial   PRIMARY KEY,
  date          date        NOT NULL,
  module        text        NOT NULL,  -- 'admin' | 'salesperson' | 'super-admin'
  request_count integer     NOT NULL DEFAULT 0,
  UNIQUE (date, module)
);

CREATE INDEX IF NOT EXISTS idx_edge_usage_date   ON edge_usage (date   DESC);
CREATE INDEX IF NOT EXISTS idx_edge_usage_module ON edge_usage (module, date DESC);

ALTER TABLE edge_usage ENABLE ROW LEVEL SECURITY;

-- Atomic upsert-increment called once per API request (fire-and-forget)
-- Never creates duplicate rows; DB write is a single index lookup + counter bump
CREATE OR REPLACE FUNCTION increment_edge_usage(p_date date, p_module text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO edge_usage (date, module, request_count)
  VALUES (p_date, p_module, 1)
  ON CONFLICT (date, module)
  DO UPDATE SET request_count = edge_usage.request_count + 1;
$$;

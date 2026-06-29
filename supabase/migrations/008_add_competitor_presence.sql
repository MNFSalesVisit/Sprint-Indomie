alter table visits
  add column if not exists competitor_presence text[];

-- optional index to speed up queries filtering by presence
create index if not exists idx_visits_competitor_presence on visits using gin (competitor_presence);

create extension if not exists pgcrypto;

create table if not exists scan_runs (
  id uuid primary key default gen_random_uuid(),
  week_of_date date not null,
  generated_at timestamptz not null default now(),
  source_mode text not null default 'seeded',
  notes jsonb not null default '[]'::jsonb
);

create table if not exists event_candidates (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references scan_runs(id) on delete cascade,
  event_key text not null,
  title text not null,
  kind text not null,
  event_date date not null,
  event_label text not null,
  time_label text not null,
  scope text not null,
  market_proxy text not null,
  ranking jsonb not null,
  probability_overlay jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_candidates_scan_run_id on event_candidates(scan_run_id);
create index if not exists idx_event_candidates_event_key on event_candidates(event_key);

create table if not exists scenario_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid not null references event_candidates(id) on delete cascade,
  scenario_name text not null,
  note text not null,
  historical_prior numeric(6, 2),
  market_implied numeric(6, 2),
  blended_probability numeric(6, 2) not null,
  move_map jsonb not null,
  expected_pnl numeric(14, 2),
  expected_roi numeric(10, 2),
  created_at timestamptz not null default now()
);

create index if not exists idx_scenario_snapshots_event_candidate_id on scenario_snapshots(event_candidate_id);

create table if not exists prediction_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid not null references event_candidates(id) on delete cascade,
  source text not null,
  market_label text not null,
  contract_label text not null,
  probability numeric(6, 2) not null,
  change_1d numeric(6, 2),
  quality text not null,
  note text,
  snapshot_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_prediction_market_snapshots_event_candidate_id on prediction_market_snapshots(event_candidate_id);

create table if not exists option_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid not null references event_candidates(id) on delete cascade,
  symbol text not null,
  spot numeric(12, 4) not null,
  implied_move_pct numeric(8, 4),
  option_chain jsonb not null,
  captured_at timestamptz not null default now()
);

create index if not exists idx_option_snapshots_event_candidate_id on option_snapshots(event_candidate_id);
create index if not exists idx_option_snapshots_symbol on option_snapshots(symbol);

create table if not exists event_outcomes (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid not null references event_candidates(id) on delete cascade,
  resolved_at timestamptz,
  realized_bucket text,
  realized_move_map jsonb not null default '{}'::jsonb,
  realized_summary text,
  closest_scenario_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_outcomes_event_candidate_id on event_outcomes(event_candidate_id);

create table if not exists trade_journal (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid references event_candidates(id) on delete set null,
  symbol text not null,
  setup_name text not null,
  thesis text,
  entry_payload jsonb not null,
  exit_payload jsonb,
  pnl numeric(14, 2),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_trade_journal_event_candidate_id on trade_journal(event_candidate_id);

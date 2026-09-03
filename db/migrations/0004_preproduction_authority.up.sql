-- FINMENTOR pre-production authority claims.
-- Apply only during Fable's reviewed deployment.  This migration does not activate workflows.

create table if not exists public.finmentor_xray_analysis_claims (
  lead_id text not null,
  analysis_version text not null,
  claim_key text not null,
  status text not null default 'CLAIMED',
  analysis_id text,
  claimed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (lead_id, analysis_version),
  unique (claim_key),
  unique (analysis_id),
  constraint finmentor_xray_claim_status check (status in ('CLAIMED', 'AI_DRAFT', 'ANALYSIS_FAILED', 'CLIENT_READY')),
  constraint finmentor_xray_claim_key check (claim_key = lead_id || '|' || analysis_version)
);

alter table public.finmentor_xray_analysis_claims enable row level security;
revoke all on table public.finmentor_xray_analysis_claims from anon, authenticated;

comment on table public.finmentor_xray_analysis_claims is
  'Internal n8n authority ledger. No browser/client role has access.';

create table if not exists public.finmentor_app_session_authority (
  telegram_user_id text not null,
  cycle_id text not null,
  app_session_id text not null unique,
  state text not null default 'draft',
  created_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (telegram_user_id, cycle_id),
  constraint finmentor_app_session_state check (state in ('draft', 'submitted')),
  constraint finmentor_app_session_id check (app_session_id ~ '^AS-[0-9a-f]{64}$'),
  constraint finmentor_app_cycle_id check (cycle_id ~ '^C-[0-9]+-[0-9]+$')
);

alter table public.finmentor_app_session_authority enable row level security;
revoke all on table public.finmentor_app_session_authority from anon, authenticated;

comment on table public.finmentor_app_session_authority is
  'Atomic first-open authority; Data Table remains the application session record.';

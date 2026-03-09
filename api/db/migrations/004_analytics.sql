BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.wizard_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid,
  user_id uuid,
  event_name text NOT NULL,
  step wizard_step,
  mode usage_mode,
  quick_mode boolean,
  save_session boolean,
  duration_ms integer,
  success boolean,
  error_code text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wizard_events_occurred_at
  ON analytics.wizard_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_wizard_events_name_time
  ON analytics.wizard_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_wizard_events_session_time
  ON analytics.wizard_events (session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_wizard_events_user_time
  ON analytics.wizard_events (user_id, occurred_at DESC);

COMMIT;

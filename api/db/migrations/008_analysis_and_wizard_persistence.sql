BEGIN;

CREATE TABLE IF NOT EXISTS analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id uuid,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'text',
  input_text text NOT NULL,
  analysis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE advisor_sessions
  ADD COLUMN IF NOT EXISTS case_id uuid,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS original_input_text text,
  ADD COLUMN IF NOT EXISTS analysis_id uuid,
  ADD COLUMN IF NOT EXISTS advisor_response_json jsonb,
  ADD COLUMN IF NOT EXISTS selected_advisor_id text;

CREATE INDEX IF NOT EXISTS idx_analysis_results_user_created
  ON analysis_results (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_results_case_created
  ON analysis_results (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_results_contact_created
  ON analysis_results (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_case_created
  ON advisor_sessions (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_analysis_id
  ON advisor_sessions (analysis_id);

CREATE INDEX IF NOT EXISTS idx_sessions_selected_advisor
  ON advisor_sessions (selected_advisor_id);

CREATE INDEX IF NOT EXISTS idx_wizard_events_name_user_time
  ON analytics.wizard_events (event_name, user_id, occurred_at DESC);

COMMIT;

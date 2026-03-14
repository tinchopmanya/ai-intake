BEGIN;

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  contact_name text,
  relationship_label text,
  summary text NOT NULL DEFAULT '',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_user_last_activity
  ON cases (user_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_cases_user_contact
  ON cases (user_id, contact_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_analysis_results_case'
  ) THEN
    ALTER TABLE analysis_results
      ADD CONSTRAINT fk_analysis_results_case
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_advisor_sessions_case'
  ) THEN
    ALTER TABLE advisor_sessions
      ADD CONSTRAINT fk_advisor_sessions_case
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_cases_set_updated_at ON cases;
CREATE TRIGGER trg_cases_set_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

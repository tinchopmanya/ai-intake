BEGIN;

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  incident_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual',
  related_analysis_id uuid REFERENCES analysis_results(id) ON DELETE SET NULL,
  related_session_id uuid REFERENCES advisor_sessions(id) ON DELETE SET NULL,
  incident_date date NOT NULL DEFAULT CURRENT_DATE,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_incidents_incident_type CHECK (
    incident_type IN (
      'schedule_change',
      'cancellation',
      'payment_issue',
      'hostile_message',
      'documentation',
      'other'
    )
  ),
  CONSTRAINT ck_incidents_source_type CHECK (
    source_type IN ('manual', 'wizard', 'vent', 'ocr')
  )
);

CREATE INDEX IF NOT EXISTS idx_incidents_case_date
  ON incidents (case_id, incident_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_user_created
  ON incidents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_related_analysis
  ON incidents (related_analysis_id);

CREATE INDEX IF NOT EXISTS idx_incidents_related_session
  ON incidents (related_session_id);

DROP TRIGGER IF EXISTS trg_incidents_set_updated_at ON incidents;
CREATE TRIGGER trg_incidents_set_updated_at
BEFORE UPDATE ON incidents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

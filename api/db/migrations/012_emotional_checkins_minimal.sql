BEGIN;

CREATE TABLE IF NOT EXISTS emotional_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  mood_level integer NOT NULL,
  confidence_level integer NOT NULL,
  recent_contact boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_emotional_checkins_mood_level
    CHECK (mood_level BETWEEN 0 AND 4),
  CONSTRAINT ck_emotional_checkins_confidence_level
    CHECK (confidence_level BETWEEN 0 AND 4)
);

CREATE INDEX IF NOT EXISTS idx_emotional_checkins_user_created
  ON emotional_checkins (user_id, created_at DESC);

COMMIT;

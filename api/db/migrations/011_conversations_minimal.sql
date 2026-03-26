BEGIN;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nueva conversacion',
  title_status text NOT NULL DEFAULT 'pending',
  advisor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_conversations_title_status
    CHECK (title_status IN ('pending', 'fallback', 'generated')),
  CONSTRAINT ck_conversations_last_message_at
    CHECK (last_message_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_last_message
  ON conversations (user_id, last_message_at DESC, created_at DESC);

COMMIT;

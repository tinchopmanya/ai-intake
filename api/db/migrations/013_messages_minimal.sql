BEGIN;

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  message_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_messages_role
    CHECK (role IN ('user', 'system', 'assistant')),
  CONSTRAINT ck_messages_message_type
    CHECK (message_type IN ('source_text', 'analysis_action', 'selected_reply')),
  CONSTRAINT ck_messages_content_not_blank
    CHECK (char_length(btrim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at DESC);

COMMIT;

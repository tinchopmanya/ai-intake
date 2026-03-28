BEGIN;

CREATE TABLE IF NOT EXISTS memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  memory_type text NOT NULL CHECK (
    memory_type IN (
      'mood_checkin',
      'advisor_session_summary',
      'coparenting_exchange_summary'
    )
  ),
  safe_title text NOT NULL,
  safe_summary text NOT NULL,
  tone text,
  risk_level text,
  recommended_next_step text,
  source_kind text NOT NULL CHECK (
    source_kind IN (
      'advisor',
      'ex_chat_capture',
      'ex_chat_pasted',
      'draft_analysis',
      'checkin'
    )
  ),
  is_sensitive boolean NOT NULL DEFAULT false,
  source_reference_id uuid,
  memory_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_created_at
  ON memory_items (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_memory_type
  ON memory_items (user_id, memory_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_source_kind
  ON memory_items (user_id, source_kind, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_user_type_source_ref
  ON memory_items (user_id, memory_type, source_reference_id)
  WHERE source_reference_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_memory_items_set_updated_at ON memory_items;
CREATE TRIGGER trg_memory_items_set_updated_at
BEFORE UPDATE ON memory_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

BEGIN;

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id
  ON contacts (user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_user_name
  ON contacts (user_id, name);

CREATE INDEX IF NOT EXISTS idx_sessions_user_created
  ON advisor_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_contact_created
  ON advisor_sessions (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_mode_quick_created
  ON advisor_sessions (mode, quick_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON advisor_sessions (status);

CREATE INDEX IF NOT EXISTS idx_sessions_save_session
  ON advisor_sessions (save_session, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outputs_session_created
  ON advisor_outputs (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outputs_step_created
  ON advisor_outputs (step, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outputs_prompt_version
  ON advisor_outputs (prompt_version);

CREATE INDEX IF NOT EXISTS idx_outputs_emotion
  ON advisor_outputs (emotion_label);

CREATE INDEX IF NOT EXISTS idx_memory_user_contact
  ON conversation_memory (user_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_memory_expires_at
  ON conversation_memory (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_user_key
  ON conversation_memory (user_id, memory_key);

COMMIT;

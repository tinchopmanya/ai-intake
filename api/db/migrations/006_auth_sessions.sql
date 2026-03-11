BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub text UNIQUE,
  ADD COLUMN IF NOT EXISTS picture_url text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_auth_session_expiry_order
    CHECK (refresh_expires_at >= access_expires_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_created
  ON auth_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_access_active
  ON auth_sessions (access_token_hash, access_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_active
  ON auth_sessions (refresh_token_hash, refresh_expires_at)
  WHERE revoked_at IS NULL;

COMMIT;

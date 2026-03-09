BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  display_name text,
  locale text NOT NULL DEFAULT 'es-LA',
  timezone text NOT NULL DEFAULT 'America/Montevideo',
  memory_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS advisor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  mode usage_mode NOT NULL,
  quick_mode boolean NOT NULL DEFAULT false,
  status session_status NOT NULL DEFAULT 'started',
  current_step wizard_step NOT NULL DEFAULT 'ingreso',
  save_session boolean NOT NULL DEFAULT false,
  zero_retention_applied boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_session_completion_time
    CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT ck_zero_retention_default_policy
    CHECK (save_session OR zero_retention_applied)
);

CREATE TABLE IF NOT EXISTS advisor_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES advisor_sessions(id) ON DELETE CASCADE,
  step wizard_step NOT NULL,
  prompt_version text NOT NULL,
  emotion_label emotion_label NOT NULL,
  output_text text,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  session_id uuid REFERENCES advisor_sessions(id) ON DELETE SET NULL,
  memory_key text NOT NULL,
  memory_value jsonb NOT NULL,
  source text NOT NULL DEFAULT 'derived',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (user_id, contact_id, memory_key)
);

COMMIT;

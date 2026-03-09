BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_mode') THEN
    CREATE TYPE usage_mode AS ENUM ('reactive', 'preventive');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wizard_step') THEN
    CREATE TYPE wizard_step AS ENUM ('ingreso', 'analisis', 'respuesta');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('started', 'completed', 'abandoned', 'error');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emotion_label') THEN
    CREATE TYPE emotion_label AS ENUM (
      'neutral',
      'calm',
      'empathetic',
      'assertive',
      'friendly',
      'apologetic'
    );
  END IF;
END $$;

COMMIT;

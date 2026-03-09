BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contacts_set_updated_at ON contacts;
CREATE TRIGGER trg_contacts_set_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_memory_set_updated_at ON conversation_memory;
CREATE TRIGGER trg_memory_set_updated_at
BEFORE UPDATE ON conversation_memory
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_advisor_output_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_quick_mode boolean;
  v_save_session boolean;
BEGIN
  SELECT quick_mode, save_session
    INTO v_quick_mode, v_save_session
  FROM advisor_sessions
  WHERE id = NEW.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'advisor_session % does not exist', NEW.session_id;
  END IF;

  IF v_quick_mode AND NEW.step = 'analisis' THEN
    RAISE EXCEPTION 'quick mode sessions cannot persist analisis step outputs';
  END IF;

  IF NOT v_save_session THEN
    -- Zero-retention: keep only technical metadata for observability.
    NEW.output_text := NULL;
    NEW.output_json := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outputs_enforce_policy ON advisor_outputs;
CREATE TRIGGER trg_outputs_enforce_policy
BEFORE INSERT OR UPDATE ON advisor_outputs
FOR EACH ROW
EXECUTE FUNCTION enforce_advisor_output_policy();

CREATE OR REPLACE FUNCTION enforce_memory_opt_in_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_memory_opt_in boolean;
  v_session_save boolean;
BEGIN
  SELECT memory_opt_in
    INTO v_memory_opt_in
  FROM users
  WHERE id = NEW.user_id;

  IF NOT COALESCE(v_memory_opt_in, false) THEN
    RAISE EXCEPTION 'memory persistence requires users.memory_opt_in = true';
  END IF;

  IF NEW.session_id IS NOT NULL THEN
    SELECT save_session
      INTO v_session_save
    FROM advisor_sessions
    WHERE id = NEW.session_id
      AND user_id = NEW.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'session % does not belong to user %', NEW.session_id, NEW.user_id;
    END IF;

    IF NOT COALESCE(v_session_save, false) THEN
      RAISE EXCEPTION 'memory persistence requires advisor_sessions.save_session = true';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_memory_enforce_opt_in ON conversation_memory;
CREATE TRIGGER trg_memory_enforce_opt_in
BEFORE INSERT OR UPDATE ON conversation_memory
FOR EACH ROW
EXECUTE FUNCTION enforce_memory_opt_in_policy();

COMMIT;

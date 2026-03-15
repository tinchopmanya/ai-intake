BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS relationship_mode text,
  ADD COLUMN IF NOT EXISTS user_age integer,
  ADD COLUMN IF NOT EXISTS ex_partner_name text,
  ADD COLUMN IF NOT EXISTS ex_partner_pronoun text,
  ADD COLUMN IF NOT EXISTS breakup_time_range text,
  ADD COLUMN IF NOT EXISTS children_count_category text,
  ADD COLUMN IF NOT EXISTS relationship_goal text,
  ADD COLUMN IF NOT EXISTS breakup_initiator text,
  ADD COLUMN IF NOT EXISTS custody_type text,
  ADD COLUMN IF NOT EXISTS response_style text;

DO $$
DECLARE
  has_legacy_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'has_children_count_category'
  ) INTO has_legacy_column;

  IF has_legacy_column THEN
    EXECUTE $sql$
      UPDATE users
      SET relationship_mode = CASE
        WHEN COALESCE(children_count_category, has_children_count_category) IN ('one', 'two_plus')
          THEN 'coparenting'
        ELSE 'relationship_separation'
      END
      WHERE relationship_mode IS NULL
    $sql$;

    EXECUTE $sql$
      UPDATE users
      SET children_count_category = CASE
        WHEN relationship_mode = 'coparenting'
          THEN COALESCE(children_count_category, has_children_count_category, 'one')
        ELSE 'none'
      END
      WHERE children_count_category IS NULL
    $sql$;
  ELSE
    UPDATE users
    SET relationship_mode = 'relationship_separation'
    WHERE relationship_mode IS NULL;

    UPDATE users
    SET children_count_category = CASE
      WHEN relationship_mode = 'coparenting' THEN 'one'
      ELSE 'none'
    END
    WHERE children_count_category IS NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_ex_partner_pronoun'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_ex_partner_pronoun
      CHECK (ex_partner_pronoun IS NULL OR ex_partner_pronoun IN ('el', 'ella'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_breakup_time_range'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_breakup_time_range
      CHECK (
        breakup_time_range IS NULL OR breakup_time_range IN (
          'lt_2m',
          'between_2m_1y',
          'between_1y_3y',
          'gt_3y'
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_relationship_mode'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_relationship_mode
      CHECK (
        relationship_mode IS NULL OR relationship_mode IN ('coparenting', 'relationship_separation')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_children_count_category_v2'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_children_count_category_v2
      CHECK (
        children_count_category IS NULL OR children_count_category IN ('none', 'one', 'two_plus')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_relationship_goal'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_relationship_goal
      CHECK (
        relationship_goal IS NULL OR relationship_goal IN (
          'emotional_recovery',
          'friendly_close',
          'open_reconciliation'
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_breakup_initiator'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_breakup_initiator
      CHECK (
        breakup_initiator IS NULL OR breakup_initiator IN ('mutual', 'partner', 'me')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_custody_type'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_custody_type
      CHECK (
        custody_type IS NULL OR custody_type IN (
          'partner_custody_visits',
          'shared_custody',
          'my_custody_partner_visits',
          'undefined'
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_response_style'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_response_style
      CHECK (
        response_style IS NULL OR response_style IN (
          'strict_parental',
          'cordial_collaborative',
          'friendly_close',
          'open_reconciliation'
        )
      );
  END IF;
END;
$$;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_children_count_category;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_breakup_side;

ALTER TABLE users
  DROP COLUMN IF EXISTS has_children_count_category;

ALTER TABLE users
  DROP COLUMN IF EXISTS objective,
  DROP COLUMN IF EXISTS has_children,
  DROP COLUMN IF EXISTS breakup_side;

DROP TRIGGER IF EXISTS trg_user_children_set_updated_at ON user_children;
DROP TABLE IF EXISTS user_children;

COMMIT;

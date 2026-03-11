BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'UY',
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS has_children boolean,
  ADD COLUMN IF NOT EXISTS breakup_side text;

ALTER TABLE users
  ADD CONSTRAINT ck_users_language_code
    CHECK (language_code IN ('es', 'en', 'pt'));

ALTER TABLE users
  ADD CONSTRAINT ck_users_breakup_side
    CHECK (breakup_side IS NULL OR breakup_side IN ('yo', 'mi_ex', 'mutuo'));

CREATE INDEX IF NOT EXISTS idx_users_google_sub
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_country_language
  ON users (country_code, language_code);

COMMIT;

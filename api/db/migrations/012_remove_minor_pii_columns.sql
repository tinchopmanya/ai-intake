-- Safety migration: ensure no minor-identifiable fields remain in onboarding/profile data.
-- This migration is idempotent and only drops legacy columns/tables if they still exist.

ALTER TABLE IF EXISTS users
  DROP COLUMN IF EXISTS child_name,
  DROP COLUMN IF EXISTS child_age,
  DROP COLUMN IF EXISTS children,
  DROP COLUMN IF EXISTS children_json;

ALTER TABLE IF EXISTS cases
  DROP COLUMN IF EXISTS child_name,
  DROP COLUMN IF EXISTS child_age,
  DROP COLUMN IF EXISTS children,
  DROP COLUMN IF EXISTS children_json;

ALTER TABLE IF EXISTS contacts
  DROP COLUMN IF EXISTS child_name,
  DROP COLUMN IF EXISTS child_age,
  DROP COLUMN IF EXISTS children,
  DROP COLUMN IF EXISTS children_json;

DROP TABLE IF EXISTS children;
DROP TABLE IF EXISTS user_children;

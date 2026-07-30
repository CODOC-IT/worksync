-- Make administrator-provided account passwords permanent.
-- Apply after 20260730_02_account_credentials_invitations.sql.

BEGIN;

-- Accounts provisioned by Admin/HR under the previous first-login workflow already have a
-- valid Supabase password. Activate those application profiles without changing that password.
UPDATE iam.Users
SET AccountStatus = 'Active',
    ActivatedAtUtc = COALESCE(ActivatedAtUtc, CURRENT_TIMESTAMP),
    UpdatedAtUtc = CURRENT_TIMESTAMP
WHERE AccountStatus = 'Pending'
  AND AuthUserId IS NOT NULL
  AND CreatedByUserId IS NOT NULL;

-- The application no longer reads this flag, but remove it from existing provisioned Auth
-- identities so Auth metadata accurately reflects the permanent-password lifecycle.
UPDATE auth.users AS auth_user
SET raw_app_meta_data = COALESCE(auth_user.raw_app_meta_data, '{}'::jsonb) - 'must_change_password',
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(auth_user.raw_app_meta_data ->> 'must_change_password', 'false') = 'true'
  AND EXISTS (
      SELECT 1
      FROM iam.Users AS app_user
      WHERE app_user.AuthUserId = auth_user.id
        AND app_user.CreatedByUserId IS NOT NULL
  );

COMMIT;

-- Bootstraps a reserved, permanently-locked "System" user in iam.Users to act as the
-- GrantedByUserId for every self-service registration's initial role grant.
--
-- Why this is needed: iam.UserRoles.GrantedByUserId is NOT NULL and CK_UserRoles_NoSelfGrant
-- requires UserId <> GrantedByUserId -- correct for a role granted BY an administrator TO
-- someone else, but self-registration (signup, OTP-verified or not) has no such human granter.
-- backend/src/store/userStore.ts's createUser previously hardcoded GrantedByUserId = 1, which
-- crashes with "violates check constraint ck_userroles_noselfgrant" the moment a fresh
-- registration is itself assigned UserId = 1 (self-granting). A fixed, permanent System actor
-- id -- guaranteed to differ from every real registrant, since it's created once here, before
-- any real user can ever occupy it -- removes that fragile coincidence entirely, for every
-- future registration, not just the one that happened to collide.
--
-- Idempotent: safe to re-run against an already-provisioned database (WHERE NOT EXISTS, no
-- unique constraint on Email alone to ON CONFLICT against since it's scoped to
-- (OrganizationId, Email)).

DO $$
DECLARE
    system_user_id INT;
BEGIN
    SELECT UserId INTO system_user_id
    FROM iam.Users
    WHERE OrganizationId = 1 AND Email = 'system@worksync.internal';

    IF system_user_id IS NULL THEN
        INSERT INTO iam.Users
            (OrganizationId, Email, GivenName, FamilyName, DisplayName, Designation, AccountStatus)
        VALUES
            (1, 'system@worksync.internal', 'System', 'WorkSync', 'WorkSync System', 'System Actor', 'Locked')
        RETURNING UserId INTO system_user_id;
    END IF;
END $$;

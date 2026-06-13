-- Stable per-provider OIDC subject (`<provider>:<sub>`) so SSO logins are keyed on a
-- non-spoofable identity rather than the display username. Nullable: locally-created /
-- statically-tokened users have no subject. A UNIQUE index permits multiple NULLs.
ALTER TABLE users_user ADD COLUMN oidc_subject VARCHAR(255) NULL;
CREATE UNIQUE INDEX uq_users_user_oidc_subject ON users_user (oidc_subject);

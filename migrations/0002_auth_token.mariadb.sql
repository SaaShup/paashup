-- API tokens (NetBox-style `Authorization: Token <key>`).
CREATE TABLE auth_token (
    id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `key`         VARCHAR(40) NOT NULL,
    user_id       BIGINT NOT NULL,
    write_enabled TINYINT(1) NOT NULL DEFAULT 1,
    expires       DATETIME(6),
    description   VARCHAR(200) NOT NULL DEFAULT '',
    created       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_used     DATETIME(6),
    FOREIGN KEY (user_id) REFERENCES users_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_auth_token_key ON auth_token (`key`);

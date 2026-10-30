-- Pinned service links shown on the dashboard: either auto-detected from a remote
-- paashup instance's docker containers (Traefik labels) or added by hand.
CREATE TABLE extras_service_link (
    id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `key`         VARCHAR(100) NOT NULL,
    label         VARCHAR(150) NOT NULL,
    auto_url      VARCHAR(500) NULL,
    override_url  VARCHAR(500) NULL,
    icon_url      VARCHAR(500) NULL,
    pinned        TINYINT(1) NOT NULL DEFAULT 1,
    managed       TINYINT(1) NOT NULL DEFAULT 0,
    position      INT NOT NULL DEFAULT 0,
    created       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_extras_service_link_key ON extras_service_link (`key`);

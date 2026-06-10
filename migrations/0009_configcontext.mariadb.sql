-- NetBox-style config contexts (core extras feature). See the .sqlite.sql sibling
-- for the column commentary. Assignment criteria are JSON arrays of object ids.
CREATE TABLE extras_configcontext (
    id             BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    weight         INT NOT NULL DEFAULT 1000,
    description    VARCHAR(200) NOT NULL DEFAULT '',
    is_active      TINYINT(1) NOT NULL DEFAULT 1,
    data           LONGTEXT NOT NULL DEFAULT ('{}'),
    regions        TEXT NOT NULL DEFAULT ('[]'),
    site_groups    TEXT NOT NULL DEFAULT ('[]'),
    sites          TEXT NOT NULL DEFAULT ('[]'),
    locations      TEXT NOT NULL DEFAULT ('[]'),
    device_types   TEXT NOT NULL DEFAULT ('[]'),
    roles          TEXT NOT NULL DEFAULT ('[]'),
    platforms      TEXT NOT NULL DEFAULT ('[]'),
    cluster_types  TEXT NOT NULL DEFAULT ('[]'),
    cluster_groups TEXT NOT NULL DEFAULT ('[]'),
    clusters       TEXT NOT NULL DEFAULT ('[]'),
    tenant_groups  TEXT NOT NULL DEFAULT ('[]'),
    tenants        TEXT NOT NULL DEFAULT ('[]'),
    tags           TEXT NOT NULL DEFAULT ('[]'),
    created        DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated   DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_extras_configcontext_name ON extras_configcontext (name);

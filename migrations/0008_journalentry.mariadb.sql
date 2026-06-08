-- NetBox-compatible journal entries (used by clients like the Docker agent).
CREATE TABLE extras_journalentry (
    id                   BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    assigned_object_type VARCHAR(100),
    assigned_object_id   BIGINT,
    kind                 VARCHAR(50),
    comments             TEXT NOT NULL,
    created              DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated         DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

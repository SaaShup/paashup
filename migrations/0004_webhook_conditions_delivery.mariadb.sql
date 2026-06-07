-- Webhook conditions (fire only when object fields match) + delivery log.
ALTER TABLE extras_webhook ADD COLUMN conditions TEXT NOT NULL DEFAULT '{}';

CREATE TABLE extras_webhook_delivery (
    id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    webhook_name VARCHAR(150) NOT NULL DEFAULT '',
    event        VARCHAR(20) NOT NULL,
    object_type  VARCHAR(100) NOT NULL,
    object_id    BIGINT,
    payload_url  VARCHAR(500) NOT NULL,
    success      TINYINT(1) NOT NULL DEFAULT 0,
    status_code  INT,
    attempts     INT NOT NULL DEFAULT 0,
    error        TEXT NOT NULL,
    created      DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX ix_webhook_delivery_created ON extras_webhook_delivery (created);

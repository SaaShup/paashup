-- Webhooks: fire an HTTP request on object create/update/delete (NetBox-style).
CREATE TABLE extras_webhook (
    id                BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(150) NOT NULL,
    enabled           TINYINT(1) NOT NULL DEFAULT 1,
    object_types      TEXT NOT NULL DEFAULT '[]',
    events            TEXT NOT NULL DEFAULT '[]',
    payload_url       VARCHAR(500) NOT NULL,
    http_method       VARCHAR(10) NOT NULL DEFAULT 'POST',
    http_content_type VARCHAR(100) NOT NULL DEFAULT 'application/json',
    additional_headers TEXT NOT NULL DEFAULT '',
    secret            VARCHAR(255) NOT NULL DEFAULT '',
    ssl_verification  TINYINT(1) NOT NULL DEFAULT 1,
    description       VARCHAR(200) NOT NULL DEFAULT '',
    created           DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated      DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_extras_webhook_name ON extras_webhook (name);

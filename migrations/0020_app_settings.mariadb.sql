-- Global app settings (paashup extension): a small key/value store for admin-configured
-- UI preferences, starting with which sidebar sections are hidden for everyone.
CREATE TABLE app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

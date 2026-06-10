-- NetBox-style templating for webhooks (see the .sqlite.sql sibling). Adds the
-- optional body_template column; payload_url + additional_headers are templated too.
ALTER TABLE extras_webhook ADD COLUMN body_template TEXT NULL;

-- NetBox-style templating for webhooks. The payload_url, additional_headers and a
-- new optional body_template are rendered with a context built from the event
-- ({{ event }}, {{ model }}, {{ timestamp }}, {{ username }}, {{ request_id }},
--  {{ data.* }}, {{ snapshots.prechange.* }} / {{ snapshots.postchange.* }}).
-- Only a new column is needed; rendering is implemented in src/webhooks.ts.
BEGIN;
ALTER TABLE extras_webhook ADD COLUMN body_template TEXT;
COMMIT;

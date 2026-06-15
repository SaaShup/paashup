-- Update the already-seeded "[Docker] Add host" webhook to the simplified token
-- template (see the .sqlite.sql sibling). Only rows still at the old default are
-- changed, so any manual edits are preserved.
UPDATE extras_webhook
   SET payload_url = '{{ data.endpoint }}/api/engine/endpoint?id={{ data.id }}&token={{ data.token.key }}&endpoint={{ data.endpoint }}&url={{ data.netbox_base_url }}'
 WHERE name = '[Docker] Add host'
   AND payload_url = '{{ data.endpoint }}/api/engine/endpoint?id={{ data.id }}&token=nbt_{{ data.token.key }}.{{ data.token.token }}&endpoint={{ data.endpoint }}&url={{ data.netbox_base_url }}';

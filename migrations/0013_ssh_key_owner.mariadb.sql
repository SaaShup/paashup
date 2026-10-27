-- SSH keys get an owner: the paashup user the key belongs to. Set to the signed-in user
-- when created in the UI, and matched by name (key name = username) when imported from a
-- cloud; editable by hand.
ALTER TABLE virtualization_ssh_key ADD COLUMN owner_id BIGINT NULL;
ALTER TABLE virtualization_ssh_key
    ADD CONSTRAINT fk_ssh_key_owner FOREIGN KEY (owner_id)
    REFERENCES users_user(id) ON DELETE SET NULL;

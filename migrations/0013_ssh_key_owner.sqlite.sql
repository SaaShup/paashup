-- SSH keys get an owner: the paas2box user the key belongs to. Set to the signed-in user
-- when created in the UI, and matched by name (key name = username) when imported from a
-- cloud; editable by hand.
ALTER TABLE virtualization_ssh_key
    ADD COLUMN owner_id INTEGER REFERENCES users_user(id) ON DELETE SET NULL;

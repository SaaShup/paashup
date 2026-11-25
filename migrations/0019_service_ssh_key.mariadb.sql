-- The paashup "service account" SSH key (see src/serviceAccount.ts): a single keypair
-- generated on first boot, whose public half is a regular catalog entry (pushed to VMs'
-- authorized_keys like any other SSH key) and whose private half paashup keeps to itself,
-- encrypted, to open SSH sessions for the in-browser VM terminal.
ALTER TABLE virtualization_ssh_key ADD COLUMN private_key_encrypted TEXT NULL;

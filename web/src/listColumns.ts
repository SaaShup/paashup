// Per-table column tweaks for ObjectTable, shared by every place that lists a table's rows
// (the top-level ResourceListView list and the nested category tables on HostDetailView).

/** Columns shown first for tables whose useful fields would otherwise be cut off. */
export const PREFERRED_COLUMNS: Record<string, string[]> = {
  virtualization_virtual_machine: [
    'status',
    'cluster',
    'virtual_machine_type',
    'image',
    'primary_ip4',
    'vcpus',
    'memory',
  ],
  virtualization_ssh_key: ['name', 'origin', 'deployed_on', 'owner', 'source', 'description'],
  virtualization_image: ['name', 'source', 'description'],
  virtualization_init_script: ['name', 'description', 'created'],
  extras_journalentry: ['created', 'kind', 'assigned_object_type', 'assigned_object', 'comments'],
  plugin_docker_image: ['version', 'size', 'used_by'],
  plugin_docker_volume: ['driver', 'max_size', 'used_by'],
  plugin_docker_network: ['driver', 'subnet', 'used_by'],
};

// Columns a list leaves out: an init script is listed by name, description and date only.
export const HIDDEN_COLUMNS: Record<string, string[]> = {
  virtualization_init_script: ['id', 'content', 'variables', 'required_variables', 'last_updated'],
  // `display` is a meaningless "JournalEntry (123)" fallback here; `assigned_object_id` is
  // redundant once `assigned_object` resolves the real object name.
  extras_journalentry: ['display', 'assigned_object_id', 'last_updated'],
  // Docker lists show only user-relevant columns: no internal `id`, no raw engine entity id
  // (that's what `display`/the detail page are for), and no `name` (every Docker entity's
  // `display` is just its `name`, shown already as the clickable name link).
  plugin_docker_host: ['id', 'name'],
  plugin_docker_registry: ['id', 'name'],
  plugin_docker_image: ['id', 'name', 'ImageID', 'containers'], // `containers` duplicates `used_by`
  plugin_docker_volume: ['id', 'name'],
  // `network_settings` is child-table data (only useful on the detail page); `last_updated`
  // and `network_settings` crowd out more useful columns under the 8-column cap, so only
  // `created` of the three timestamp/derived columns stays.
  plugin_docker_network: ['id', 'name', 'NetworkID', 'network_settings', 'last_updated'],
  plugin_docker_container: ['id', 'name', 'ContainerID'],
  // `display` is already a cluster's `name`, shown as the clickable name link.
  virtualization_cluster: ['name'],
};

// Journal comments can be long operational messages: show them clipped with a toggle.
export const EXPANDABLE_COLUMNS: Record<string, string[]> = {
  extras_journalentry: ['comments'],
};

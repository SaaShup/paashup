import type { CustomField } from './types.js';

// Custom field definitions indexed by entity table.
const byTable = new Map<string, CustomField[]>();

export function registerCustomField(cf: CustomField): void {
  for (const table of cf.tables) {
    const list = byTable.get(table) ?? byTable.set(table, []).get(table)!;
    if (list.some((c) => c.name === cf.name)) {
      throw new Error(`Custom field "${cf.name}" already defined for ${table}`);
    }
    list.push(cf);
  }
}

export function customFieldsFor(table: string): readonly CustomField[] {
  return byTable.get(table) ?? [];
}

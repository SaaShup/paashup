// A confirmation dialog any component can await, in place of window.confirm:
//
//   if (!(await confirmDialog({ title: 'Delete VM', message: '…', tone: 'danger' }))) return;
//
// An optional checkbox (e.g. "also delete the attached volume") can be shown above the
// actions; read its final state with confirmDialogChecked instead of the plain boolean:
//
//   const { ok, checked } = await confirmDialogChecked({ ..., checkbox: { label: '…' } });
//
// One <ConfirmDialog /> mounted in App.vue renders whichever request is pending.
import { reactive } from 'vue';

export interface ConfirmOptions {
  title?: string;
  /** Plain text; blank lines separate paragraphs. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: destructive action (red, Cancel focused). warning: costs money. */
  tone?: 'primary' | 'warning' | 'danger';
  /** An optional checkbox shown above the actions, unchecked unless `default` is true. */
  checkbox?: { label: string; default?: boolean };
}

interface Pending extends ConfirmOptions {
  resolve: (result: { ok: boolean; checked: boolean }) => void;
}

export const confirmState = reactive<{ current: Pending | null }>({ current: null });

function ask(options: ConfirmOptions): Promise<{ ok: boolean; checked: boolean }> {
  confirmState.current?.resolve({ ok: false, checked: false }); // a dialog is replaced, never stacked
  return new Promise((resolve) => {
    confirmState.current = { ...options, resolve };
  });
}

/** Plain yes/no. */
export async function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return (await ask(options)).ok;
}

/** Yes/no plus the final state of `options.checkbox`. */
export function confirmDialogChecked(
  options: ConfirmOptions & { checkbox: NonNullable<ConfirmOptions['checkbox']> },
): Promise<{ ok: boolean; checked: boolean }> {
  return ask(options);
}

/** Close the open dialog with the user's answer (used by ConfirmDialog.vue). */
export function answerConfirm(result: { ok: boolean; checked: boolean }): void {
  const pending = confirmState.current;
  confirmState.current = null;
  pending?.resolve(result);
}

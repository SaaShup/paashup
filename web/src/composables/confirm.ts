// A confirmation dialog any component can await, in place of window.confirm:
//
//   if (!(await confirmDialog({ title: 'Delete VM', message: '…', tone: 'danger' }))) return;
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
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export const confirmState = reactive<{ current: Pending | null }>({ current: null });

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  confirmState.current?.resolve(false); // a dialog is replaced, never stacked
  return new Promise((resolve) => {
    confirmState.current = { ...options, resolve };
  });
}

/** Close the open dialog with the user's answer (used by ConfirmDialog.vue). */
export function answerConfirm(ok: boolean): void {
  const pending = confirmState.current;
  confirmState.current = null;
  pending?.resolve(ok);
}

import { describe, it, expect, beforeEach } from 'vitest';
import { answerConfirm, confirmDialog, confirmState } from '../src/composables/confirm';

describe('confirmDialog', () => {
  beforeEach(() => answerConfirm(false));

  it('opens a dialog with the options and resolves true on confirm', async () => {
    const answer = confirmDialog({ title: 'Delete', message: 'Sure?', tone: 'danger' });
    expect(confirmState.current).toMatchObject({
      title: 'Delete',
      message: 'Sure?',
      tone: 'danger',
    });
    answerConfirm(true);
    expect(await answer).toBe(true);
    expect(confirmState.current).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const answer = confirmDialog({ message: 'Sure?' });
    answerConfirm(false);
    expect(await answer).toBe(false);
    expect(confirmState.current).toBeNull();
  });

  it('replaces an open dialog instead of stacking: the first one is answered false', async () => {
    const first = confirmDialog({ message: 'first' });
    const second = confirmDialog({ message: 'second' });
    expect(await first).toBe(false);
    expect(confirmState.current?.message).toBe('second');
    answerConfirm(true);
    expect(await second).toBe(true);
  });

  it('answering with nothing open does nothing', () => {
    expect(() => answerConfirm(true)).not.toThrow();
  });
});

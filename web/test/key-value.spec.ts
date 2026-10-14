import { describe, it, expect } from 'vitest';
import { fromPairs, toPairs } from '../src/keyValue';

describe('toPairs', () => {
  it('lists an object as rows, keeping the order and turning values into text', () => {
    expect(toPairs({ env: 'prod', n: 5, b: true })).toEqual([
      { key: 'env', value: 'prod' },
      { key: 'n', value: '5' },
      { key: 'b', value: 'true' },
    ]);
  });

  it('gives no rows for nothing', () => {
    expect(toPairs({})).toEqual([]);
    expect(toPairs(null)).toEqual([]);
    expect(toPairs(undefined)).toEqual([]);
    expect(toPairs({ empty: null })).toEqual([{ key: 'empty', value: '' }]);
  });
});

describe('fromPairs', () => {
  it('builds the object the API takes, trimming keys but not values', () => {
    expect(
      fromPairs([
        { key: ' env ', value: ' prod ' },
        { key: 'owner', value: '' },
      ]),
    ).toEqual({ value: { env: ' prod ', owner: '' }, error: '' });
  });

  it('ignores rows that are completely empty', () => {
    expect(
      fromPairs([
        { key: '', value: '' },
        { key: '  ', value: '  ' },
        { key: 'a', value: '1' },
      ]),
    ).toEqual({ value: { a: '1' }, error: '' });
  });

  it('reports a value without a key instead of dropping it', () => {
    const r = fromPairs([{ key: '', value: 'orphan' }]);
    expect(r.error).toMatch(/has no key/);
    expect(r.error).toContain('orphan');
  });

  it('reports a key given twice', () => {
    const r = fromPairs([
      { key: 'a', value: '1' },
      { key: ' a', value: '2' },
    ]);
    expect(r.error).toBe('The key "a" is given twice.');
  });

  it('round-trips with toPairs', () => {
    const meta = { env: 'prod', cost: '42', note: 'a b' };
    expect(fromPairs(toPairs(meta)).value).toEqual(meta);
  });
});

import { MAX_BATCH_BYTES, splitBySize } from '../src/TypeScript/lib/batching';

const MB = 1024 * 1024;
const sizes = (...mbs: number[]) => mbs.map((n) => n * MB);

describe('splitBySize', () => {
  it('keeps everything in one batch while under the limit', () => {
    expect(splitBySize(sizes(1, 2, 3), (s) => s, 15 * MB)).toEqual({ batches: [sizes(1, 2, 3)], oversize: [] });
  });

  it('starts a new batch when the next item would cross the limit, preserving order', () => {
    expect(splitBySize(sizes(6, 6, 6, 6, 6), (s) => s, 15 * MB).batches).toEqual([sizes(6, 6), sizes(6, 6), sizes(6)]);
  });

  it('isolates items that alone exceed the limit', () => {
    const r = splitBySize(sizes(2, 20, 3), (s) => s, 15 * MB);
    expect(r.batches).toEqual([sizes(2, 3)]);
    expect(r.oversize).toEqual(sizes(20));
  });

  it('returns no batches for empty input', () => {
    expect(splitBySize([], () => 0)).toEqual({ batches: [], oversize: [] });
  });

  it('defaults to a limit under NetSuite\'s 15 MB', () => {
    expect(MAX_BATCH_BYTES).toBeLessThan(15 * MB);
    expect(MAX_BATCH_BYTES).toBeGreaterThan(14 * MB);
  });
});

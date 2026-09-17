/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

/** NetSuite rejects emails whose attachments total 15 MB; stay under it with headroom. */
export const MAX_BATCH_BYTES = 14.5 * 1024 * 1024;

export interface SizeBatches<T> {
  batches: T[][];
  /** Items that alone exceed the limit; they cannot be emailed at all. */
  oversize: T[];
}

/** Greedy, order-preserving split so that each batch stays within maxBytes. */
export function splitBySize<T>(items: T[], sizeOf: (item: T) => number, maxBytes = MAX_BATCH_BYTES): SizeBatches<T> {
  const batches: T[][] = [];
  const oversize: T[] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (size > maxBytes) {
      oversize.push(item);
      continue;
    }
    if (current.length && currentBytes + size > maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length) batches.push(current);
  return { batches, oversize };
}

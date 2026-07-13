// Keep Promise.all fan-out comfortably below Convex's concurrent I/O limit.
// A mapper may perform more than one database operation per item, so leave
// headroom rather than batching right up to the platform ceiling.
export const DATABASE_IO_BATCH_SIZE = 256;

export async function mapAsyncInBatches<T, U>(
  items: readonly T[],
  batchSize: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  if (batchSize < 1) {
    throw new Error("Batch size must be at least one");
  }

  const results: U[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    results.push(
      ...(await Promise.all(
        items.slice(offset, offset + batchSize).map(mapper),
      )),
    );
  }
  return results;
}

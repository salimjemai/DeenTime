/**
 * Small concurrency helpers standing in for Parallel.ForEachAsync, SemaphoreSlim(1,1)
 * and the LINQ grouping used by IslamicContentSyncService.cs.
 */

/**
 * Runs `worker` over `items` with at most `limit` in flight. The first failure
 * stops new work, waits for in-flight items and is rethrown (Parallel.ForEachAsync).
 */
export async function forEachParallel<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let index = 0;
  let failed = false;
  let failure: unknown;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!failed && !signal?.aborted) {
      const current = index++;
      if (current >= items.length) return;
      try {
        await worker(items[current] as T);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  });
  await Promise.all(runners);
  if (failed) throw failure;
  signal?.throwIfAborted();
}

/** Serializes asynchronous critical sections in call order. */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** GroupBy(key).Select(group => group.First()) preserving first-occurrence order. */
export function firstByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const itemKey = key(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    result.push(item);
  }
  return result;
}

/** Distinct(StringComparer.OrdinalIgnoreCase) preserving the first spelling seen. */
export function distinctIgnoreCase(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** Enumerable.Range(start, count). */
export function range(start: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, offset) => start + offset);
}

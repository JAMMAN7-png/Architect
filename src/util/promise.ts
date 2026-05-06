import pLimit from "p-limit";

/**
 * Run async tasks with bounded concurrency.
 * @param items input array
 * @param concurrency max simultaneous workers
 * @param worker async function applied to each item
 * @returns array of results in input order
 */
export async function mapWithCap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(Math.max(1, concurrency));
  return Promise.all(items.map((item, i) => limit(() => worker(item, i))));
}

/** Sleep for ms milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry an async fn with exponential backoff. */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 250;
  const maxMs = opts.maxMs ?? 8_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      const delay = Math.min(maxMs, baseMs * 2 ** i);
      await sleep(delay);
    }
  }
  throw lastErr;
}

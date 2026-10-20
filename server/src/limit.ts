/** Run at most `n` tasks at once; the rest wait in order. */
export function createLimiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** One task at a time per key, e.g. read-modify-write of a project manifest. */
export function keyedMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const tail = result.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}

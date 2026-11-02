export function shiftRecordedTimes<T>(value: T, timeBase: number, now = Date.now()): T {
  const upper = timeBase + 86_400_000;
  const walk = (item: unknown): unknown => {
    if (typeof item === 'number') return item >= timeBase && item <= upper ? item + now - timeBase : item;
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    }
    return item;
  };
  return walk(value) as T;
}

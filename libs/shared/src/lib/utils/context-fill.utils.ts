import type { ContextCapacity } from './pricing.utils';

/** Sum the three token classes that occupy the current context. */
export function contextFillTokens(usage: {
  input?: number;
  cacheRead?: number;
  cacheCreation?: number;
}): number {
  const count = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  return (
    count(usage.input) +
    count(usage.cacheRead) +
    count(usage.cacheCreation)
  );
}

/** Accept only a window observed for this model from a trusted route. */
export function trustedContextWindow(
  capacity: ContextCapacity | null | undefined,
  model: string,
): number | null {
  if (
    !capacity ||
    capacity.model !== model ||
    (capacity.source !== 'sdk-native' &&
      (capacity.source !== 'provider-catalog' ||
        !capacity.providerId)) ||
    capacity.tokens === null ||
    !Number.isFinite(capacity.tokens) ||
    capacity.tokens <= 0
  ) {
    return null;
  }

  return capacity.tokens;
}

/** Report the context fill to one decimal place without clamping. */
export function contextFillPercent(
  used: number,
  window?: number | null,
): number | null {
  if (
    !Number.isFinite(used) ||
    used < 0 ||
    typeof window !== 'number' ||
    !Number.isFinite(window) ||
    window <= 0
  ) {
    return null;
  }

  const percent = Math.round((used / window) * 1000) / 10;
  return Number.isFinite(percent) ? percent : null;
}

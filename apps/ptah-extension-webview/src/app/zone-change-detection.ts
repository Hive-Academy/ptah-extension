/**
 * Reads the host's synchronous bootstrap config. This deliberately does not
 * use the RPC bridge: Angular must choose its change-detection provider before
 * services and message handlers are constructed.
 */
export function useZoneChangeDetectionFallback(): boolean {
  if (typeof window === 'undefined') return false;
  const config = (
    window as Window & {
      ptahConfig?: { zoneChangeDetectionFallback?: unknown };
    }
  ).ptahConfig;
  return config?.zoneChangeDetectionFallback === true;
}

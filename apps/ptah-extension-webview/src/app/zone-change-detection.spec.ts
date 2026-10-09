import { useZoneChangeDetectionFallback } from './zone-change-detection';

describe('zone change-detection bootstrap fallback', () => {
  const originalConfig = window.ptahConfig;

  afterEach(() => {
    window.ptahConfig = originalConfig;
  });

  it('defaults to zoneless and accepts only the explicit host flag', () => {
    window.ptahConfig = {};
    expect(useZoneChangeDetectionFallback()).toBe(false);

    window.ptahConfig = { zoneChangeDetectionFallback: true };
    expect(useZoneChangeDetectionFallback()).toBe(true);

    window.ptahConfig = { zoneChangeDetectionFallback: 'true' };
    expect(useZoneChangeDetectionFallback()).toBe(false);
  });
});

import {
  computeCampaignRates,
  rateColorClass,
  rateTone,
} from './marketing-metrics';

describe('computeCampaignRates', () => {
  it('computes delivery/bounce/complaint rates as percentages', () => {
    const rates = computeCampaignRates({
      recipientCount: 1000,
      sentCount: 980,
      bouncedCount: 20,
      complainedCount: 1,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(rates.deliveryRate).toBeCloseTo(98, 5);
    expect(rates.bounceRate).toBeCloseTo((20 / 980) * 100, 5);
    expect(rates.complaintRate).toBeCloseTo((1 / 980) * 100, 5);
    expect(rates.status).toBe('completed');
  });

  it('returns null (never NaN/Infinity) when denominators are 0', () => {
    const rates = computeCampaignRates({
      recipientCount: 0,
      sentCount: 0,
      bouncedCount: 0,
      complainedCount: 0,
      completedAt: null,
    });
    expect(rates.deliveryRate).toBeNull();
    expect(rates.bounceRate).toBeNull();
    expect(rates.complaintRate).toBeNull();
    expect(rates.status).toBe('in_progress');
  });

  it('derives in_progress status from a null completedAt', () => {
    const rates = computeCampaignRates({
      recipientCount: 10,
      sentCount: 5,
      bouncedCount: 0,
      complainedCount: 0,
      completedAt: null,
    });
    expect(rates.status).toBe('in_progress');
  });
});

describe('rateTone', () => {
  it('grades delivery bands (≥95 success / 80–95 warning / <80 error)', () => {
    expect(rateTone(95, 'delivery')).toBe('success');
    expect(rateTone(97.4, 'delivery')).toBe('success');
    expect(rateTone(80, 'delivery')).toBe('warning');
    expect(rateTone(94.9, 'delivery')).toBe('warning');
    expect(rateTone(79.9, 'delivery')).toBe('error');
  });

  it('grades bounce bands (<2 success / 2–5 warning / >5 error)', () => {
    expect(rateTone(1.9, 'bounce')).toBe('success');
    expect(rateTone(2, 'bounce')).toBe('warning');
    expect(rateTone(5, 'bounce')).toBe('warning');
    expect(rateTone(5.1, 'bounce')).toBe('error');
  });

  it('grades complaint bands (<0.1 success / 0.1–0.5 warning / >0.5 error)', () => {
    expect(rateTone(0.09, 'complaint')).toBe('success');
    expect(rateTone(0.1, 'complaint')).toBe('warning');
    expect(rateTone(0.5, 'complaint')).toBe('warning');
    expect(rateTone(0.51, 'complaint')).toBe('error');
  });

  it('treats null rates as neutral', () => {
    expect(rateTone(null, 'delivery')).toBe('neutral');
    expect(rateTone(null, 'bounce')).toBe('neutral');
    expect(rateTone(null, 'complaint')).toBe('neutral');
  });
});

describe('rateColorClass', () => {
  it('maps tones to operator text-colour classes', () => {
    expect(rateColorClass(99, 'delivery')).toBe('text-success');
    expect(rateColorClass(85, 'delivery')).toBe('text-warning');
    expect(rateColorClass(10, 'delivery')).toBe('text-error');
    expect(rateColorClass(null, 'delivery')).toBe('text-ink-500');
  });
});

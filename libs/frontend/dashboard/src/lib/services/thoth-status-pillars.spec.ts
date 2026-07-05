import { deriveThothPillars } from './thoth-status.service';
import type {
  ThothGatewaySummary,
  ThothStatusSummary,
} from './thoth-status.service';

function makeSummary(
  overrides: Partial<ThothStatusSummary> = {},
): ThothStatusSummary {
  return {
    memory: { available: true, totalFacts: 5, queueLength: 0 },
    skills: { available: true, pendingCandidates: 0 },
    cron: { available: true, totalJobs: 0, nextRunAt: null },
    gateway: { available: false, reason: 'desktop-only' },
    isLoading: false,
    lastUpdatedAt: 1,
    errors: { memory: null, skills: null, cron: null, gateway: null },
    ...overrides,
  };
}

function withGateway(gateway: ThothGatewaySummary): ThothStatusSummary {
  return makeSummary({ gateway });
}

describe('deriveThothPillars', () => {
  it('derives the memory tile from total facts with a curation-queue detail', () => {
    const m = deriveThothPillars(
      makeSummary({
        memory: { available: true, totalFacts: 6518, queueLength: 6518 },
      }),
    ).memory;

    expect(m.value).toBe('6,518');
    expect(m.unit).toBe('facts');
    expect(m.desc).toBe('6,518 queued for curation');
    expect(m.available).toBe(true);
    expect(m.accent).toBe('text-primary');
  });

  it('singularises the memory unit at exactly one fact', () => {
    const m = deriveThothPillars(
      makeSummary({
        memory: { available: true, totalFacts: 1, queueLength: 0 },
      }),
    ).memory;

    expect(m.value).toBe('1');
    expect(m.unit).toBe('fact');
    expect(m.desc).toBe('All curated');
  });

  it('shows the pending-candidate count for skills', () => {
    const sk = deriveThothPillars(
      makeSummary({ skills: { available: true, pendingCandidates: 0 } }),
    ).skills;

    expect(sk.value).toBe('0');
    expect(sk.unit).toBe('pending');
    expect(sk.desc).toBe('No skills awaiting review');
  });

  it('marks cron as desktop-only when unavailable for that reason', () => {
    const c = deriveThothPillars(
      makeSummary({ cron: { available: false, reason: 'desktop-only' } }),
    ).cron;

    expect(c.value).toBe('—');
    expect(c.available).toBe(false);
    expect(c.desc).toBe('Desktop only');
  });

  it('shows the running-platform count as the gateway headline metric', () => {
    const g = deriveThothPillars(
      withGateway({
        available: true,
        pendingBindings: 0,
        platforms: [
          { platform: 'telegram', state: 'running' },
          { platform: 'discord', state: 'running' },
          { platform: 'slack', state: 'disabled' },
        ],
      }),
    ).gateway;

    expect(g.value).toBe('2');
    expect(g.unit).toBe('running');
    expect(g.platforms.length).toBe(3);
  });

  it('demotes pending approvals to the gateway description line', () => {
    const g = deriveThothPillars(
      withGateway({
        available: true,
        pendingBindings: 2,
        platforms: [{ platform: 'discord', state: 'running' }],
      }),
    ).gateway;

    expect(g.value).toBe('1');
    expect(g.desc).toBe('2 pending approval');
  });

  it('reports no pending approvals when nothing awaits review', () => {
    const g = deriveThothPillars(
      withGateway({
        available: true,
        pendingBindings: 0,
        platforms: [{ platform: 'discord', state: 'enabled' }],
      }),
    ).gateway;

    expect(g.value).toBe('0');
    expect(g.desc).toBe('no pending approvals');
  });

  it('preserves the gateway desktop-only empty state', () => {
    const g = deriveThothPillars(
      withGateway({ available: false, reason: 'desktop-only' }),
    ).gateway;

    expect(g.value).toBe('—');
    expect(g.desc).toBe('Desktop only');
    expect(g.available).toBe(false);
  });

  it('surfaces per-pillar errors from the summary', () => {
    const pillars = deriveThothPillars(
      makeSummary({
        memory: { available: false, reason: 'error' },
        errors: {
          memory: 'boom',
          skills: null,
          cron: null,
          gateway: null,
        },
      }),
    );

    expect(pillars.memory.error).toBe('boom');
    expect(pillars.memory.available).toBe(false);
  });
});

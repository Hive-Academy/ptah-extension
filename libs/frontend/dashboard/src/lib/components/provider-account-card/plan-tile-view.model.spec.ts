import type {
  LocalTimeOptions,
  PlanLimitOwnerSnapshot,
  PlanLimitStatusReason,
  PlanLimitWindow,
  ProviderAccountUsageStatus,
} from '@ptah-extension/shared';
import {
  buildPlanTile,
  compactCount,
  compactTokens,
  planLimitReasonLabel,
} from './plan-tile-view.model';

const NOW = Date.UTC(2026, 9, 3, 12, 0);
const MIN = 60_000;
/** Fixed zone so absolute reset text is stable on every machine. */
const TIME: LocalTimeOptions = { timeZone: 'UTC', zoneNameLocale: 'en-GB' };

function win(overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow {
  return {
    key: 'other:test',
    kind: 'other',
    label: 'Test',
    observedAt: NOW - 2 * MIN,
    lastResetAt: NOW - 2 * 60 * MIN,
    resetsAt: NOW + 3 * 60 * MIN,
    used: { kind: 'percent', percent: 40 },
    ...overrides,
  };
}

function owner(
  windows: readonly PlanLimitWindow[],
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key: 'claude-cli#account:0123456789abcdef',
      providerId: 'claude-cli',
      identityKind: 'account',
      label: 'Claude account',
    },
    status: 'available',
    windowSetEstablished: true,
    windows,
    ownerEvidence: [],
    ...overrides,
  };
}

describe('plan-tile-view.model', () => {
  describe('buildPlanTile primary selection', () => {
    it('shows the window with the highest finite used percentage', () => {
      const view = buildPlanTile(
        owner([
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour',
            used: { kind: 'percent', percent: 41 },
          }),
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: { kind: 'percent', percent: 94 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar?.name).toBe('Weekly');
      expect(view.bar?.roundedPercent).toBe(94);
      // 94% is at or above the near-limit percent, so the fill warns.
      expect(view.bar?.barTone).toBe('warning');
      // The other window stays as a labeled chip.
      expect(view.chips.map((chip) => chip.label)).toContain('5-hour');
    });

    it('breaks an equal percentage tie by the nearest reset', () => {
      const view = buildPlanTile(
        owner([
          win({ key: 'weekly', kind: 'weekly', label: 'Weekly', resetsAt: NOW + 10 * 60 * MIN }),
          win({ key: 'monthly', kind: 'monthly', label: 'Monthly', resetsAt: NOW + 2 * 60 * MIN }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar?.name).toBe('Monthly');
    });

    it('breaks an equal percentage and reset tie by the stable window key', () => {
      const view = buildPlanTile(
        owner([
          win({ key: 'monthly', kind: 'monthly', label: 'Monthly', resetsAt: NOW + 60 * MIN }),
          win({ key: 'weekly', kind: 'weekly', label: 'Weekly', resetsAt: NOW + 60 * MIN }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar?.name).toBe('Monthly');
    });

    it('never promotes a window without a finite percentage or a future reset', () => {
      const view = buildPlanTile(
        owner([
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: undefined,
          }),
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour',
            resetsAt: NOW - 5 * MIN,
            observedAt: NOW - 6 * MIN,
            lastResetAt: undefined,
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar).toBeNull();
      // Windows exist, so the pill names the precise cause.
      expect(view.statusPill?.text).toBe(
        'No plan window reports a known usage with a future reset',
      );
    });

    it('excludes a reset-usage-unknown window even when its reset is still ahead', () => {
      const view = buildPlanTile(
        owner([
          // A reset after the last observation invalidated the used value;
          // the reported next reset is still future (window-state case b).
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            observedAt: NOW - 20 * MIN,
            lastResetAt: NOW - 5 * MIN,
            resetsAt: NOW + 30 * MIN,
            used: { kind: 'percent', percent: 80 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar).toBeNull();
      expect(view.statusPill?.text).toBe(
        'No plan window reports a known usage with a future reset',
      );
    });
  });

  describe('buildPlanTile Claude duplicate rule', () => {
    it('hides the generic weekly chip when it is reset-usage-unknown and a model weekly exists', () => {
      const view = buildPlanTile(
        owner([
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            observedAt: NOW - 20 * MIN,
            resetsAt: NOW - 5 * MIN,
            used: { kind: 'percent', percent: 73 },
          }),
          win({
            key: 'weekly_model:opus-4.1',
            kind: 'weekly_model',
            label: 'Weekly Opus 4.1',
            used: { kind: 'percent', percent: 30 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.chips.map((chip) => chip.label)).not.toContain('Weekly');
      // The hidden window keeps its reset and status in the tile tooltip.
      expect(view.hiddenWindowNotes.length).toBeGreaterThan(0);
      expect(view.hiddenWindowNotes[0]).toContain(
        'Weekly (hidden from the compact view)',
      );
      expect(view.hiddenWindowNotes[0]).toContain('current usage unknown');
    });

    it('keeps both weekly windows when the generic one is valid', () => {
      const view = buildPlanTile(
        owner([
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: { kind: 'percent', percent: 50 },
          }),
          win({
            key: 'weekly_model:opus-4.1',
            kind: 'weekly_model',
            label: 'Weekly Opus 4.1',
            used: { kind: 'percent', percent: 30 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar?.name).toBe('Weekly');
      expect(view.chips.map((chip) => chip.label)).toContain('Weekly Opus 4.1');
      expect(view.hiddenWindowNotes).toEqual([]);
    });
  });

  describe('buildPlanTile status pill and chips', () => {
    it('names the status cause for an owner without any window', () => {
      const view = buildPlanTile(
        owner([], { status: 'unsupported-auth' }),
        NOW,
        TIME,
      );
      expect(view.bar).toBeNull();
      expect(view.statusPill?.text).toBe(
        'No plan limits (API key)',
      );
    });

    it('warns on a chip at 90 percent and stays neutral below it', () => {
      const at90 = buildPlanTile(
        owner([
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: { kind: 'percent', percent: 90 },
          }),
          win({
            key: 'monthly',
            kind: 'monthly',
            label: 'Monthly',
            used: { kind: 'percent', percent: 95 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(at90.bar?.name).toBe('Monthly');
      expect(at90.chips[0]?.tone).toBe('warning');
      const at89 = buildPlanTile(
        owner([
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: { kind: 'percent', percent: 89 },
          }),
          win({
            key: 'monthly',
            kind: 'monthly',
            label: 'Monthly',
            used: { kind: 'percent', percent: 95 },
          }),
        ]),
        NOW,
        TIME,
      );
      expect(at89.chips[0]?.tone).toBe('neutral');
    });

    it('carries the reset fact and the source label in a chip tooltip', () => {
      const view = buildPlanTile(
        owner([
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour',
            resetsAt: NOW + 5 * 60 * MIN,
            used: { kind: 'percent', percent: 20 },
            usedSource: 'stream-event',
            resetSource: 'provider-api',
          }),
          win({ used: { kind: 'percent', percent: 60 } }),
        ]),
        NOW,
        TIME,
      );
      const chip = view.chips.find((c) => c.label === '5-hour');
      expect(chip?.resetText).toBe('in 5h 0m');
      expect(chip?.title).toContain('Live event');
      expect(chip?.title).toContain('Provider API');
    });
  });

  describe('buildPlanTile secondary line', () => {
    it('shows request counts for a requests-metering source', () => {
      const view = buildPlanTile(
        owner(
          [],
          {
            status: 'no-usage-source',
            localUsage: {
              kind: 'local-usage',
              label: 'Ollama Cloud usage',
              tokens: 0,
              estimatedCostUsd: 0,
              observedAt: NOW - MIN,
              source: 'provider-api',
              requests: 2588,
            },
          },
        ),
        NOW,
        TIME,
      );
      expect(view.secondary?.text).toBe('2,588 requests');
      expect(view.statusPill?.text).toBe('Local usage only');
    });

    it('shows tokens and cost for a local CLI, plus compacted lifetime tokens', () => {
      const view = buildPlanTile(
        owner([], {
          localUsage: {
            kind: 'local-usage',
            label: 'OpenCode CLI usage',
            tokens: 1234,
            estimatedCostUsd: 5.67,
            observedAt: NOW - MIN,
            source: 'local-cli',
            range: '2026-09-03T00:00:00Z – 2026-10-03T00:00:00Z',
          },
          activity: { lifetimeTokens: '7337444803', dailyUsage: [] },
        }),
        NOW,
        TIME,
      );
      expect(view.secondary?.text).toBe(
        '1,234 tokens · $5.67 · 7.3B lifetime tokens',
      );
      // The compact label annotates the exact range, which stays in the
      // tooltip (restored old-card coverage).
      expect(view.secondary?.title).toContain(
        'Range: 2026-09-03T00:00:00Z – 2026-10-03T00:00:00Z (last 30 days)',
      );
      expect(view.secondary?.title).toContain(
        'not a plan percentage or reset',
      );
    });

    it('falls back to the raw string for a backwards or unparseable range', () => {
      const withRange = (range: string) =>
        buildPlanTile(
          owner([], {
            localUsage: {
              kind: 'local-usage',
              label: 'Local usage',
              tokens: 10,
              estimatedCostUsd: 0.1,
              observedAt: NOW,
              source: 'local-cli',
              range,
            },
          }),
          NOW,
          TIME,
        );
      expect(
        withRange('2026-01-30T22:00:00.000Z - 2025-12-31T22:00:00.000Z')
          .secondary?.title,
      ).toContain('Range: 2026-01-30T22:00:00.000Z - 2025-12-31T22:00:00.000Z');
      expect(withRange('since install').secondary?.title).toContain(
        'Range: since install',
      );
    });

    it('lists per-model request counts in the tooltip, capped at five, with an accessible equivalent', () => {
      const withUsage = (models: { model: string; requests: number }[]) =>
        buildPlanTile(
          owner([], {
            status: 'no-usage-source',
            localUsage: {
              kind: 'local-usage',
              label: 'Ollama Cloud usage',
              tokens: 0,
              estimatedCostUsd: 0,
              observedAt: NOW - MIN,
              source: 'provider-api',
              requests: 273,
              models,
            },
          }),
          NOW,
          TIME,
        );
      const single = withUsage([{ model: 'glm-5.3', requests: 1 }]);
      expect(single.secondary?.title).toContain('Top models:');
      expect(single.secondary?.title).toContain('glm-5.3 · 1 request');
      expect(single.secondary?.accessibleText).toBe(
        'Top models: glm-5.3 · 1 request',
      );

      const capped = withUsage([
        { model: 'llama3.1', requests: 42 },
        { model: 'gpt-oss', requests: 1 },
        { model: 'glm-5.3', requests: 185 },
        { model: 'mistral', requests: 1 },
        { model: 'qwen3', requests: 20 },
        { model: 'phi4', requests: 3 },
        { model: 'deepseek-r1', requests: 2 },
      ]);
      // Ranked by requests, capped at five lines, then "and N more".
      expect(capped.secondary?.title).toContain(
        'Top models:\nglm-5.3 · 185 requests\nllama3.1 · 42 requests\nqwen3 · 20 requests\nphi4 · 3 requests\ndeepseek-r1 · 2 requests\nand 2 more',
      );
      expect(capped.secondary?.accessibleText).toBe(
        'Top models: glm-5.3 · 185 requests; llama3.1 · 42 requests; qwen3 · 20 requests; phi4 · 3 requests; deepseek-r1 · 2 requests; and 2 more',
      );
      // The visible line keeps the total only.
      expect(capped.secondary?.text).toBe('273 requests');
    });
  });

  describe('buildPlanTile owner notices', () => {
    it('keeps the stale notice when the provider refresh failed', () => {
      const view = buildPlanTile(
        owner([win({ observedAt: NOW - 2 * 60 * MIN })], {
          status: 'stale',
          staleSince: NOW - 60 * MIN,
        }),
        NOW,
        TIME,
      );
      expect(view.statusNotice).toContain('Showing cached account data');
      expect(view.statusNotice).toContain('refresh failed');
    });

    it('maps an evidence notice with its source label', () => {
      const view = buildPlanTile(
        owner([], {
          status: 'service-unavailable',
          ownerEvidence: [
            {
              observedAt: NOW - 2 * MIN,
              source: 'error-derived',
              resetsAt: NOW + 60 * MIN,
              modelScope: 'opus-4.1',
            },
          ],
        }),
        NOW,
        TIME,
      );
      expect(view.evidence.length).toBe(1);
      expect(view.evidence[0]?.text).toContain('Limit hit (opus-4.1)');
      expect(view.evidence[0]?.title).toContain('From error');
    });
  });

  describe('compactCount / compactTokens', () => {
    it('keeps exact separators below 10,000 and compacts above', () => {
      expect(compactCount(2588)).toBe('2,588');
      expect(compactCount(9999)).toBe('9,999');
      expect(compactCount(10000)).toBe('10K');
      expect(compactCount(12345678)).toBe('12.3M');
    });

    it('compacts a large integer string through BigInt without unsafe coercion', () => {
      expect(compactTokens(1234)).toBe('1,234');
      expect(compactTokens('7337444803')).toBe('7.3B');
      // Beyond the safe integer range: no Number coercion. ICU keeps its own
      // compact mantissa here; the point is the exact BigInt formatting path.
      expect(compactTokens('9007199254740993')).toBe('9007.2T');
    });

    it('refuses a decimal string that cannot be represented safely', () => {
      expect(compactTokens('9007199254740993.5')).toBe('unknown');
      expect(compactTokens('10.5')).toBe('10.5');
      expect(compactTokens('n/a')).toBe('unknown');
    });
  });

  describe('planLimitReasonLabel', () => {
    it('maps the unavailable reason and the typed status reasons from the shared DTO', () => {
      expect(planLimitReasonLabel('no-open-session')).toBe(
        'No open session to read this account’s usage from.',
      );
      expect(planLimitReasonLabel('api-key-no-subscription-quota')).toBe(
        'No subscription quota for API-key login; local usage only',
      );
      expect(planLimitReasonLabel('cli-parse-failed')).toBe(
        'Antigravity CLI usage output not recognized',
      );
      expect(planLimitReasonLabel('balance-unavailable')).toBe(
        'Plan limits unavailable right now; showing request counts',
      );
      expect(planLimitReasonLabel('balance-auth-rejected')).toBe(
        'API key cannot read plan limits; showing request counts',
      );
    });

    it('returns null for an unknown or absent reason', () => {
      // The compiled union is exhaustive; a runtime value a newer backend
      // sends must still fall back to null, never to a fabricated sentence.
      const unknown = 'some-new-reason' as PlanLimitStatusReason;
      expect(planLimitReasonLabel(unknown)).toBeNull();
      expect(planLimitReasonLabel(undefined)).toBeNull();
    });

    it('prefers the typed reason over the generic status sentence in the pill', () => {
      // Grok audit defect: an API-key login with no subscription quota used
      // to read as the generic "No plan limits (API key)" sentence.
      const view = buildPlanTile(
        owner(
          [],
          {
            owner: {
              key: 'grok#credential:0123456789abcdef',
              providerId: 'grok',
              identityKind: 'credential',
              label: 'Grok API key',
            },
            status: 'unsupported-auth',
            statusReason: 'api-key-no-subscription-quota',
            localUsage: {
              kind: 'local-usage',
              label: 'Grok usage',
              tokens: 0,
              estimatedCostUsd: 0,
              observedAt: NOW - MIN,
              source: 'provider-api',
              requests: 12,
            },
          },
        ),
        NOW,
        TIME,
      );
      expect(view.statusPill?.text).toBe(
        'No subscription quota for API-key login; local usage only',
      );
    });
  });

  describe('buildPlanTile typed statusReason priority (review defect 3)', () => {
    const antigravity = (overrides: Partial<PlanLimitOwnerSnapshot>) =>
      owner([], {
        ...overrides,
        owner: {
          key: 'antigravity#account:0123456789abcdef',
          providerId: 'antigravity',
          identityKind: 'account',
          label: 'Antigravity account',
        },
      });

    it('lets the typed reason win over the generic Antigravity app message', () => {
      const view = buildPlanTile(
        antigravity({
          status: 'service-unavailable',
          statusReason: 'cli-parse-failed',
        }),
        NOW,
        TIME,
      );
      expect(view.statusNotice).toBeNull();
      expect(view.statusPill?.text).toBe(
        'Antigravity CLI usage output not recognized',
      );
    });

    it('keeps the generic app message only as the fallback without a typed reason', () => {
      const view = buildPlanTile(
        antigravity({ status: 'service-unavailable' }),
        NOW,
        TIME,
      );
      expect(view.statusNotice).toBeNull();
      expect(view.statusPill?.text).toBe('Open Antigravity to read local quota');
    });

    it('tells a rejected Antigravity sign-in apart from a closed app', () => {
      const view = buildPlanTile(
        antigravity({ status: 'unsupported-auth' }),
        NOW,
        TIME,
      );
      expect(view.statusPill?.text).toBe(
        'Antigravity sign-in rejected — sign in to Antigravity again',
      );
      expect(view.statusPill?.text).not.toContain('Open Antigravity');
    });

    it('distinguishes an Ollama Cloud key failure, a missing key and no usage source', () => {
      const pill = (status: ProviderAccountUsageStatus) =>
        buildPlanTile(
          owner([], {
            owner: {
              key: 'ollama-cloud#credential:0123456789abcdef',
              providerId: 'ollama-cloud',
              identityKind: 'credential',
              label: 'Ollama Cloud API key',
            },
            status,
          }),
          NOW,
          TIME,
        ).statusPill?.text;
      expect(pill('unsupported-auth')).toBe('API key rejected — check the key');
      expect(pill('unsupported-config')).toBe('No API key configured');
      expect(pill('no-usage-source')).toBe('No usage source available');
    });

    it('says plan limits are unavailable for a partial Ollama read, keeping the request counts', () => {
      const partial = (statusReason: PlanLimitStatusReason) =>
        buildPlanTile(
          owner([], {
            owner: {
              key: 'ollama-cloud#credential:0123456789abcdef',
              providerId: 'ollama-cloud',
              identityKind: 'credential',
              label: 'Ollama Cloud API key',
            },
            // The reader keeps status "available" for a usage-only read;
            // only the typed reason tells the balance endpoint failed.
            statusReason,
            localUsage: {
              kind: 'local-usage',
              label: 'Ollama Cloud usage',
              tokens: 0,
              estimatedCostUsd: 0,
              observedAt: NOW - MIN,
              source: 'provider-api',
              requests: 2588,
            },
          }),
          NOW,
          TIME,
        );
      const unavailable = partial('balance-unavailable');
      expect(unavailable.bar).toBeNull();
      expect(unavailable.statusPill?.text).toBe(
        'Plan limits unavailable right now; showing request counts',
      );
      expect(unavailable.secondary?.text).toBe('2,588 requests');
      const rejected = partial('balance-auth-rejected');
      expect(rejected.statusPill?.text).toBe(
        'API key cannot read plan limits; showing request counts',
      );
      expect(rejected.statusPill?.text).not.toBe('No plan limits reported');
    });
  });

  describe('buildPlanTile window facts (restored coverage)', () => {
    it('reports a passed reset and the next reset as separate facts, usage unknown', () => {
      const view = buildPlanTile(
        owner([
          // The reset passed after the last observation: the used value is
          // void and the next reset is unknown (window-state case a).
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour',
            used: { kind: 'percent', percent: 96 },
            resetsAt: NOW - 40 * MIN,
            resetSource: 'provider-api',
            observedAt: NOW - 68 * MIN,
          }),
          // Observed before a known reset that is still ahead: the used
          // value is void, but the next reset survives (case b).
          win({
            key: 'weekly',
            kind: 'weekly',
            label: 'Weekly',
            used: { kind: 'percent', percent: 80 },
            resetsAt: NOW + 5 * 60 * MIN,
            resetSource: 'provider-api',
            lastResetAt: NOW - 40 * MIN,
            observedAt: NOW - 68 * MIN,
          }),
        ]),
        NOW,
        TIME,
      );
      expect(view.bar).toBeNull();
      const fiveHour = view.chips.find((chip) => chip.label === '5-hour');
      expect(fiveHour?.valueText).toBe('unknown');
      expect(fiveHour?.title).toContain('Used: unknown');
      expect(fiveHour?.title).toContain('came after the last observation');
      expect(fiveHour?.title).toContain('Next reset unknown');
      const weekly = view.chips.find((chip) => chip.label === 'Weekly');
      expect(weekly?.title).toContain('came after the last observation');
      expect(weekly?.title).toContain('Next reset');
      expect(weekly?.title).toContain('in 5h 0m');
    });

    it('colours the primary bar by state: ok, near-limit and limit-reached', () => {
      const tone = (window: PlanLimitWindow) =>
        buildPlanTile(owner([window]), NOW, TIME).bar?.barTone;
      expect(tone(win({ used: { kind: 'percent', percent: 3 } }))).toBe(
        'success',
      );
      expect(tone(win({ used: { kind: 'percent', percent: 94 } }))).toBe(
        'warning',
      );
      expect(
        tone(
          win({
            used: { kind: 'percent', percent: 100 },
            exhaustion: {
              observedAt: NOW - 10 * MIN,
              source: 'error-derived',
              resetsAt: NOW + 60 * MIN,
            },
          }),
        ),
      ).toBe('error');
    });

    it('keeps a neutral bar for aged, estimate-only and not-confirmed windows', () => {
      const aged = buildPlanTile(
        owner([
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour session',
            used: { kind: 'percent', percent: 97 },
            observedAt: NOW - 22 * MIN,
          }),
        ]),
        NOW,
        TIME,
      );
      expect(aged.bar?.barTone).toBe('neutral');
      expect(aged.bar?.title).toContain('Aged');
      expect(aged.bar?.title).toContain('observed 22m ago');

      const estimateOnly = buildPlanTile(
        owner([
          win({
            key: 'monthly',
            kind: 'monthly',
            label: 'Monthly',
            used: { kind: 'percent', percent: 40 },
            usedSource: 'estimated',
            resetsAt: NOW + 10 * 24 * 60 * MIN,
            resetSource: 'estimated',
          }),
        ]),
        NOW,
        TIME,
      );
      expect(estimateOnly.bar?.barTone).toBe('neutral');
      expect(estimateOnly.bar?.title).toContain('Estimate only');

      const notConfirmed = buildPlanTile(
        owner([
          win({
            key: 'five_hour',
            kind: 'five_hour',
            label: '5-hour session',
            used: { kind: 'percent', percent: 57 },
            usedSource: 'provider-unofficial',
            resetsAt: NOW + 5 * 60 * MIN,
            resetSource: 'estimated',
            lastResetAt: undefined,
          }),
        ]),
        NOW,
        TIME,
      );
      expect(notConfirmed.bar?.barTone).toBe('neutral');
      expect(notConfirmed.bar?.title).toContain('Not confirmed');
    });

    it('separates active, expired and estimated owner evidence', () => {
      const view = buildPlanTile(
        owner(
          [
            win({
              key: 'monthly',
              kind: 'monthly',
              label: 'Monthly',
              used: { kind: 'percent', percent: 40 },
              usedSource: 'estimated',
              resetsAt: NOW + 24 * 60 * MIN,
              resetSource: 'estimated',
              exhaustion: {
                observedAt: NOW - 5 * MIN,
                source: 'estimated',
                resetsAt: NOW + 60 * MIN,
              },
            }),
          ],
          {
            ownerEvidence: [
              {
                observedAt: NOW - 2 * MIN,
                source: 'error-derived',
                resetsAt: NOW + 60 * MIN,
              },
              {
                observedAt: NOW - 3 * 60 * MIN,
                source: 'error-derived',
                resetsAt: NOW - 10 * MIN,
              },
              {
                observedAt: NOW - 5 * MIN,
                source: 'estimated',
                resetsAt: NOW + 60 * MIN,
              },
            ],
          },
        ),
        NOW,
        TIME,
      );
      const active = view.evidence.find(
        (entry) =>
          !entry.text.includes('Estimated') && !entry.text.includes('expired'),
      );
      expect(active?.tone).toBe('warning');
      expect(active?.text).toContain('Limit hit');
      const expired = view.evidence.find((entry) =>
        entry.text.includes('expired'),
      );
      expect(expired?.tone).toBe('neutral');
      const estimated = view.evidence.find((entry) =>
        entry.text.includes('Estimated'),
      );
      expect(estimated?.tone).toBe('neutral');
      // The sentence carries the observed time; assert the stable parts.
      expect(estimated?.text).toContain('Estimated limit hit');
      expect(estimated?.text).toContain('(unconfirmed, informational)');
      expect(view.bar?.title).toContain('Estimated limit hit');
    });
  });
});

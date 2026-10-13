/**
 * ProviderAccountCardComponent — the 16 design states of design §4 (F61) over
 * a fake `PlanLimitsStore`, plus selection order, the provider effect, Refresh,
 * the empty snapshot, and one pass through the REAL store with a fake RPC.
 *
 * TASK_2026_631 list redesign: one `li` per owner, compact reason rows for
 * owners without windows, per-state bar classes with the 90% tick, per-provider
 * accents, and local usage stacked below the identity (never beside the name).
 */
import { LOCALE_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  ClaudeRpcService,
  PlanLimitsStore,
  RpcResult,
} from '@ptah-extension/core';
import {
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  type OwnerLimitEvidence,
  type PlanLimitOwnerSnapshot,
  type PlanLimitWindow,
  type PlanLimitsSnapshot,
} from '@ptah-extension/shared';

import { ProviderAccountCardComponent } from './provider-account-card.component';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 3, 12, 0);
const ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = (instant: number, locale = 'en-US') =>
  formatLocalWithRelative(instant, NOW, {
    timeZone: ZONE,
    zoneNameLocale: locale,
  });
const abs = (instant: number) =>
  formatLocalAbsolute(instant, NOW, {
    timeZone: ZONE,
    zoneNameLocale: 'en-US',
  });

function win(
  overrides: Partial<PlanLimitWindow> & Pick<PlanLimitWindow, 'key' | 'label'>,
): PlanLimitWindow {
  return {
    kind: 'other',
    observedAt: NOW - 2 * MIN,
    ...overrides,
  } as PlanLimitWindow;
}

function owner(
  providerId: string,
  label: string,
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
  fingerprint = '0123456789abcdef',
): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key: `${providerId}#account:${fingerprint}`,
      providerId,
      identityKind: 'account',
      label,
    },
    status: 'available',
    windowSetEstablished: true,
    windows: [],
    ownerEvidence: [],
    ...overrides,
  };
}

const snapshotOf = (
  ...owners: PlanLimitOwnerSnapshot[]
): PlanLimitsSnapshot => ({
  generatedAt: NOW,
  owners,
  sessionOwners: {},
});

interface FakeStore {
  snapshot: WritableSignal<PlanLimitsSnapshot | null>;
  loading: WritableSignal<boolean>;
  loadError: WritableSignal<boolean>;
  now: WritableSignal<number>;
  load: jest.Mock;
}

describe('ProviderAccountCardComponent', () => {
  let store: FakeStore;
  let providerId: WritableSignal<string>;
  /** Compact-row inline actions navigate through app state (revise-2). */
  let appState: { setCurrentView: jest.Mock; openSettingsTab: jest.Mock };
  let fixture: ComponentFixture<ProviderAccountCardComponent>;

  function render(
    snapshot: PlanLimitsSnapshot | null,
    locale?: string,
  ): HTMLElement {
    store = {
      snapshot: signal(snapshot),
      loading: signal(false),
      loadError: signal(false),
      now: signal(NOW),
      load: jest.fn().mockResolvedValue(undefined),
    };
    providerId = signal('anthropic');
    appState = { setCurrentView: jest.fn(), openSettingsTab: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        { provide: PlanLimitsStore, useValue: store },
        {
          provide: AuthStateService,
          useValue: { persistedProviderId: providerId },
        },
        { provide: AppStateManager, useValue: appState },
        ...(locale ? [{ provide: LOCALE_ID, useValue: locale }] : []),
      ],
    });
    fixture = TestBed.createComponent(ProviderAccountCardComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const sections = (el: HTMLElement) =>
    Array.from(
      el.querySelectorAll<HTMLElement>(
        '[data-testid="provider-account-section"]',
      ),
    );
  const rows = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="window-row"]'));
  const textOf = (el: Element | null | undefined) =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const chipsIn = (el: Element, id: string) =>
    Array.from(el.querySelectorAll(`[data-testid="${id}"]`)).map((c) =>
      textOf(c),
    );

  // ---- 16 design states (design §4, F61) ----

  it('1. Claude: near limit, mixed provenance on an exhausted model window, overage amount', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 94 },
              usedSource: 'provider-api',
              resetsAt: NOW + 3 * HOUR + 10 * MIN,
              resetSource: 'provider-api',
              lastResetAt: NOW - 2 * HOUR,
            }),
            win({
              key: 'weekly_model:opus',
              kind: 'weekly_model',
              label: 'Weekly · Opus',
              modelScope: 'opus',
              used: { kind: 'percent', percent: 100 },
              usedSource: 'provider-api',
              resetsAt: NOW + 45 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              exhaustion: {
                observedAt: NOW - 10 * MIN,
                source: 'error-derived',
              },
            }),
            win({
              key: 'overage',
              kind: 'overage',
              label: 'Extra usage (overage)',
              used: { kind: 'amount', amount: 3.2, limit: 50, unit: 'USD' },
              usedSource: 'provider-api',
              resetsAt: NOW + 29 * 24 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
      ),
    );
    const [five, opus, overage] = rows(el);
    expect(chipsIn(five, 'state-chip')).toEqual(['▲ Near limit']);
    expect(textOf(five)).toContain('94% used');
    const resetAt = NOW + 3 * HOUR + 10 * MIN;
    expect(textOf(five)).toContain(
      `Resets ${formatRelative(resetAt, NOW)} (${abs(resetAt)})`,
    );
    const meter = five.querySelector('[data-testid="window-progress"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('94');
    expect(meter?.getAttribute('aria-label')).toBe('5-hour session plan usage');
    expect(
      el.querySelector('[data-testid="provider-account-section"]')?.className,
    ).toContain('surface-2');
    expect(meter?.className).toContain('rounded');
    expect((meter?.firstElementChild as HTMLElement)?.style.width).toBe('94%');
    expect(meter?.firstElementChild?.classList.contains('bg-warning')).toBe(
      true,
    );

    expect(chipsIn(opus, 'state-chip')).toEqual(['■ Limit reached']);
    expect(
      opus
        .querySelector('[data-testid="window-progress"]')
        ?.firstElementChild?.classList.contains('bg-error'),
    ).toBe(true);
    expect(textOf(opus)).toContain(
      `Limit reached — resets ${at(NOW + 45 * HOUR)}`,
    );
    expect(chipsIn(opus, 'source-chip')).toEqual([
      'used · reset Provider API',
      'limit From error',
    ]);

    expect(textOf(overage)).toContain('$3.20 of $50.00 used');
    expect(chipsIn(overage, 'state-chip')).toEqual([]);
  });

  it('2. Claude: window known, reset unknown, usage unknown', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'weekly_model:opus',
              kind: 'weekly_model',
              label: 'Weekly · Opus',
              exhaustion: {
                observedAt: NOW - 5 * MIN,
                source: 'error-derived',
              },
            }),
          ],
        }),
      ),
    );
    const [row] = rows(el);
    expect(textOf(row)).toContain('Limit reached — reset unknown');
    expect(textOf(row)).toContain('Used: unknown');
    expect(row.querySelector('[role="progressbar"]')).toBeNull();
    expect(textOf(row)).not.toMatch(/\b0%/);
  });

  it('3. Codex room: primary/secondary order kept, activity block unchanged, int64 counter exact', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          account: { planType: 'plus' },
          activity: { lifetimeTokens: '9007199254740993', dailyUsage: [] },
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 38 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
            win({
              key: 'weekly',
              kind: 'weekly',
              label: 'Weekly',
              used: { kind: 'percent', percent: 12 },
              usedSource: 'provider-api',
              resetsAt: NOW + 5 * 24 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
      ),
    );
    expect(
      rows(el).map((r) => textOf(r.querySelector('.text-\\[13px\\]'))),
    ).toEqual(['5-hour session', 'Weekly']);
    expect(chipsIn(el, 'state-chip')).toEqual([]);
    // every window cell carries its own source under its reset line
    expect(rows(el).map((r) => chipsIn(r, 'source-chip'))).toEqual([
      ['Provider API'],
      ['Provider API'],
    ]);
    expect(textOf(el)).toContain('Lifetime tokens: 9007199254740993');
    expect(textOf(el)).toContain(
      'Activity is not remaining messages, credits, or billing.',
    );
    expect(textOf(el)).toContain('Plan: plus');
    expect(sections(el)[0]?.getAttribute('aria-label')).toBe(
      'Codex account · cdef usage',
    );
  });

  it('4. Antigravity: not confirmed with unofficial and estimated sources; weekly usage unknown', () => {
    const el = render(
      snapshotOf(
        owner('antigravity', 'Antigravity account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 57 },
              usedSource: 'provider-unofficial',
              resetsAt: NOW + 5 * HOUR,
              resetSource: 'estimated',
            }),
            win({ key: 'weekly', kind: 'weekly', label: 'Weekly' }),
          ],
        }),
      ),
    );
    const [five, weekly] = rows(el);
    expect(chipsIn(five, 'state-chip')).toEqual(['? Not confirmed']);
    expect(textOf(five)).toContain(
      'last reset unknown: freshness cannot be confirmed',
    );
    const sources = Array.from(
      five.querySelectorAll('[data-testid="source-chip"]'),
    );
    expect(sources.map(textOf)).toEqual([
      'used Unofficial',
      'reset ~ Estimate',
    ]);
    expect(
      sources.every(
        (s) =>
          s.classList.contains('border-dashed') &&
          s.classList.contains('italic'),
      ),
    ).toBe(true);
    expect(chipsIn(weekly, 'state-chip')).toEqual(['? Usage unknown']);
    expect(textOf(weekly)).toContain('Used: unknown');
    expect(textOf(weekly)).toContain('Reset unknown');
  });

  it('5. OpenCode: no usage source, nothing recorded — no bar and no percentage', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode account', {
          status: 'no-usage-source',
          windowSetEstablished: false,
        }),
      ),
    );
    expect(textOf(el)).toContain('○ No usage source');
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    // the section heading names the 90% tick; the row itself shows no percent
    expect(textOf(sections(el)[0])).not.toContain('%');
    expect(textOf(el.querySelector('[data-testid="status-chip"]'))).toBe(
      '○ No usage source',
    );
  });

  it('renders local token and cost accounting as a compact stat without a radial gauge', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode local', {
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage: tokens & estimated cost',
            tokens: 1234,
            estimatedCostUsd: 5.67,
            observedAt: NOW,
            source: 'local-cli',
          },
        }),
      ),
    );
    const stat = el.querySelector('[data-testid="local-usage-stat"]');

    expect(textOf(stat)).toContain('Local usage: tokens & estimated cost');
    expect(textOf(stat)).toContain('1,234 tokens · $5.67');
    expect(stat?.querySelector('.radial-progress')).toBeNull();
    expect(el.querySelector('[data-testid="window-progress"]')).toBeNull();
    expect(textOf(el.querySelector('[data-testid="local-usage-note"]'))).toBe(
      'Local CLI accounting · not a plan percentage or reset',
    );
  });

  it('renders Ollama Cloud request counts without tokens, cost or a plan percentage', () => {
    const el = render(
      snapshotOf(
        owner('ollama-cloud', 'Ollama Cloud API key', {
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Ollama Cloud requests',
            tokens: 0,
            estimatedCostUsd: 0,
            requests: 2588,
            observedAt: NOW,
            source: 'provider-api',
            range: 'last 7 days',
          },
        }),
      ),
    );
    const stat = el.querySelector('[data-testid="local-usage-stat"]');

    expect(
      textOf(stat?.querySelector('[data-testid="local-usage-value"]') ?? null),
    ).toBe('2,588 requests');
    expect(textOf(stat)).not.toContain('tokens');
    expect(textOf(stat)).not.toContain('$');
    expect(
      textOf(stat?.querySelector('[data-testid="local-usage-range"]') ?? null),
    ).toBe('Range: last 7 days');
    expect(
      textOf(stat?.querySelector('[data-testid="local-usage-note"]') ?? null),
    ).toBe(
      'Account request count from the provider · no plan percentage or reset',
    );
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('labels the local usage range "last N days", with the exact range in the tooltip (revise-2)', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode local', {
          status: 'no-usage-source',
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage',
            tokens: 1234,
            estimatedCostUsd: 5.67,
            observedAt: NOW,
            source: 'local-cli',
            range: '2025-12-31T22:00:00.000Z – 2026-01-30T22:00:00.000Z',
          },
        }),
        owner('codex', 'Codex local', {
          status: 'no-usage-source',
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage',
            tokens: 10,
            estimatedCostUsd: 0.1,
            observedAt: NOW,
            source: 'local-cli',
            range: '2026-01-30T22:00:00.000Z - 2025-12-31T22:00:00.000Z',
          },
        }),
        owner('grok', 'Grok local', {
          status: 'no-usage-source',
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage',
            tokens: 99,
            estimatedCostUsd: 1.23,
            observedAt: NOW,
            source: 'local-cli',
            range: 'since install',
          },
        }),
      ),
    );
    const ranges = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="local-usage-range"]'),
    );
    // a 30-day CLI range (the reader's en-dash form) reads "last 30 days";
    // a backwards or unparseable range falls back to the raw string, and
    // the exact range stays in the tooltip
    expect(ranges.map((r) => textOf(r))).toEqual([
      'Range: last 30 days',
      'Range: 2026-01-30T22:00:00.000Z - 2025-12-31T22:00:00.000Z',
      'Range: since install',
    ]);
    expect(ranges[0]?.getAttribute('title')).toBe(
      '2025-12-31T22:00:00.000Z – 2026-01-30T22:00:00.000Z',
    );
    expect(ranges[2]?.getAttribute('title')).toBe('since install');
  });

  it('offers inline actions on compact rows, wired only to existing navigation (revise-2)', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          status: 'service-unavailable',
          unavailableReason: 'no-open-session',
          windowSetEstablished: false,
        }),
        owner('ollama-cloud', 'Ollama Cloud', {
          status: 'unsupported-config',
          windowSetEstablished: false,
        }),
        owner('grok', 'Grok account', {
          status: 'unsupported-auth',
          windowSetEstablished: false,
        }),
      ),
    );
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>('[data-testid="compact-action"]'),
    );
    // only the no-open-session reason and the missing Ollama Cloud key
    // carry an action; every other compact row (the API-key owner) keeps none
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Go to chat',
      'Add key',
    ]);
    expect(buttons[0]?.getAttribute('aria-label')).toMatch(
      /^Go to chat for Claude account/,
    );
    buttons[0]?.click();
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
    buttons[1]?.click();
    expect(appState.openSettingsTab).toHaveBeenCalledWith(
      'providers',
      'ollama-cloud',
    );
  });

  it('6. OpenCode: no usage source plus a recorded limit hit with a known reset', () => {
    const evidence: OwnerLimitEvidence = {
      observedAt: NOW - 18 * MIN,
      source: 'error-derived',
      resetsAt: NOW + 5 * HOUR,
    };
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode account', {
          status: 'no-usage-source',
          ownerEvidence: [evidence],
        }),
      ),
    );
    const notice = el.querySelector('[data-testid="owner-evidence"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.classList.contains('border-warning')).toBe(true);
    expect(textOf(notice)).toContain(
      `Limit hit ${abs(NOW - 18 * MIN)} · window unknown · resets ${at(NOW + 5 * HOUR)}`,
    );
    expect(textOf(notice)).toContain('From error');
  });

  it('7. OpenCode: limit hit with an unknown reset', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode account', {
          status: 'no-usage-source',
          ownerEvidence: [
            { observedAt: NOW - 18 * MIN, source: 'error-derived' },
          ],
        }),
      ),
    );
    expect(
      textOf(el.querySelector('[data-testid="owner-evidence"]')),
    ).toContain('window unknown · reset unknown');
  });

  it('8. Ollama: not confirmed windows plus a separate active cooldown', () => {
    const el = render(
      snapshotOf(
        owner('ollama-cloud', 'Ollama Cloud account', {
          cooldown: { until: NOW + 14 * MIN, observedAt: NOW - MIN },
          windows: [
            win({
              key: 'other:session',
              label: 'Session',
              used: { kind: 'percent', percent: 72 },
              usedSource: 'provider-unofficial',
            }),
          ],
        }),
      ),
    );
    expect(chipsIn(el, 'state-chip')).toEqual(['? Not confirmed']);
    const cooldown = el.querySelector('[data-testid="cooldown"]');
    expect(cooldown?.getAttribute('role')).toBe('status');
    expect(textOf(cooldown)).toContain('Cooldown');
    expect(textOf(cooldown)).toContain('a retry delay, not a plan reset');
    expect(textOf(cooldown)).toContain('in 14m');
  });

  it('9. partial live event: value with its Live event source', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windowSetEstablished: false,
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 82 },
              usedSource: 'stream-event',
              resetsAt: NOW + 3 * HOUR,
              resetSource: 'stream-event',
              lastResetAt: NOW - 2 * HOUR,
            }),
          ],
        }),
      ),
    );
    expect(textOf(el)).toContain('82% used');
    expect(chipsIn(el, 'source-chip')).toEqual(['Live event']);
  });

  it('10. aged: value kept with its age, Aged chip', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 38 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - 50 * MIN,
              observedAt: NOW - 22 * MIN,
            }),
          ],
        }),
      ),
    );
    expect(chipsIn(el, 'state-chip')).toEqual(['◷ Aged']);
    expect(textOf(el)).toContain('38% used');
    expect(textOf(el)).toContain('observed 22m ago');
  });

  it('11. stale: existing stale notice kept, status chip, cached values aged', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          status: 'stale',
          staleSince: NOW - 47 * MIN,
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 38 },
              usedSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              observedAt: NOW - 47 * MIN,
            }),
          ],
        }),
      ),
    );
    expect(textOf(el.querySelector('[data-testid="status-chip"]'))).toBe(
      '◷ Cached data',
    );
    expect(textOf(el)).toContain(
      `Showing cached account data; refresh failed at ${abs(NOW - 47 * MIN)}.`,
    );
    expect(chipsIn(el, 'state-chip')).toEqual(['◷ Aged']);
    expect(textOf(el)).toContain('cached, observed 47m ago');
  });

  it('12. stale with an active live limit: limit still shown', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          status: 'stale',
          staleSince: NOW - 47 * MIN,
          windows: [
            win({
              key: 'weekly',
              kind: 'weekly',
              label: 'Weekly',
              used: { kind: 'percent', percent: 100 },
              usedSource: 'provider-api',
              resetsAt: NOW + 6 * 24 * HOUR,
              resetSource: 'provider-api',
              observedAt: NOW - 47 * MIN,
              exhaustion: { observedAt: NOW - 5 * MIN, source: 'stream-event' },
            }),
          ],
        }),
      ),
    );
    expect(chipsIn(el, 'state-chip')).toEqual(['■ Limit reached']);
    expect(textOf(el)).toContain(
      `Limit reached — resets ${at(NOW + 6 * 24 * HOUR)}`,
    );
    expect(chipsIn(el, 'source-chip')).toEqual([
      'used · reset Provider API',
      'limit Live event',
    ]);
  });

  it('13. post-reset fresh observation: ok, no chip', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 3 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - 40 * MIN,
              observedAt: NOW - 10 * MIN,
            }),
          ],
        }),
      ),
    );
    expect(chipsIn(el, 'state-chip')).toEqual([]);
    expect(textOf(el)).toContain('3% used');
  });

  it('14. reset passed before a newer read: usage unknown, passed and next reset as separate facts', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 96 },
              usedSource: 'provider-api',
              resetsAt: NOW - 40 * MIN,
              resetSource: 'provider-api',
              observedAt: NOW - 68 * MIN,
            }),
          ],
        }),
      ),
    );
    const [row] = rows(el);
    expect(chipsIn(row, 'state-chip')).toEqual(['↻ Reset · usage unknown']);
    expect(textOf(row)).toContain('Used: unknown');
    expect(textOf(row)).not.toContain('96%');
    expect(textOf(row)).toContain(
      `Reset ${abs(NOW - 40 * MIN)} (40m ago) came after the last observation (${abs(NOW - 68 * MIN)})`,
    );
    expect(textOf(row)).toContain('Next reset unknown');
    expect(row.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('15. unsupported-auth: raw status name and its sentence, no windows', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          status: 'unsupported-auth',
          windowSetEstablished: false,
        }),
      ),
    );
    expect(textOf(el.querySelector('[data-testid="status-chip"]'))).toBe(
      '– API key — no plan limits',
    );
    expect(textOf(el)).toContain('No plan limits (API key)');
    expect(rows(el)).toHaveLength(0);
  });

  it('does not claim local usage for an owner without a source', () => {
    const el = render(
      snapshotOf(
        owner('grok', 'Grok account', {
          status: 'no-usage-source',
          windowSetEstablished: false,
        }),
      ),
    );
    expect(textOf(el)).toContain('No usage source available');
    expect(textOf(el)).not.toContain('Local usage only');
  });

  it('shows local-only notice when an owner has local accounting', () => {
    const el = render(
      snapshotOf(
        owner('grok', 'Grok account', {
          status: 'no-usage-source',
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage',
            tokens: 1234,
            estimatedCostUsd: 5.67,
            observedAt: NOW,
            source: 'local-cli',
          },
        }),
      ),
    );
    expect(textOf(el)).toContain('Local usage only');
  });

  it('distinguishes Ollama Cloud key failure, missing key and local usage', () => {
    const cases = [
      ['unsupported-auth', 'API key rejected — check the key'],
      ['unsupported-config', 'No API key configured'],
      ['no-usage-source', 'No usage source available'],
    ] as const;
    const el = render(
      snapshotOf(
        ...cases.map(([status], i) =>
          owner(
            'ollama-cloud',
            'Ollama Cloud account',
            { status },
            `0123456789abcde${i}`,
          ),
        ),
      ),
    );
    cases.forEach(([, expected], i) =>
      expect(textOf(sections(el)[i])).toContain(expected),
    );
  });

  it('tells a rejected Antigravity sign-in apart from a closed app', () => {
    const el = render(
      snapshotOf(
        owner(
          'antigravity',
          'Antigravity account',
          { status: 'unsupported-auth' },
          '0123456789abcdea',
        ),
        owner(
          'antigravity',
          'Antigravity account',
          { status: 'service-unavailable' },
          '0123456789abcdeb',
        ),
      ),
    );
    expect(textOf(sections(el)[0])).toContain(
      'Antigravity sign-in rejected — sign in to Antigravity again',
    );
    expect(textOf(sections(el)[0])).not.toContain('Open Antigravity');
    expect(textOf(sections(el)[1])).toContain(
      'Open Antigravity to read local quota',
    );
  });

  it('shows distinct unknown-owner reasons and a short key suffix', () => {
    const cases = [
      ['missing-account-email', 'Signed in · account email not shared'],
      ['codex-not-read', 'Account not read yet'],
      ['unrouted-daemon', 'Local Ollama daemon'],
      ['missing-api-key', 'No API key configured'],
      ['unresolved-route', 'Account identity unavailable'],
    ] as const;
    const el = render(
      snapshotOf(
        ...cases.map(([reason], i) =>
          owner('ollama-cloud', 'Ollama account unknown', {
            unknownReason: reason,
            owner: {
              key: `ollama-cloud#unknown:0123456789abcde${i}`,
              providerId: 'ollama-cloud',
              identityKind: 'unknown',
              label: 'Ollama account unknown',
            },
          }),
        ),
      ),
    );
    cases.forEach(([, expected], i) => {
      expect(textOf(sections(el)[i])).toContain(expected);
      expect(textOf(sections(el)[i])).toContain(
        `Ollama account unknown · cde${i}`,
      );
    });
  });

  it('shows the used amount visibly when a window has no percentage', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'other:tokens',
              label: 'Tokens',
              used: { kind: 'amount', amount: 42, limit: 1000, unit: 'tokens' },
            }),
          ],
        }),
      ),
    );
    const value = el.querySelector('[data-testid="window-value"]');
    expect(value?.textContent).toContain('42');
    expect(value?.textContent).not.toContain('—');
  });

  it('shows a clear empty state when a successful read has no windows', () => {
    const el = render(snapshotOf(owner('opencode', 'OpenCode account')));
    expect(textOf(el)).toContain('No plan limits reported');
    expect(rows(el)).toHaveLength(0);
    expect(sections(el)[0]?.className).not.toContain('h-full');
  });

  it('16. service-unavailable: raw status name and sentence; other failure statuses name themselves', () => {
    const el = render(
      snapshotOf(
        owner('antigravity', 'Antigravity account', {
          status: 'service-unavailable',
        }),
        owner('codex-x', 'Codex CLI', { status: 'cli-version-unsupported' }),
      ),
    );
    // every status badge leads with a glyph (revise-2 M3)
    expect(chipsIn(el, 'status-chip')).toEqual([
      '○ Usage unavailable',
      '! CLI update needed',
    ]);
    expect(textOf(el)).toContain('Usage unavailable');
    expect(textOf(el)).toContain('Usage cannot be read');
  });

  it('16c. unsupported-config, provider-unsupported and cli-unavailable each name themselves with their sentence', () => {
    const el = render(
      snapshotOf(
        owner('ollama-cloud', 'Ollama Cloud', { status: 'unsupported-config' }),
        owner('some-provider', 'Some provider', {
          status: 'provider-unsupported',
        }),
        owner('codex-y', 'Codex CLI', { status: 'cli-unavailable' }),
      ),
    );
    expect(chipsIn(el, 'status-chip')).toEqual([
      '○ No API key configured',
      '○ No usage source',
      '! CLI unavailable',
    ]);
    expect(textOf(el)).toContain(
      'Usage cannot be read: the provider CLI was not found.',
    );
    expect(rows(el)).toHaveLength(0);
  });

  it('16b. narrow rows keep the full owner name: the local stat stacks below the identity, never beside it', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode local', {
          status: 'no-usage-source',
          windowSetEstablished: false,
          localUsage: {
            kind: 'local-usage',
            label: 'Local usage: tokens & estimated cost',
            tokens: 1234,
            estimatedCostUsd: 5.67,
            observedAt: NOW,
            source: 'local-cli',
          },
        }),
      ),
    );
    const [section] = sections(el);
    const identity = section.querySelector(
      '[data-testid="section-header"]',
    ) as HTMLElement;
    const stat = section.querySelector(
      '[data-testid="local-usage-stat"]',
    ) as HTMLElement;
    // The stat is a window-like cell of the shared windows area, a sibling
    // grid area of the identity — it can never squeeze the name column, and
    // it is never right-aligned at the far edge of the row.
    expect(stat.parentElement?.getAttribute('data-testid')).toBe(
      'section-body',
    );
    expect(stat.classList.contains('win')).toBe(true);
    expect(stat.closest('[data-testid="section-header"]')).toBeNull();
    expect(identity.className).not.toContain('text-right');
    expect(
      identity.compareDocumentPosition(stat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the status chip spaces its glyph from its word with a flex gap, so the
    // glyph never collides with the text ("○No usage source")
    const chip = el.querySelector('[data-testid="status-chip"]');
    expect(chip?.className).toContain('gap-1');
    expect(chip?.className).toContain('whitespace-nowrap');
    expect(chip?.closest('[data-testid="section-header"]')).toBeNull();
  });

  // ---- TASK_2026_631: provider list layout ----

  it('renders one full-width list row per owner', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account'),
        owner('anthropic', 'Claude account'),
      ),
    );
    const items = Array.from(el.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    // every owner section lives in its own li, in list order
    expect(sections(el).map((s) => s.closest('li'))).toEqual(items);
    expect(Array.from(el.querySelector('ul')?.children ?? [])).toEqual(items);
  });

  it('is its own titled Dashboard section, independent of session analytics', () => {
    const el = render(snapshotOf(owner('anthropic', 'Claude account')));
    const section = el.querySelector(
      '[data-testid="dashboard-section-provider-accounts"]',
    );
    expect(section?.className).toContain('surface-1');
    const heading = section?.querySelector('#provider-accounts-heading');
    expect(textOf(heading)).toBe('Provider accounts & plan limits');
    expect(section?.getAttribute('aria-labelledby')).toBe(
      'provider-accounts-heading',
    );
    expect(textOf(section)).toMatch(/marks 90%/);
  });

  it('lays every provider on the same identity | windows | actions grid', () => {
    const longName = 'Ollama Cloud (owner unknown) (key unavailable) · 229f';
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 41 },
              usedSource: 'provider-api',
              resetsAt: NOW + HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
        owner('ollama-cloud', longName, { status: 'unsupported-auth' }),
      ),
    );
    const [claude, ollama] = sections(el);
    for (const section of [claude, ollama]) {
      const children = Array.from(section.children).map((c) =>
        c.classList.contains('identity')
          ? 'identity'
          : c.classList.contains('body')
            ? 'body'
            : c.classList.contains('actions')
              ? 'actions'
              : c.className,
      );
      expect(children.slice(0, 3)).toEqual(['identity', 'body', 'actions']);
    }
    // windows and the status line both live in the shared windows area
    expect(
      claude.querySelector(
        '[data-testid="section-body"] [data-testid="window-row"]',
      ),
    ).not.toBeNull();
    expect(
      ollama.querySelector(
        '[data-testid="section-body"] [data-testid="status-line"]',
      ),
    ).not.toBeNull();
    // a long owner title truncates on one line with the full name as tooltip
    const title = ollama.querySelector('[data-testid="section-title"]');
    expect(title?.classList.contains('truncate')).toBe(true);
    expect(title?.getAttribute('title')).toContain('(owner unknown)');
    expect(
      ollama
        .querySelector('[data-testid="section-subtitle"]')
        ?.classList.contains('truncate'),
    ).toBe(true);
    // the percent sits in its own right-aligned, tabular value column
    const value = claude.querySelector('[data-testid="window-value"]');
    expect(value?.classList.contains('win-value')).toBe(true);
    expect(value?.classList.contains('tabular-nums')).toBe(true);
    expect(textOf(value)).toBe('41%');
  });

  it('renders a compact one-line reason row for an owner without windows', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          status: 'unsupported-auth',
          windowSetEstablished: false,
        }),
      ),
    );
    const [section] = sections(el);
    expect(section.classList.contains('owner-row--compact')).toBe(true);
    expect(section.querySelector('.wins')).toBeNull();
    const reason = section.querySelector('[data-testid="compact-reason"]');
    // the reason is one status line inside the shared windows area, never
    // in the identity subtitle and never pushed to the far edge
    const line = reason?.closest('[data-testid="status-line"]');
    expect(line?.classList.contains('status-line')).toBe(true);
    expect(line?.parentElement?.getAttribute('data-testid')).toBe(
      'section-body',
    );
    expect(
      section
        .querySelector('[data-testid="section-header"]')
        ?.querySelector('[data-testid="status-chip"]'),
    ).toBeNull();
    expect(textOf(reason)).toBe('No plan limits (API key)');
    expect(section.querySelector('button[type="button"]')).not.toBeNull();
  });

  it('colours each window bar by state and ticks the 90% near-limit mark', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 3 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - 40 * MIN,
              observedAt: NOW - 10 * MIN,
            }),
            win({
              key: 'weekly',
              kind: 'weekly',
              label: 'Weekly',
              used: { kind: 'percent', percent: 94 },
              usedSource: 'provider-api',
              resetsAt: NOW + 5 * 24 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
            win({
              key: 'weekly_model:opus',
              kind: 'weekly_model',
              label: 'Weekly · Opus',
              used: { kind: 'percent', percent: 100 },
              usedSource: 'provider-api',
              resetsAt: NOW + 45 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              exhaustion: {
                observedAt: NOW - 10 * MIN,
                source: 'error-derived',
              },
            }),
            win({ key: 'other:unread', label: 'Unread' }),
          ],
        }),
      ),
    );
    const [ok, near, limit, unknown] = rows(el);
    const fill = (row: HTMLElement) =>
      row.querySelector('[data-testid="window-progress"]')
        ?.firstElementChild as HTMLElement;
    expect(fill(ok)?.classList.contains('bg-success')).toBe(true);
    expect(fill(ok)?.classList.contains('bg-base-content')).toBe(false);
    expect(fill(near)?.classList.contains('bg-warning')).toBe(true);
    expect(fill(limit)?.classList.contains('bg-error')).toBe(true);
    expect(ok.querySelector<HTMLElement>('.bar-tick')?.style.left).toBe('90%');
    expect(near.querySelector<HTMLElement>('.bar-tick')?.style.left).toBe(
      '90%',
    );
    // unknown keeps a neutral hatched track, never an empty 0% bar
    expect(unknown.querySelector('[role="progressbar"]')).toBeNull();
    const track = unknown.querySelector('[data-testid="window-unknown-bar"]');
    expect(track).not.toBeNull();
    expect(track?.getAttribute('aria-hidden')).toBe('true');
    expect(unknown.querySelector('.bar-tick')).toBeNull();
  });

  it('carries a decorative per-provider accent with a generic fallback', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account'),
        owner('claude-cli', 'Claude CLI'),
        owner('openai-codex', 'Codex account'),
        owner('opencode', 'OpenCode account'),
        owner('opencode-go', 'OpenCode Go'),
        owner('antigravity', 'Antigravity account'),
        owner('ollama-cloud', 'Ollama Cloud account'),
        owner('github-copilot', 'Copilot account'),
        owner('openrouter', 'OpenRouter account'),
        owner('moonshot', 'Moonshot account'),
        owner('z-ai', 'Z AI account'),
        owner('grok', 'Grok account'),
        owner('some-provider', 'Some provider'),
      ),
    );
    const accents = sections(el).map((s) =>
      s.style.getPropertyValue('--accent'),
    );
    expect(accents).toEqual([
      '#d97757', // Claude (anthropic, claude-cli)
      '#d97757',
      '#10a37f', // Codex
      '#3b82f6', // OpenCode (opencode, -go, -zen)
      '#3b82f6',
      '#8b5cf6', // Antigravity
      '#9ca3af', // Ollama (ollama, -cloud)
      '#8957e5', // Copilot
      '#6d28d9', // OpenRouter
      '#4f46e5', // Moonshot
      '#0ea5e9', // Z.ai
      '#71717a', // Grok (xAI monochrome)
      'oklch(var(--bcm, var(--bc)))', // any other id
    ]);
  });

  it('pins the near-limit boundary: 89% is still ok, 90% turns warning', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 89 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - 40 * MIN,
              observedAt: NOW - 10 * MIN,
            }),
            win({
              key: 'weekly',
              kind: 'weekly',
              label: 'Weekly',
              used: { kind: 'percent', percent: 90 },
              usedSource: 'provider-api',
              resetsAt: NOW + 5 * 24 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              observedAt: NOW - 5 * MIN,
            }),
          ],
        }),
      ),
    );
    const [at89, at90] = rows(el);
    expect(chipsIn(at89, 'state-chip')).toEqual([]);
    expect(
      at89
        .querySelector('[data-testid="window-progress"]')
        ?.firstElementChild?.classList.contains('bg-success'),
    ).toBe(true);
    expect(chipsIn(at90, 'state-chip')).toEqual(['▲ Near limit']);
    expect(
      at90
        .querySelector('[data-testid="window-progress"]')
        ?.firstElementChild?.classList.contains('bg-warning'),
    ).toBe(true);
  });

  it('keeps a neutral fill for aged, estimate-only and not-confirmed windows, never a healthy green', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 97 },
              usedSource: 'provider-api',
              resetsAt: NOW + 4 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - 50 * MIN,
              observedAt: NOW - 22 * MIN,
            }),
          ],
        }),
        owner('opencode', 'OpenCode account', {
          windows: [
            win({
              key: 'monthly',
              kind: 'monthly',
              label: 'Monthly',
              used: { kind: 'percent', percent: 40 },
              usedSource: 'estimated',
              resetsAt: NOW + 10 * 24 * HOUR,
              resetSource: 'estimated',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
        owner('antigravity', 'Antigravity account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 57 },
              usedSource: 'provider-unofficial',
              resetsAt: NOW + 5 * HOUR,
              resetSource: 'estimated',
            }),
          ],
        }),
      ),
    );
    const fill = (row: HTMLElement) =>
      row.querySelector('[data-testid="window-progress"]')
        ?.firstElementChild as HTMLElement;
    const [aged, estimated, unconfirmed] = sections(el).map(
      (s) => s.querySelector('[data-testid="window-row"]') as HTMLElement,
    );
    // a stale 97% must not read as healthy green (revise-1 S1), and the
    // neutral fill is the muted 45% tier, not full-strength base-content
    // (revise-2 M1)
    expect(chipsIn(aged, 'state-chip')).toEqual(['◷ Aged']);
    expect(fill(aged)?.classList.contains('bg-base-content/45')).toBe(true);
    expect(fill(aged)?.classList.contains('bg-base-content')).toBe(false);
    expect(fill(aged)?.classList.contains('bg-success')).toBe(false);
    expect(chipsIn(estimated, 'state-chip')).toEqual(['~ Estimate only']);
    expect(fill(estimated)?.classList.contains('bg-base-content/45')).toBe(
      true,
    );
    expect(fill(estimated)?.classList.contains('bg-success')).toBe(false);
    expect(chipsIn(unconfirmed, 'state-chip')).toEqual(['? Not confirmed']);
    expect(fill(unconfirmed)?.classList.contains('bg-base-content/45')).toBe(
      true,
    );
    expect(fill(unconfirmed)?.classList.contains('bg-success')).toBe(false);
  });

  it('keeps the warning tone on a stale owner without windows (compact row)', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account', {
          status: 'stale',
          staleSince: NOW - 47 * MIN,
          windowSetEstablished: false,
        }),
      ),
    );
    const line = el.querySelector('[data-testid="status-line"]');
    const reason = el.querySelector('[data-testid="compact-reason"]');
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.classList.contains('border-warning')).toBe(true);
    expect(reason?.closest('[data-testid="status-line"]')).toBe(line);
    expect(textOf(reason)).toContain('Showing cached account data');
    expect(textOf(el.querySelector('[data-testid="status-chip"]'))).toBe(
      '◷ Cached data',
    );
  });

  // ---- ledger-only and informational evidence ----

  it('a ledger-only owner with no open session shows past evidence, not a read failure', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          status: 'service-unavailable',
          unavailableReason: 'no-open-session',
          ownerEvidence: [
            {
              observedAt: NOW - 30 * MIN,
              source: 'stream-event',
              resetsAt: NOW + HOUR,
            },
          ],
        }),
      ),
    );
    expect(textOf(el)).toContain(
      'No open session to read this account’s usage from; showing the last recorded limit evidence.',
    );
    expect(textOf(el)).not.toContain('did not return a readable response');
  });

  it('expired owner evidence reads expired and is not a warning', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode account', {
          status: 'no-usage-source',
          ownerEvidence: [
            {
              observedAt: NOW - 3 * HOUR,
              source: 'error-derived',
              resetsAt: NOW - 10 * MIN,
            },
          ],
        }),
      ),
    );
    const notice = el.querySelector('[data-testid="owner-evidence"]');
    expect(textOf(notice)).toContain('· expired');
    expect(notice?.classList.contains('border-warning')).toBe(false);
  });

  it('an estimated limit hit is informational, never a warning or Limit reached', () => {
    const el = render(
      snapshotOf(
        owner('opencode', 'OpenCode account', {
          ownerEvidence: [
            {
              observedAt: NOW - 5 * MIN,
              source: 'estimated',
              resetsAt: NOW + HOUR,
            },
          ],
          windows: [
            win({
              key: 'monthly',
              kind: 'monthly',
              label: 'Monthly',
              used: { kind: 'percent', percent: 40 },
              usedSource: 'estimated',
              exhaustion: {
                observedAt: NOW - 5 * MIN,
                source: 'estimated',
                resetsAt: NOW + HOUR,
              },
            }),
          ],
        }),
      ),
    );
    expect(chipsIn(el, 'state-chip')).toEqual(['~ Estimate only']);
    expect(textOf(el.querySelector('[data-testid="estimate-note"]'))).toContain(
      'Estimated limit hit (unconfirmed, informational)',
    );
    const notice = el.querySelector('[data-testid="owner-evidence"]');
    expect(textOf(notice)).toContain('Estimated limit hit');
    expect(notice?.classList.contains('border-warning')).toBe(false);
    expect(textOf(el)).not.toContain('Limit reached');
  });

  // ---- selection, effect, refresh, empty snapshot ----

  it('puts the selected provider first and follows a selection change', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account'),
        owner('anthropic', 'Claude account'),
      ),
    );
    expect(sections(el).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Claude account · cdef usage',
      'Codex account · cdef usage',
    ]);
    providerId.set('openai-codex');
    fixture.detectChanges();
    expect(sections(el).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Codex account · cdef usage',
      'Claude account · cdef usage',
    ]);
  });

  it('suffixes two owners that share the generic label, so their headings are told apart', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account'),
        owner('anthropic', 'Claude account', {}, 'fedcba9876543210'),
      ),
    );
    const headings = Array.from(el.querySelectorAll('h5')).map(textOf);
    expect(headings).toEqual([
      'Claude account · cdef',
      'Claude account · 3210',
    ]);
    expect(textOf(el)).not.toContain('anthropic#account');
  });

  it('loads exactly {providerId} on start and on every change, and stops after destroy', () => {
    render(snapshotOf());
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenLastCalledWith({ providerId: 'anthropic' });
    providerId.set('openai-codex');
    fixture.detectChanges();
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(store.load).toHaveBeenLastCalledWith({ providerId: 'openai-codex' });
    fixture.destroy();
    providerId.set('anthropic');
    TestBed.tick();
    expect(store.load).toHaveBeenCalledTimes(2);
  });

  it('Refresh reloads the selected provider with refresh:true and is disabled while loading', () => {
    const el = render(snapshotOf(owner('anthropic', 'Claude account')));
    const button = el.querySelector<HTMLButtonElement>('button[type="button"]');
    button?.click();
    expect(store.load).toHaveBeenLastCalledWith({
      providerId: 'anthropic',
      refresh: true,
    });
    store.loading.set(true);
    fixture.detectChanges();
    expect(button?.disabled).toBe(true);
  });

  it('an empty snapshot shows "Account usage unavailable", never a 0', () => {
    const el = render(snapshotOf());
    expect(textOf(el.querySelector('[data-testid="usage-unavailable"]'))).toBe(
      'Account usage unavailable',
    );
    expect(textOf(el)).not.toMatch(/\b0%/);
  });

  it('shows a spinner before the first snapshot while loading', () => {
    const el = render(null);
    store.loading.set(true);
    fixture.detectChanges();
    expect(
      el.querySelector('[aria-label="Loading account usage"]'),
    ).not.toBeNull();
  });

  it('passes the zone-name locale explicitly (LOCALE_ID)', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 10 },
              usedSource: 'provider-api',
              resetsAt: NOW + 2 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
      ),
      'en-GB',
    );
    const resetAt = NOW + 2 * HOUR;
    expect(textOf(el)).toContain(
      `Resets ${formatRelative(resetAt, NOW)} (${formatLocalAbsolute(resetAt, NOW, { timeZone: ZONE, zoneNameLocale: 'en-GB' })})`,
    );
  });

  describe('failed refresh while data is held', () => {
    const notice = (el: HTMLElement) =>
      el.querySelector<HTMLElement>('[data-testid="refresh-failed"]');
    const held = () =>
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 10 },
              usedSource: 'provider-api',
              resetsAt: NOW + 2 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              observedAt: NOW - 30 * MIN,
            }),
          ],
        }),
        owner('openai-codex', 'Codex account', {
          windows: [
            win({
              key: 'primary',
              label: 'Primary',
              observedAt: NOW - 3 * HOUR,
            }),
          ],
        }),
      );

    it('shows a neutral status notice with the newest observation in local time, above the kept sections', () => {
      const el = render(held());
      expect(notice(el)).toBeNull();

      store.loadError.set(true);
      fixture.detectChanges();
      const line = notice(el);
      expect(line?.getAttribute('role')).toBe('status');
      expect(textOf(line)).toBe(
        `Refresh failed — showing last observed data (observed ${abs(NOW - 30 * MIN)})`,
      );
      expect(line?.className).toContain('text-base-content-muted');
      expect(line?.className).toContain('border-info');
      expect(line?.className).not.toMatch(
        /border-(warning|error)|text-(warning|error)/,
      );
      expect(line?.nextElementSibling?.tagName).toBe('UL');
      expect(
        line?.nextElementSibling?.querySelector(
          '[data-testid="provider-account-section"]',
        ),
      ).not.toBeNull();
      expect(sections(el)).toHaveLength(2);
    });

    it('keeps the age-based window states unchanged', () => {
      const el = render(held());
      const before = rows(el).map((r) => textOf(r));
      store.loadError.set(true);
      fixture.detectChanges();
      expect(rows(el).map((r) => textOf(r))).toEqual(before);
    });

    it('hides the notice once a load or push succeeds', () => {
      const el = render(held());
      store.loadError.set(true);
      fixture.detectChanges();
      expect(notice(el)).not.toBeNull();
      store.loadError.set(false);
      fixture.detectChanges();
      expect(notice(el)).toBeNull();
    });

    it('is not shown when nothing is held: the empty placeholder covers that', () => {
      const el = render(snapshotOf());
      store.loadError.set(true);
      fixture.detectChanges();
      expect(notice(el)).toBeNull();
      expect(
        textOf(el.querySelector('[data-testid="usage-unavailable"]')),
      ).toBe('Account usage unavailable');
    });

    it('through the real store: a failed Refresh shows the notice, a later push clears it', async () => {
      const good = snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              observedAt: NOW - 30 * MIN,
            }),
          ],
        }),
      );
      const rpc = {
        call: jest.fn().mockResolvedValue(new RpcResult(true, good)),
      };
      TestBed.configureTestingModule({
        imports: [ProviderAccountCardComponent],
        providers: [
          { provide: ClaudeRpcService, useValue: rpc },
          { provide: AppStateManager, useValue: appState },
          {
            provide: AuthStateService,
            useValue: { persistedProviderId: signal('anthropic') },
          },
        ],
      });
      const real = TestBed.createComponent(ProviderAccountCardComponent);
      const flush = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        real.detectChanges();
      };
      real.detectChanges();
      await flush();
      const el = real.nativeElement as HTMLElement;
      expect(notice(el)).toBeNull();

      rpc.call.mockResolvedValueOnce(new RpcResult(false, undefined, 'boom'));
      el.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
      await flush();
      expect(textOf(notice(el))).toMatch(
        /^Refresh failed — showing last observed data \(observed /,
      );
      expect(sections(el)).toHaveLength(1);

      TestBed.inject(PlanLimitsStore).handleMessage({
        type: 'planLimits:changed',
        payload: { ...good, generatedAt: NOW + MIN },
      });
      real.detectChanges();
      expect(notice(el)).toBeNull();
      real.destroy();
    });
  });

  it('through the real store: the effect requests provider:getPlanLimits for the selected provider', async () => {
    const rpc = {
      call: jest.fn().mockResolvedValue(
        new RpcResult(
          true,
          snapshotOf(
            owner('openai-codex', 'Codex account', {
              activity: { lifetimeTokens: '321', dailyUsage: [] },
            }),
          ),
        ),
      ),
    };
    const selected = signal('openai-codex');
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
        {
          provide: AuthStateService,
          useValue: { persistedProviderId: selected },
        },
      ],
    });
    const real = TestBed.createComponent(ProviderAccountCardComponent);
    real.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    real.detectChanges();
    expect(rpc.call).toHaveBeenCalledWith('provider:getPlanLimits', {
      providerId: 'openai-codex',
    });
    expect(textOf(real.nativeElement)).toContain('Lifetime tokens: 321');
    real.destroy();
  });
});

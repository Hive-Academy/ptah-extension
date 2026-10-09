/**
 * ProviderAccountCardComponent — the 16 design states of design §4 (F61) over
 * a fake `PlanLimitsStore`, plus selection order, the provider effect, Refresh,
 * the empty snapshot, and one pass through the REAL store with a fake RPC.
 */
import { LOCALE_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
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
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        { provide: PlanLimitsStore, useValue: store },
        {
          provide: AuthStateService,
          useValue: { persistedProviderId: providerId },
        },
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
      `Resets in ${formatRelative(resetAt, NOW)} (${abs(resetAt)})`,
    );
    const meter = five.querySelector('[data-testid="window-radial-progress"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('94');
    expect(meter?.getAttribute('aria-label')).toBe('5-hour session plan usage');
    expect(
      el.querySelector('[data-testid="provider-account-section"]')?.className,
    ).toContain('surface-2');
    expect(meter?.className).toContain('radial-progress');
    expect(meter?.className).toContain('text-warning');
    expect(meter?.style.getPropertyValue('--value')).toBe('94');

    expect(chipsIn(opus, 'state-chip')).toEqual(['■ Limit reached']);
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
    expect(chipsIn(el, 'source-chip')).toEqual([
      'Provider API',
      'Provider API',
    ]);
    expect(textOf(el)).toContain('Lifetime tokens: 9007199254740993');
    expect(textOf(el)).toContain(
      'Activity is not remaining messages, credits, or billing.',
    );
    expect(textOf(el)).toContain('Plan: plus');
    expect(el.querySelector('section')?.getAttribute('aria-label')).toBe(
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
    expect(textOf(el)).toContain('No usage source');
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(textOf(el)).not.toContain('%');
    expect(textOf(el.querySelector('[data-testid="status-chip"]'))).toBe(
      'No usage source',
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
      'Cached data',
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
      'API key — no plan limits',
    );
    expect(textOf(el)).toContain(
      'No plan windows: this account signs in with an API key',
    );
    expect(rows(el)).toHaveLength(0);
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
    expect(chipsIn(el, 'status-chip')).toEqual([
      'Usage unavailable',
      'CLI update needed',
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
      'No usage source',
      'No usage source',
      'CLI unavailable',
    ]);
    expect(textOf(el)).toContain(
      'Usage cannot be read: the provider CLI was not found.',
    );
    expect(rows(el)).toHaveLength(0);
  });

  it('16b. the header wraps at narrow width: the status chip never truncates or overlaps the title', () => {
    const el = render(
      snapshotOf(
        owner('antigravity', 'Claude account', {
          status: 'service-unavailable',
        }),
      ),
    );
    const header = el.querySelector(
      '[data-testid="section-header"]',
    ) as HTMLElement;
    expect(header.className).toContain('flex-wrap');
    expect(header.firstElementChild?.className).toContain('min-w-0');
    expect(
      el.querySelector('[data-testid="status-chip"]')?.className,
    ).toContain('whitespace-nowrap');
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
    const headings = Array.from(el.querySelectorAll('h4')).map(textOf);
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
      `Resets in ${formatRelative(resetAt, NOW)} (${formatLocalAbsolute(resetAt, NOW, { timeZone: ZONE, zoneNameLocale: 'en-GB' })})`,
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
      expect(line?.nextElementSibling?.getAttribute('data-testid')).toBe(
        'provider-account-section',
      );
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

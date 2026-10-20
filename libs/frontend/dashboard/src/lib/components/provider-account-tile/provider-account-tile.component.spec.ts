import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitWindow,
} from '@ptah-extension/shared';
import type { PlanTileActionView } from '../provider-account-card/plan-tile-view.model';
import { ProviderAccountTileComponent } from './provider-account-tile.component';

const NOW = Date.UTC(2026, 9, 3, 12, 0);
const MIN = 60_000;

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

function createTile(
  snapshot: PlanLimitOwnerSnapshot,
): ComponentFixture<ProviderAccountTileComponent> {
  const fixture = TestBed.createComponent(ProviderAccountTileComponent);
  fixture.componentRef.setInput('owner', snapshot);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  return fixture;
}

describe('ProviderAccountTileComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProviderAccountTileComponent],
    });
  });

  it('renders the uniform header: label with key suffix, plan badge, refresh', () => {
    const fixture = createTile(
      owner([win()], { account: { planType: 'plus' } }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ptah-provider-mark')).not.toBeNull();
    expect(el.querySelector('[data-testid="tile-label"]')?.textContent?.trim()).toBe(
      'Claude account · cdef',
    );
    expect(el.querySelector('[data-testid="tile-label"]')?.getAttribute('title')).toContain(
      'Subscription quota · Plan: plus',
    );
    const badge = el.querySelector('.badge-ghost.badge-xs');
    expect(badge?.textContent?.trim()).toBe('plus');
    const refresh = el.querySelector<HTMLButtonElement>('[data-testid="tile-refresh"]');
    expect(refresh?.getAttribute('aria-label')).toBe(
      'Refresh Claude account · cdef usage',
    );
  });

  it('shows one primary bar: the highest used percentage, accessible name and value', () => {
    const fixture = createTile(
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
    );
    const el = fixture.nativeElement as HTMLElement;
    const bar = el.querySelector('[data-testid="tile-bar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('94');
    expect(bar?.getAttribute('aria-valuetext')).toBe('94% used');
    expect(bar?.getAttribute('aria-label')).toBe('Weekly plan usage');
    // 94% is at or above the near-limit percent: warning fill and the 90% tick.
    expect(bar?.querySelector('.bar-fill')?.className).toContain('bg-warning');
    const tick = bar?.querySelector<HTMLElement>('.bar-tick');
    expect(tick?.style.left).toBe('90%');
    // The other window is one compact chip, not a second bar.
    const chips = el.querySelectorAll('[data-testid="tile-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0]?.textContent).toContain('5-hour');
    expect(chips[0]?.textContent).toContain('41%');
  });

  it('puts a precise status pill in the bar slot when no window is eligible', () => {
    const fixture = createTile(owner([], { status: 'unsupported-auth' }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tile-bar"]')).toBeNull();
    const pill = el.querySelector<HTMLElement>('[data-testid="tile-status-pill"]');
    expect(pill?.textContent).toContain('No plan limits (API key)');
  });

  it('keeps the reset fact and source labels in the tooltips', () => {
    const fixture = createTile(
      owner([
        win({
          key: 'five_hour',
          kind: 'five_hour',
          label: '5-hour',
          used: { kind: 'percent', percent: 20 },
          usedSource: 'stream-event',
          resetSource: 'provider-api',
        }),
        win({
          key: 'monthly',
          kind: 'monthly',
          label: 'Monthly',
          used: { kind: 'percent', percent: 60 },
        }),
      ]),
    );
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector<HTMLElement>('[data-testid="tile-chip"]');
    expect(chip?.getAttribute('title')).toContain('Live event');
    expect(chip?.getAttribute('title')).toContain('Provider API');
    expect(chip?.textContent).toContain('in 3h');
  });

  it('hides an invalidated generic weekly from the compact view and keeps it in the tooltip', () => {
    const fixture = createTile(
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
    );
    const el = fixture.nativeElement as HTMLElement;
    const chips = el.querySelectorAll('[data-testid="tile-chip"]');
    expect(chips.length).toBe(0);
    const label = el.querySelector<HTMLElement>('[data-testid="tile-label"]');
    expect(label?.getAttribute('title')).toContain(
      'Weekly (hidden from the compact view)',
    );
    expect(label?.getAttribute('title')).toContain('current usage unknown');
  });

  it('shows local request counts as the secondary line', () => {
    const fixture = createTile(
      owner([], {
        owner: {
          key: 'ollama-cloud#credential:0123456789abcdef',
          providerId: 'ollama-cloud',
          identityKind: 'credential',
          label: 'Ollama Cloud key',
        },
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
      }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="tile-secondary"]')?.textContent?.trim(),
    ).toBe('2,588 requests');
  });

  it('shows local tokens and cost, and compacts a large lifetime-token string', () => {
    const fixture = createTile(
      owner([], {
        owner: {
          key: 'codex#account:0123456789abcdef',
          providerId: 'codex',
          identityKind: 'account',
          label: 'Codex account',
        },
        localUsage: {
          kind: 'local-usage',
          label: 'Codex CLI usage',
          tokens: 1234,
          estimatedCostUsd: 5.67,
          observedAt: NOW - MIN,
          source: 'local-cli',
          range: '2026-09-03T00:00:00Z – 2026-10-03T00:00:00Z',
        },
        activity: { lifetimeTokens: '7337444803', dailyUsage: [] },
      }),
    );
    const el = fixture.nativeElement as HTMLElement;
    const secondary = el.querySelector<HTMLElement>('[data-testid="tile-secondary"]');
    expect(secondary?.textContent).toContain('1,234 tokens · $5.67');
    expect(secondary?.textContent).toContain('7.3B lifetime tokens');
    expect(secondary?.getAttribute('title')).toContain('last 30 days');
  });

  it('shows an active limit-evidence notice with its source', () => {
    const fixture = createTile(
      owner([], {
        status: 'service-unavailable',
        ownerEvidence: [
          {
            observedAt: NOW - 2 * MIN,
            source: 'error-derived',
            resetsAt: NOW + 60 * MIN,
          },
        ],
      }),
    );
    const el = fixture.nativeElement as HTMLElement;
    const notice = el.querySelector<HTMLElement>('[data-testid="tile-notice"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('Limit hit');
    expect(notice?.getAttribute('title')).toContain('From error');
  });

  it('emits refresh and disables the button while a refresh is in flight', () => {
    const fixture = createTile(owner([win()]));
    const refreshed = jest.spyOn(fixture.componentInstance.refresh, 'emit');
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('[data-testid="tile-refresh"]');
    button?.click();
    expect(refreshed).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('refreshing', true);
    fixture.detectChanges();
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="tile-refresh"]')?.disabled,
    ).toBe(true);
  });

  it('emits the inline action for a no-open-session owner', () => {
    const fixture = createTile(
      owner([], {
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
      }),
    );
    const emitted: PlanTileActionView[] = [];
    fixture.componentInstance.actionClick.subscribe((action) =>
      emitted.push(action),
    );
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="tile-action-open-session"]',
    );
    expect(button?.textContent?.trim()).toBe('Go to chat');
    button?.click();
    expect(emitted).toEqual([
      { kind: 'open-session', label: 'Go to chat', providerId: 'claude-cli' },
    ]);
  });

  it('tints the mark with the provider accent and falls back for unknown providers', () => {
    const known = createTile(owner([win()]));
    const section = (known.nativeElement as HTMLElement).querySelector('section');
    expect(section?.style.getPropertyValue('--accent')).toBe('#d97757');
    const generic = createTile(
      owner([win()], {
        owner: {
          key: 'other-provider#account:0123456789abcdef',
          providerId: 'other-provider',
          identityKind: 'account',
          label: 'Other account',
        },
      }),
    );
    const genericSection = (generic.nativeElement as HTMLElement).querySelector('section');
    expect(genericSection?.style.getPropertyValue('--accent')).toContain('oklch(');
  });

  it('renders a neutral fill and the 90% tick for aged, estimate-only and not-confirmed windows', () => {
    const states: PlanLimitWindow[] = [
      // Aged: the observation is older than the freshness window.
      win({
        key: 'five_hour',
        kind: 'five_hour',
        label: '5-hour session',
        used: { kind: 'percent', percent: 97 },
        observedAt: NOW - 22 * MIN,
      }),
      // Estimate only: both values come from a local estimate.
      win({
        key: 'monthly',
        kind: 'monthly',
        label: 'Monthly',
        used: { kind: 'percent', percent: 40 },
        usedSource: 'estimated',
        resetsAt: NOW + 10 * 24 * 60 * MIN,
        resetSource: 'estimated',
      }),
      // Not confirmed: no window start and no provider-api reset.
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
    ];
    for (const window of states) {
      const fixture = createTile(owner([window]));
      const el = fixture.nativeElement as HTMLElement;
      const bar = el.querySelector<HTMLElement>('[data-testid="tile-bar"]');
      const fill = bar?.querySelector<HTMLElement>('.bar-fill');
      expect(fill?.className).toContain('bg-base-content/45');
      expect(fill?.className).not.toContain('bg-success');
      expect(bar?.querySelector<HTMLElement>('.bar-tick')?.style.left).toBe(
        '90%',
      );
    }
  });

  it('exposes the per-model request detail to screen readers beside the secondary line', () => {
    const fixture = createTile(
      owner([], {
        owner: {
          key: 'ollama-cloud#credential:0123456789abcdef',
          providerId: 'ollama-cloud',
          identityKind: 'credential',
          label: 'Ollama Cloud key',
        },
        status: 'no-usage-source',
        localUsage: {
          kind: 'local-usage',
          label: 'Ollama Cloud usage',
          tokens: 0,
          estimatedCostUsd: 0,
          observedAt: NOW - MIN,
          source: 'provider-api',
          requests: 273,
          models: [
            { model: 'glm-5.3', requests: 185 },
            { model: 'llama3.1', requests: 42 },
          ],
        },
      }),
    );
    const el = fixture.nativeElement as HTMLElement;
    const detail = el.querySelector('[data-testid="tile-secondary-detail"]');
    expect(detail?.textContent).toContain('glm-5.3 · 185 requests');
    expect(detail?.textContent).toContain('llama3.1 · 42 requests');
    expect(
      el
        .querySelector<HTMLElement>('[data-testid="tile-secondary"]')
        ?.getAttribute('title'),
    ).toContain('Top models:');
  });

  it('groups the tile content with a subtle border and rounded corners', () => {
    const fixture = createTile(owner([win()]));
    const section = (fixture.nativeElement as HTMLElement).querySelector(
      'section',
    );
    expect(section?.className).toContain('rounded-lg');
    expect(section?.className).toContain('border-base-content/10');
  });

  it('renders the parenthesized qualifiers as a muted second header line', () => {
    const fixture = createTile(
      owner([], {
        owner: {
          key: 'claude-cli#credential:0123456789abcdef',
          providerId: 'claude-cli',
          identityKind: 'credential',
          label: 'Claude (owner unknown) (key unavailable)',
        },
      }),
    );
    const lines = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="tile-label"] span',
    );
    expect(lines[0]?.textContent?.trim()).toBe('Claude · cdef');
    expect(lines[1]?.textContent?.trim()).toBe(
      '(owner unknown) (key unavailable)',
    );
    expect(lines[0]?.getAttribute('title')).toBe('Claude · cdef');
    expect(lines[1]?.getAttribute('title')).toBe('(owner unknown) (key unavailable)');
    expect(lines[1]?.className).not.toContain('truncate');
    expect(lines[1]?.className).toContain('break-words');
  });

  it('lets the reset line wrap instead of truncating the used value', () => {
    const fixture = createTile(
      owner([win({ used: { kind: 'percent', percent: 93 } })]),
    );
    const el = fixture.nativeElement as HTMLElement;
    const line = el.querySelector<HTMLElement>(
      '[data-testid="tile-bar-slot"] p',
    );
    expect(line?.textContent).toContain('93% used');
    expect(line?.className).not.toContain('truncate');
  });

  it('hides the whole footer for a window-less API-key owner', () => {
    const fixture = createTile(owner([], { status: 'unsupported-auth' }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tile-status-pill"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tile-status-chip"]')).toBeNull();
    expect(el.querySelector('[data-testid="tile-status"]')).toBeNull();
  });

  it('keeps only the Add key action in the footer for a missing Ollama key', () => {
    const fixture = createTile(
      owner([], {
        status: 'unsupported-config',
        owner: {
          key: 'ollama-cloud#credential:0123456789abcdef',
          providerId: 'ollama-cloud',
          identityKind: 'credential',
          label: 'Ollama Cloud (owner unknown)',
        },
      }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tile-status-chip"]')).toBeNull();
    const action = el.querySelector<HTMLButtonElement>(
      '[data-testid="tile-action-add-key"]',
    );
    expect(action?.textContent?.trim()).toBe('Add key');
  });

  it('renders a small lucide status icon in a kept footer chip', () => {
    const fixture = createTile(
      owner([win()], { status: 'cli-unavailable' }),
    );
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector<HTMLElement>('[data-testid="tile-status-chip"]');
    expect(chip?.textContent).toContain('CLI unavailable');
    expect(chip?.querySelector('svg, lucide-angular')).not.toBeNull();
    expect(chip?.textContent?.trim().startsWith('–')).toBe(false);
    expect(chip?.textContent?.trim().startsWith('○')).toBe(false);
  });

  it('shows one stale failure message and a distinct cooldown for a windowed owner', () => {
    const fixture = createTile(owner([win()], {
      status: 'stale',
      staleSince: NOW - 60 * MIN,
      cooldown: { observedAt: NOW, until: NOW + 5 * MIN },
    }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tile-status-chip"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="tile-status-notice"]')).toHaveLength(1);
    expect(el.querySelector('[data-testid="tile-status-notice"]')?.textContent).toContain('refresh failed');
    expect(el.querySelector('[data-testid="tile-cooldown"]')?.textContent).toContain('retry delay');
  });
});

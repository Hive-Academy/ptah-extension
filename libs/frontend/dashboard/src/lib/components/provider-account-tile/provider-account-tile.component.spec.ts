import { TestBed } from '@angular/core/testing';
import type { PlanLimitOwnerSnapshot, PlanLimitWindow } from '@ptah-extension/shared';
import { ProviderAccountTileComponent } from './provider-account-tile.component';

const NOW = Date.UTC(2026, 9, 3, 12, 0);
const HOUR = 3_600_000;
function windowOf(overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow {
  return { key: 'five_hour', kind: 'five_hour', label: '5-hour', observedAt: NOW, resetsAt: NOW + 4 * HOUR, used: { kind: 'percent', percent: 94 }, ...overrides };
}
function owner(windows: readonly PlanLimitWindow[], overrides: Partial<PlanLimitOwnerSnapshot> = {}): PlanLimitOwnerSnapshot {
  return { owner: { key: 'claude-cli#account:0123456789abcdef', providerId: 'claude-cli', identityKind: 'account', label: 'Claude account' }, status: 'available', windowSetEstablished: true, windows, ownerEvidence: [], ...overrides };
}
function render(snapshot: PlanLimitOwnerSnapshot): HTMLElement {
  const fixture = TestBed.createComponent(ProviderAccountTileComponent);
  fixture.componentRef.setInput('owner', snapshot);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ProviderAccountTileComponent compact grid cell', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ProviderAccountTileComponent] }));

  it('shows the primary number, labeled window bars, reset and full accessible value', () => {
    const el = render(owner([windowOf(), windowOf({ key: 'weekly', kind: 'weekly', label: 'Weekly', used: { kind: 'percent', percent: 31 } })]));
    expect(el.querySelector('[data-testid="tile-primary"]')?.textContent).toContain('94%');
    expect(el.querySelectorAll('[data-testid="tile-window"]')).toHaveLength(2);
    expect(el.querySelectorAll('[data-testid="tile-bar"]')).toHaveLength(2);
    expect(el.querySelector('[data-testid="tile-reset"]')?.textContent).toContain('resets 4h');
    expect(el.querySelector('[data-testid="provider-account-tile"]')?.getAttribute('aria-label')).toContain('Weekly 31%');
  });

  it('shows formatted amount usage instead of a percent', () => {
    const el = render(owner([windowOf({ used: { kind: 'amount', amount: 120, limit: 500, unit: 'requests' } })]));
    expect(el.querySelector('[data-testid="tile-primary"]')?.textContent).toContain('120 of 500 requests');
  });

  it('shows a status and existing action without an empty bar for a windowless owner', () => {
    const el = render(owner([], { status: 'unsupported-config', owner: { key: 'ollama-cloud#account:0123456789abcdef', providerId: 'ollama-cloud', identityKind: 'account', label: 'Ollama Cloud' } }));
    expect(el.querySelector('[data-testid="tile-status-pill"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tile-bar"]')).toBeNull();
    expect(el.querySelector('[data-testid="tile-action-add-key"]')).not.toBeNull();
  });

  it('keeps qualifiers in the tooltip rather than the compact name line', () => {
    const el = render(owner([windowOf()], { owner: { key: 'claude-cli#account:0123456789abcdef', providerId: 'claude-cli', identityKind: 'account', label: 'Claude (owner unknown)' } }));
    expect(el.querySelector('[data-testid="tile-label"]')?.textContent).not.toContain('owner unknown');
    expect(el.querySelector('[data-testid="tile-label"]')?.getAttribute('title')).toContain('owner unknown');
  });

  it('shows a cooldown with meters and keeps evidence in the title and accessible label', () => {
    const el = render(owner([windowOf()], {
      cooldown: { observedAt: NOW, until: NOW + 5 * 60_000 },
      ownerEvidence: [{ observedAt: NOW, source: 'error-derived', resetsAt: NOW + HOUR }],
    }));
    const tile = el.querySelector('[data-testid="provider-account-tile"]');
    expect(el.querySelector('[data-testid="tile-detail"]')?.textContent).toContain('a retry delay, not a plan reset');
    expect(tile?.getAttribute('title')).toContain('Limit hit');
    expect(tile?.getAttribute('aria-label')).toContain('Limit hit');
  });

  it('includes every evidence sentence in the accessible label when evidence overflows', () => {
    const el = render(owner([windowOf()], {
      ownerEvidence: [
        { observedAt: NOW, source: 'error-derived', modelScope: 'first' },
        { observedAt: NOW, source: 'error-derived', modelScope: 'second' },
        { observedAt: NOW, source: 'error-derived', modelScope: 'third' },
      ],
    }));
    const tile = el.querySelector('[data-testid="provider-account-tile"]');
    const label = tile?.getAttribute('aria-label');
    const title = tile?.getAttribute('title');
    for (const sentence of ['Limit hit (first)', 'Limit hit (second)', 'Limit hit (third)']) {
      expect(label).toContain(sentence);
      expect(title).toContain(sentence);
    }
    expect(el.querySelector('[data-testid="tile-detail"]')?.textContent).toContain('Limit hit (first)');
  });
});

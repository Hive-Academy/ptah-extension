import { TestBed } from '@angular/core/testing';
import { ProviderLaneLimitTileComponent } from './provider-lane-limit-tile.component';
import type { PlanLimitTileModel, ProviderLaneLimitModel } from './stats-limit-view-model.types';

function windowTile(label: string, used: number): PlanLimitTileModel {
  return { id: label, kind: 'window', label, captionLead: 'Kimi account', caption: 'Kimi account · 2b78',
    value: `${used}% used`, resetLine: 'resets in 2d', tone: used >= 90 ? 'error' : 'neutral',
    sourceChips: ['Provider API'], detailLines: [], window: {
      windowKey: 'monthly', label, state: 'ok', usedText: `${used}% used`, percent: used,
      resetFacts: [], sourceChips: ['Provider API'],
    } };
}

describe('ProviderLaneLimitTileComponent', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('shows the most constrained window first and compact extra windows without controls', () => {
    TestBed.configureTestingModule({ imports: [ProviderLaneLimitTileComponent] });
    const fixture = TestBed.createComponent(ProviderLaneLimitTileComponent);
    fixture.componentRef.setInput('provider', {
      id: 'provider:kimi', label: 'Kimi Code', ownerState: 'single',
      windows: [windowTile('5-hour', 41), windowTile('Monthly total', 73), windowTile('Monthly code', 80)],
      message: '', ownerDetails: [],
    } satisfies ProviderLaneLimitModel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-testid="plan-extra-window"]')).toHaveLength(2);
    expect(root.querySelectorAll('progress')).toHaveLength(3);
    expect(root.querySelector('select, button')).toBeNull();
    expect(root.textContent).not.toMatch(/Less detail|More detail/);
    expect(root.querySelectorAll('.badge-ghost')).toHaveLength(1);
    expect(root.querySelector('progress')?.getAttribute('aria-label')).toBe('Kimi Code Monthly code usage');
  });
  it('shows untracked provider state', () => {
    TestBed.configureTestingModule({ imports: [ProviderLaneLimitTileComponent] });
    const fixture = TestBed.createComponent(ProviderLaneLimitTileComponent);
    fixture.componentRef.setInput('provider', {
      id: 'provider:codex', label: 'Codex', ownerState: 'untracked', windows: [],
      message: 'Limits not tracked', ownerDetails: [],
    } satisfies ProviderLaneLimitModel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Usage · Unavailable');
    expect(root.textContent).toContain('Limits not tracked');
    expect(root.querySelector('progress')).toBeNull();
  });
  it('keeps local usage, evidence, cooldown and status beside a window', () => {
    TestBed.configureTestingModule({ imports: [ProviderLaneLimitTileComponent] });
    const fixture = TestBed.createComponent(ProviderLaneLimitTileComponent);
    const kinds = ['local-usage', 'evidence', 'cooldown', 'status'] as const;
    fixture.componentRef.setInput('provider', {
      id: 'provider:codex', label: 'Codex', ownerState: 'single', message: '', ownerDetails: [],
      windows: [windowTile('5-hour', 50), ...kinds.map(kind => ({
        id: kind, kind, label: kind, captionLead: kind, caption: kind,
        value: `${kind} value`, resetLine: '', tone: 'neutral' as const,
        chip: { text: `${kind} status`, tone: 'neutral' as const },
        sourceChips: [], detailLines: [`${kind} detail`],
      }))],
    } satisfies ProviderLaneLimitModel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-testid="plan-extra-tile"]')).toHaveLength(4);
    for (const kind of kinds) {
      expect(root.textContent).toContain(`${kind} value`);
      expect(root.textContent).toContain(`${kind} status`);
      expect(root.textContent).toContain(`${kind} detail`);
    }
  });
});

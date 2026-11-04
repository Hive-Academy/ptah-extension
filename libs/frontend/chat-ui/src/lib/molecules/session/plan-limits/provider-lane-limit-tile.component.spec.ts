import { TestBed } from '@angular/core/testing';
import { ProviderLaneLimitTileComponent } from './provider-lane-limit-tile.component';
import type { ProviderLaneLimitModel } from './stats-limit-view-model.types';
import type { PlanLimitTileModel } from './stats-limit-view-model.types';

function tile(id: string, kind: PlanLimitTileModel['kind']): PlanLimitTileModel {
  return { id, kind, label: id, captionLead: 'Account', caption: 'Account',
    value: '40% used', resetLine: 'resets later', tone: 'neutral', sourceChips: [], detailLines: [] };
}

describe('ProviderLaneLimitTileComponent', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('lets a provider reveal a cooldown when it has no window', () => {
    TestBed.configureTestingModule({ imports: [ProviderLaneLimitTileComponent] });
    const fixture = TestBed.createComponent(ProviderLaneLimitTileComponent);
    fixture.componentRef.setInput('provider', {
      id: 'provider:codex', label: 'Codex', ownerState: 'single',
      windows: [tile('cooldown', 'cooldown')],
      message: '', ownerDetails: [],
    } satisfies ProviderLaneLimitModel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = [...root.querySelectorAll('button')].find(button => button.textContent?.includes('More detail'));
    expect(toggle).toBeDefined();
    toggle?.click();
    fixture.detectChanges();
    expect(root.textContent).toContain('cooldown');
  });
  it('shows an explicit neutral multiple account state', () => {
    TestBed.configureTestingModule({ imports: [ProviderLaneLimitTileComponent] });
    const fixture = TestBed.createComponent(ProviderLaneLimitTileComponent);
    const provider: ProviderLaneLimitModel = {
      id: 'provider:codex', label: 'Codex', ownerState: 'multiple', windows: [],
      message: 'Multiple accounts', ownerDetails: ['Account A', 'Account B'],
    };
    fixture.componentRef.setInput('provider', provider);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Multiple accounts');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.textContent).toContain('Account A');
    expect(root.textContent).toContain('Account B');
  });
});

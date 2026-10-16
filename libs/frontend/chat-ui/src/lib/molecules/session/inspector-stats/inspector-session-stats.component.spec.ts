import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import type { SessionStatsInputs } from '../session-stats-view';
import { InspectorSessionStatsComponent } from './inspector-session-stats.component';

describe(InspectorSessionStatsComponent.name, () => {
  it('renders the Model label and display name as separate stat tile rows', () => {
    TestBed.configureTestingModule({
      imports: [InspectorSessionStatsComponent],
      providers: [{
        provide: ModelStateService,
        useValue: { availableModels: signal([{ id: 'claude-opus-4-7', name: 'Opus 4.7' }]) },
      }],
    });
    const fixture = TestBed.createComponent(InspectorSessionStatsComponent);
    const stats: SessionStatsInputs = {
      sessionId: 'session-1',
      snapshot: null,
      liveModelStats: {
        model: 'claude-opus-4-7',
        contextUsed: 0,
        contextPercent: 0,
        contextWindow: 0,
      },
      compactionCount: 0,
      limits: null,
      budget: null,
      context: { hasLive: false, known: false, percent: null, label: '—', usedTokens: null },
      limitSummary: { state: 'none', text: null, extra: 0, source: null, fullText: null },
    };
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('[data-testid="inspector-session-stats"]') as HTMLElement;
    const label = [...root.querySelectorAll('div')].find(element => element.textContent?.trim() === 'Model');
    expect(label).toBeTruthy();
    expect(label?.classList.contains('text-base-content-muted')).toBe(true);
    const value = label?.nextElementSibling as HTMLElement;
    expect(value.textContent?.trim()).toBe('Opus 4.7');
    expect(value.classList.contains('font-semibold')).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import type { TabState } from '@ptah-extension/chat-types';
import { CanvasSessionDetailsComponent } from './canvas-session-details.component';

describe('CanvasSessionDetailsComponent', () => {
  const tabs = signal<Partial<TabState>[]>([]);

  beforeEach(() => {
    tabs.set([]);
    TestBed.configureTestingModule({
      imports: [CanvasSessionDetailsComponent],
      providers: [{ provide: TabManagerService, useValue: { tabs } }],
    });
  });

  it('shows unavailable values without inventing session metrics', () => {
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Context');
    expect(text).toContain('Todos');
    expect(text).toContain('Git');
    expect(text).not.toContain('Agents');
    expect(
      fixture.nativeElement
        .querySelector('progress')
        .getAttribute('aria-valuetext'),
    ).toBe('Unavailable');
  });

  it('reads context and lifetime accounting from the selected tab', () => {
    tabs.set([
      {
        id: 'a',
        liveModelStats: { contextKnown: true, contextPercent: 62.4 },
        sessionStats: { tokenCount: 1234, totalCost: 0.25, messageCount: 7 },
        agentOrigin: { branch: 'feat/test' },
      },
    ]);
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('62%');
    expect(text).toContain('1,234');
    expect(text).toContain('$0.25');
    expect(text).toContain('feat/test');
  });
});

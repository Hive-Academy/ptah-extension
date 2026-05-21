import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import type { SkillSynthesisEventWire } from '@ptah-extension/shared';

import { SkillEventFeedComponent } from './event-feed.component';

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillEventFeedComponent],
  template: `<ptah-skill-event-feed [events]="events()" />`,
})
class HostComponent {
  public readonly events = signal<readonly SkillSynthesisEventWire[]>([]);
}

describe('SkillEventFeedComponent', () => {
  it('shows empty placeholder when no events', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No recent events');
  });

  it('renders the latest events (capped at limit)', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const events: SkillSynthesisEventWire[] = Array.from(
      { length: 15 },
      (_, i) => ({
        kind: i % 2 === 0 ? 'analyze-run' : 'ineligible',
        timestamp: Date.now() - i * 1000,
        sessionId: 'sess-' + i,
      }),
    );
    fixture.componentInstance.events.set(events);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('[role="list"] > li');
    expect(items.length).toBe(10);
  });

  it('shows error text when event carries error', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.events.set([
      { kind: 'error', timestamp: Date.now(), error: 'boom' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('boom');
  });
});

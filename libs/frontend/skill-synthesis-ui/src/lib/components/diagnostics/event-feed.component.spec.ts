import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import type { SkillSynthesisEventWire } from '@ptah-extension/shared';

import {
  SkillEventFeedComponent,
  groupConsecutiveEvents,
} from './event-feed.component';

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillEventFeedComponent],
  template: `<ptah-skill-event-feed [events]="events()" [limit]="limit()" />`,
})
class HostComponent {
  public readonly events = signal<readonly SkillSynthesisEventWire[]>([]);
  public readonly limit = signal<number>(10);
}

let idSeq = 0;
/** ULID-shaped, strictly increasing ids, like the backend's monotonic factory. */
function nextId(): string {
  idSeq += 1;
  return '01J' + String(idSeq).padStart(23, '0');
}

function ev(
  overrides: Partial<SkillSynthesisEventWire> = {},
): SkillSynthesisEventWire {
  return {
    id: nextId(),
    kind: 'analyze-run',
    timestamp: Date.now(),
    sessionId: 'sess-1',
    ...overrides,
  };
}

function render(
  events: readonly SkillSynthesisEventWire[],
  limit = 10,
): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.events.set(events);
  fixture.componentInstance.limit.set(limit);
  fixture.detectChanges();
  return fixture;
}

function rows(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[role="list"] > li',
    ),
  );
}

describe('SkillEventFeedComponent', () => {
  it('shows empty placeholder when no events', () => {
    const fixture = render([]);
    expect(fixture.nativeElement.textContent).toContain('No recent events');
    expect(rows(fixture)).toHaveLength(0);
  });

  it('renders the newest rows first, capped at limit', () => {
    const now = Date.now();
    // Newest-first input, alternating sessions so nothing groups.
    const events = Array.from({ length: 15 }, (_, i) =>
      ev({
        kind: i % 2 === 0 ? 'analyze-run' : 'ineligible',
        timestamp: now - i * 1000,
        sessionId: 'sess-' + i,
      }),
    );
    const fixture = render(events);
    const items = rows(fixture);
    expect(items).toHaveLength(10);
    expect(items[0].getAttribute('data-event-id')).toBe(events[0].id);
    expect(items[9].getAttribute('data-event-id')).toBe(events[9].id);
  });

  it('groups five consecutive analyze-run events for one session into one row with a count', () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ kind: 'analyze-run', timestamp: now - i * 1000 }),
    );
    const fixture = render(events);
    const items = rows(fixture);
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('data-event-id')).toBe(events[0].id);
    const count = items[0].querySelector('[data-test="event-count"]');
    expect(count?.textContent).toContain('x5');
    expect(count?.textContent).toContain('5 events');
  });

  it('starts a new row when the session changes', () => {
    const now = Date.now();
    const fixture = render([
      ev({ timestamp: now, sessionId: 'sess-1' }),
      ev({ timestamp: now - 1, sessionId: 'sess-1' }),
      ev({ timestamp: now - 2, sessionId: 'sess-2' }),
      ev({ timestamp: now - 3, sessionId: 'sess-1' }),
    ]);
    const items = rows(fixture);
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('x2');
    expect(items[1].querySelector('[data-test="event-count"]')).toBeNull();
    expect(items[2].querySelector('[data-test="event-count"]')).toBeNull();
  });

  it('renders two same-millisecond events from different sessions as two rows tracked by their real ids', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ts = Date.now();
      const b = ev({ kind: 'ineligible', timestamp: ts, sessionId: 'sess-B' });
      const a = ev({ kind: 'ineligible', timestamp: ts, sessionId: 'sess-A' });
      const fixture = render([b, a]);
      // Re-render with the same rows to exercise the track-by diff.
      fixture.componentInstance.events.set([b, a]);
      fixture.detectChanges();

      const items = rows(fixture);
      expect(items.map((li) => li.getAttribute('data-event-id'))).toEqual([
        b.id,
        a.id,
      ]);
      const logged = [...warn.mock.calls, ...error.mock.calls]
        .flat()
        .map(String)
        .join('\n');
      expect(logged).not.toContain('NG0955');
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('groups same-session same-millisecond events into one "x2" row tracked by the newer id', () => {
    const ts = Date.now();
    const older = ev({ kind: 'ineligible', timestamp: ts });
    const newer = ev({ kind: 'ineligible', timestamp: ts });
    expect(newer.id > older.id).toBe(true);
    const fixture = render([newer, older]);
    const items = rows(fixture);
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('data-event-id')).toBe(newer.id);
    expect(items[0].textContent).toContain('x2');
  });

  it('keeps the newest rows when limit is smaller than the number of groups', () => {
    const now = Date.now();
    const events = [
      ev({ kind: 'error', timestamp: now, error: 'newest' }),
      ev({ kind: 'analyze-run', timestamp: now - 1 }),
      ev({ kind: 'analyze-run', timestamp: now - 2 }),
      ev({ kind: 'ineligible', timestamp: now - 3 }),
      ev({ kind: 'curator-pass', timestamp: now - 4 }),
    ];
    const fixture = render(events, 2);
    const items = rows(fixture);
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-event-id')).toBe(events[0].id);
    expect(items[0].textContent).toContain('newest');
    // The last visible row still counts every member of its group.
    expect(items[1].getAttribute('data-event-id')).toBe(events[1].id);
    expect(items[1].textContent).toContain('x2');
  });

  it('keeps error events with different text as separate rows', () => {
    const now = Date.now();
    const fixture = render([
      ev({ kind: 'error', timestamp: now, error: 'disk full' }),
      ev({ kind: 'error', timestamp: now - 1, error: 'rpc timeout' }),
      ev({ kind: 'error', timestamp: now - 2, error: 'rpc timeout' }),
    ]);
    const items = rows(fixture);
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('disk full');
    expect(items[1].textContent).toContain('rpc timeout');
    expect(items[1].textContent).toContain('x2');
  });

  it('shows error text with the full outcome in a title', () => {
    const long = 'boom: ' + 'x'.repeat(200);
    const fixture = render([ev({ kind: 'error', error: long })]);
    expect(fixture.nativeElement.textContent).toContain('boom');
    expect(fixture.nativeElement.querySelector(`[title="${long}"]`)).not.toBeNull();
  });

  it('renders subagent-stop with subagent identifier', () => {
    const fixture = render([
      ev({ kind: 'subagent-stop', stats: { subagent: 'frontend-developer' } }),
    ]);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('subagent-stop');
    expect(text).toContain('subagent=frontend-developer');
  });

  it('renders edit-then-test with edit count', () => {
    const fixture = render([
      ev({ kind: 'edit-then-test', stats: { editCount: 5 } }),
    ]);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('edit-then-test');
    expect(text).toContain('edits=5');
  });

  it('renders rate-limited with reset time', () => {
    const resetAt = new Date('2026-05-21T14:30:00Z').getTime();
    const fixture = render([
      ev({ kind: 'rate-limited', stats: { limit: 60, resetAt } }),
    ]);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('rate-limited');
    expect(text).toContain('Limit 60/hour reached');
    expect(text).toMatch(/resets at \d{1,2}:\d{2}/);
  });
});

describe('groupConsecutiveEvents', () => {
  it('returns an empty list for no events', () => {
    expect(groupConsecutiveEvents([], 10)).toEqual([]);
  });

  it('records count, newest/oldest timestamps and the newest member', () => {
    const newest = ev({ timestamp: 300 });
    const middle = ev({ timestamp: 200 });
    const oldest = ev({ timestamp: 100 });
    const [group] = groupConsecutiveEvents([newest, middle, oldest], 10);
    expect(group).toEqual({
      id: newest.id,
      kind: 'analyze-run',
      sessionId: 'sess-1',
      newestTimestamp: 300,
      oldestTimestamp: 100,
      count: 3,
      event: newest,
    });
  });

  it('treats a missing sessionId as its own group key', () => {
    const groups = groupConsecutiveEvents(
      [
        ev({ kind: 'curator-pass', sessionId: undefined, timestamp: 2 }),
        ev({ kind: 'curator-pass', sessionId: undefined, timestamp: 1 }),
        ev({ kind: 'curator-pass', sessionId: 'sess-1', timestamp: 0 }),
      ],
      10,
    );
    expect(groups.map((g) => [g.sessionId, g.count])).toEqual([
      [null, 2],
      ['sess-1', 1],
    ]);
  });
});

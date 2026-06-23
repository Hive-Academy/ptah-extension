import { TestBed } from '@angular/core/testing';
import type { MemoryCuratorEventWire } from '@ptah-extension/shared';

import { EventFeedComponent } from './event-feed.component';

describe('EventFeedComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventFeedComponent],
    }).compileComponents();
  });

  it('renders empty placeholder when no events', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', []);
    fixture.detectChanges();

    const placeholder = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="event-feed-empty"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent ?? '').toContain('No recent events');
  });

  it('renders up to 10 events sorted newest first', () => {
    const now = 1_000_000;
    const events: MemoryCuratorEventWire[] = Array.from({ length: 15 }).map(
      (_, i) => ({
        kind: 'curator-run',
        timestamp: i * 1000,
        sessionId: `s-${i}`,
      }),
    );
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', events);
    fixture.componentRef.setInput('now', now);
    fixture.detectChanges();

    const items = (fixture.nativeElement as HTMLElement).querySelectorAll('li');
    expect(items.length).toBe(10);
    expect(items[0].textContent ?? '').toContain('s-14');
  });

  it('shows error text for error events', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'error',
        timestamp: 1,
        error: 'curator failed',
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('error');
    expect(text).toContain('curator failed');
  });

  it('renders curator-error events with the error tone (red badge)', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'curator-error',
        timestamp: 1,
        error: 'curator llm query failed',
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector('.badge');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('badge-error')).toBe(true);
    expect(badge?.classList.contains('badge-warning')).toBe(false);
    expect(badge?.textContent ?? '').toContain('curator-error');
    expect(root.textContent ?? '').toContain('curator llm query failed');
  });

  it('emits stats summary when stats present', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'curator-run',
        timestamp: 0,
        stats: { promoted: 3, decayed: 1 },
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 60_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('promoted=3');
    expect(text).toContain('1m ago');
  });

  it('renders user-cue-trigger with cue text', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'user-cue-trigger',
        timestamp: 0,
        sessionId: 'sess-1',
        stats: { cue: 'remember (this|that)' },
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('user-cue-trigger');
    expect(text).toContain('cue=remember (this|that)');
  });

  it('renders commit-detect with sha', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'commit-detect',
        timestamp: 0,
        stats: { sha: 'abc1234' },
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('commit-detect');
    expect(text).toContain('commit abc1234');
  });

  it('renders tool-failure with tool name and error snippet', () => {
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'tool-failure',
        timestamp: 0,
        sessionId: 'sess-1',
        stats: { tool: 'Bash', error: 'command exited with code 1' },
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(
      'observed Bash failure during session — command exited with code 1',
    );
  });

  it('renders rate-limited event with reset time', () => {
    const resetAt = new Date('2026-05-21T14:30:00Z').getTime();
    const fixture = TestBed.createComponent(EventFeedComponent);
    fixture.componentRef.setInput('events', [
      {
        kind: 'rate-limited',
        timestamp: 0,
        stats: { limit: 60, resetAt },
      } satisfies MemoryCuratorEventWire,
    ]);
    fixture.componentRef.setInput('now', 1_000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('rate-limited');
    expect(text).toContain('Limit 60/hour reached');
    expect(text).toMatch(/resets at \d{1,2}:\d{2}/);
  });
});

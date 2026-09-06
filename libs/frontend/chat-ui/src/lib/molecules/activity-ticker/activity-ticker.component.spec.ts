import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ActivityItem } from '@ptah-extension/core';

import { ActivityTickerComponent } from './activity-ticker.component';

function item(overrides: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    source: 'cron',
    kind: 'cron-run',
    summary: `summary ${overrides.id}`,
    timestamp: 1,
    level: 'info',
    ...overrides,
  };
}

describe('ActivityTickerComponent', () => {
  let fixture: ComponentFixture<ActivityTickerComponent>;

  function render(inputs: {
    items: readonly ActivityItem[];
    idle?: boolean;
    rotateMs?: number;
  }): void {
    fixture.componentRef.setInput('items', inputs.items);
    fixture.componentRef.setInput('idle', inputs.idle ?? false);
    if (inputs.rotateMs !== undefined) {
      fixture.componentRef.setInput('rotateMs', inputs.rotateMs);
    }
    fixture.detectChanges();
  }

  function lineText(): string | null {
    const node = fixture.nativeElement.querySelector(
      '[data-testid="activity-ticker-line"]',
    );
    return node ? node.textContent.trim() : null;
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [ActivityTickerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ActivityTickerComponent);
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('rotates through the items on the timer, in order', () => {
    render({
      items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      rotateMs: 1000,
    });

    expect(lineText()).toBe('summary a');

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(lineText()).toBe('summary b');

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(lineText()).toBe('summary c');

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(lineText()).toBe('summary a');
  });

  it('resets to the newest item when a new head arrives mid-rotation', () => {
    const first = [item({ id: 'a' }), item({ id: 'b' })];
    render({ items: first, rotateMs: 1000 });

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(lineText()).toBe('summary b');

    render({ items: [item({ id: 'z' }), ...first] });
    expect(lineText()).toBe('summary z');
  });

  it('does not reset when the head item is only updated in place', () => {
    render({ items: [item({ id: 'a' }), item({ id: 'b' })], rotateMs: 1000 });

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(lineText()).toBe('summary b');

    // Same id, new text — a coalesced progress update, not fresh news.
    render({
      items: [item({ id: 'a', summary: 'Indexing 80%' }), item({ id: 'b' })],
    });
    expect(lineText()).toBe('summary b');
  });

  it('falls back to the source label when the summary is empty', () => {
    render({ items: [item({ id: 'a', summary: '', source: 'harness' })] });

    expect(lineText()).toBe('Harness');
  });

  it('collapses to a dot when idle but stays a click target in the DOM', () => {
    const activated = jest.fn();
    render({ items: [], idle: true });
    fixture.componentInstance.activate.subscribe(activated);

    expect(lineText()).toBeNull();
    const button = fixture.nativeElement.querySelector('button');
    expect(button).toBeTruthy();

    button.click();
    expect(activated).toHaveBeenCalledTimes(1);
  });

  it('emits activate when the busy line is clicked', () => {
    const activated = jest.fn();
    render({ items: [item({ id: 'a' })] });
    fixture.componentInstance.activate.subscribe(activated);

    fixture.nativeElement.querySelector('button').click();

    expect(activated).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible live region and a labelled button', () => {
    render({ items: [item({ id: 'a' })] });

    const region = fixture.nativeElement.querySelector('[role="status"]');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');

    const button = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(
      'Open Thoth background activity',
    );
    expect(button.getAttribute('class')).toContain('no-drag');
    expect(button.getAttribute('class')).toContain('max-w-[22rem]');
  });

  it('tints the dot for a warn-level item', () => {
    render({ items: [item({ id: 'a', level: 'warn' })] });

    const dot = fixture.nativeElement.querySelector('span[aria-hidden="true"]');
    expect(dot.getAttribute('class')).toContain('bg-warning');
  });

  it('does not rotate a single item', () => {
    render({ items: [item({ id: 'a' })], rotateMs: 500 });

    jest.advanceTimersByTime(5000);
    fixture.detectChanges();

    expect(lineText()).toBe('summary a');
  });

  it('clears its rotation timer on destroy', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    render({ items: [item({ id: 'a' })] });

    fixture.destroy();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

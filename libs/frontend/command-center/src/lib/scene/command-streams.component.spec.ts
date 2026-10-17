import { TestBed } from '@angular/core/testing';
import { Ban, CircleCheck, CircleDashed, CircleX, LoaderCircle, MessageCircleQuestion } from 'lucide-angular';
import type { CommandWorkState } from '../model/command-center.store';
import { CommandStreamsComponent } from './command-streams.component';
import type { PlacedNode } from './scene-placement';

function stream(id: string, state: CommandWorkState = 'queued', kind: PlacedNode['kind'] = 'child', phases: PlacedNode['phases'] = []): PlacedNode {
  return { id, kind, parentId: 'root', label: id, providerId: 'openai', state, phases };
}

function setup(placed: PlacedNode[]) {
  TestBed.configureTestingModule({ imports: [CommandStreamsComponent] });
  const fixture = TestBed.createComponent(CommandStreamsComponent);
  fixture.componentRef.setInput('placed', placed);
  fixture.componentRef.setInput('overflow', { completed: 0, other: 0 });
  fixture.detectChanges();
  return fixture;
}

describe('CommandStreamsComponent', () => {
  it.each([
    ['completed', CircleCheck], ['failed', CircleX], ['cancelled', Ban],
    ['awaiting input', MessageCircleQuestion], ['starting', LoaderCircle],
    ['running', LoaderCircle], ['queued', CircleDashed], ['idle', CircleDashed],
    ['unknown', CircleDashed],
  ] as const)('renders the %s icon and visible state word', (state, icon) => {
    const fixture = setup([stream('Work', state)]);
    const row = fixture.nativeElement.querySelector('[data-stream-row-id]') as HTMLButtonElement;
    expect(fixture.componentInstance.stateIcon(state)).toBe(icon);
    expect(row.querySelector('lucide-icon svg')).not.toBeNull();
    expect(row.querySelector('.state-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelector('.state-word')?.textContent).toBe(state);
    expect(row.textContent).toContain('Openai');
    expect(row.querySelector('.provider-monogram')?.textContent).toBe('O');
  });

  it('keeps one roving stop, activates selected rows again, and emits Escape', () => {
    const fixture = setup([stream('first'), stream('second')]);
    const activate = jest.fn();
    const escape = jest.fn();
    const measure = jest.fn();
    fixture.componentInstance.activate.subscribe(activate);
    fixture.componentInstance.escape.subscribe(escape);
    fixture.componentInstance.measureRequested.subscribe(measure);
    fixture.componentRef.setInput('selectedId', 'second');
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-stream-row-id]') as NodeListOf<HTMLButtonElement>;
    expect(rows[0].getAttribute('tabindex')).toBe('0');
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].getAttribute('tabindex')).toBe('0');
    expect(rows[0].getAttribute('tabindex')).toBe('-1');
    expect(rows[1].getAttribute('aria-pressed')).toBe('true');
    rows[1].click();
    rows[1].click();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenLastCalledWith('second');
    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(escape).toHaveBeenCalledWith('second');
    expect(measure).toHaveBeenCalled();
  });

  it('shows independent tribunal arcs and a pinned slot after its row', () => {
    const phase = (id: string, state: CommandWorkState) => stream(id, state, 'phase');
    const fixture = setup([
      stream('tribunal-a', 'running', 'tribunal', [phase('a1', 'completed'), phase('a2', 'running')]),
      stream('tribunal-b', 'running', 'tribunal', [phase('b1', 'completed'), phase('b2', 'completed'), phase('b3', 'completed')]),
    ]);
    fixture.componentRef.setInput('pinnedId', 'tribunal-a');
    fixture.componentRef.setInput('inlineSlotHeight', 180);
    fixture.componentRef.setInput('activeId', 'tribunal-a');
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-stream-row-id]') as NodeListOf<HTMLButtonElement>;
    expect(rows[0].querySelector('.tribunal-progress')?.textContent?.trim()).toBe('1/2');
    expect(rows[1].querySelector('.tribunal-progress')?.textContent?.trim()).toBe('3/3');
    expect(rows[0].getAttribute('aria-label')).toContain('1 of 2 phases complete');
    expect(rows[1].getAttribute('aria-label')).toContain('3 of 3 phases complete');
    expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    expect(rows[0].getAttribute('aria-describedby')).toBeNull();
    const slot = fixture.nativeElement.querySelector('[data-plate-slot-id="tribunal-a"]') as HTMLElement;
    expect(slot.previousElementSibling).toBe(rows[0]);
    expect(slot.style.height).toBe('180px');
  });

  it('describes preview, freezes the loader for reduced motion and keeps overflow outside the viewport', () => {
    const fixture = setup([stream('running', 'running')]);
    fixture.componentRef.setInput('activeId', 'running');
    fixture.componentRef.setInput('reducedMotion', true);
    fixture.componentRef.setInput('overflow', { completed: 2, other: 3 });
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[data-stream-row-id]') as HTMLButtonElement;
    expect(row.getAttribute('aria-describedby')).toBe('command-plate');
    expect(row.querySelector('.state-icon')?.classList.contains('is-static')).toBe(true);
    const viewport = fixture.nativeElement.querySelector('[data-stream-viewport]') as HTMLElement;
    expect(viewport.querySelectorAll('[data-stream-row-id]')).toHaveLength(1);
    const link = fixture.nativeElement.querySelector('.view-all') as HTMLButtonElement;
    expect(viewport.contains(link)).toBe(false);
    expect(link.textContent).toContain('+2 completed');
    expect(link.textContent).toContain('+3 more');
  });

  it('shows a tribunal with no phases and only shows age for a timestamp', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(3_600_000);
    try {
      const fixture = setup([
        stream('empty-tribunal', 'queued', 'tribunal'),
        { ...stream('timed'), updatedAt: 3_480_000 },
      ]);
      const rows = fixture.nativeElement.querySelectorAll('[data-stream-row-id]') as NodeListOf<HTMLButtonElement>;
      expect(rows[0].querySelector('.tribunal-progress')?.textContent?.trim()).toBe('0/0');
      expect(rows[0].querySelector('.stream-age')).toBeNull();
      expect(rows[1].querySelector('.stream-age')?.textContent).toBe('2m ago');
    } finally {
      now.mockRestore();
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { CompactRailCardComponent } from './compact-rail-card.component';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactLaneSummary,
  type CompactPermissionCallout,
} from './compact-lane.types';
import type { CompactSessionSummary } from './compact-session-summary';

const summary = (text = 'Working now'): CompactSessionSummary => ({
  status: {
    text: 'Running',
    icon: '●',
    tone: 'live',
    sessionColor: '#123456',
    workspaceLabel: 'work',
  },
  marks: [],
  content: {
    kind: 'prose',
    text,
    format: 'plain',
    additionalPromptCount: 0,
    actionable: false,
  },
  metrics: {
    model: 'sonnet',
    tokens: 42,
    cost: 0.01,
    agentCount: 0,
    compactionCount: 0,
  },
});
const lanes = (total: number): CompactLaneSummary => ({
  rows: Array.from({ length: Math.min(total, 3) }, (_, i) => ({
    id: `lane-${i}`,
    name: `Lane ${i}`,
    kind: 'cli' as const,
    status: 'running' as const,
    startedAt: 1,
    endedAt: null,
  })),
  moreCount: Math.max(0, total - 3),
  total,
  counts: { running: total, waiting: 0, error: 0, done: 0, stopped: 0 },
});
const permission = (requestId: string): CompactPermissionCallout => ({
  kind: 'permission',
  source: 'session',
  requestId,
  tabId: 'tab',
  text: 'Run command',
});

/** Hover may repaint, never resize: these properties cannot move layout. */
const PAINT_ONLY = ['background-color', 'border-color', 'box-shadow', 'color'];
// jest-preset-angular strips component styles, so read the inline CSS source.
const cssRules = () =>
  [
    ...readFileSync(
      join(__dirname, 'compact-rail-card.component.ts'),
      'utf8',
    ).matchAll(/([^{}]*)\{([^{}]*)\}/g),
  ].map(([, selector, body]) => ({
    selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    declarations: body
      .split(';')
      .map((part) => part.split(':').map((s) => s.trim()))
      .filter(([prop]) => prop),
  }));
const hoverRules = () =>
  cssRules().filter((rule) => rule.selector.includes(':hover'));

describe(CompactRailCardComponent.name, () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [CompactRailCardComponent] }),
  );

  function render() {
    const fixture = TestBed.createComponent(CompactRailCardComponent);
    fixture.componentRef.setInput('title', 'Session A');
    fixture.componentRef.setInput('summary', summary());
    fixture.detectChanges();
    return fixture;
  }
  const button = (root: HTMLElement, name: string) =>
    [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith(name),
    ) as HTMLButtonElement | undefined;

  it('uses the shared height for both densities', () => {
    const f = render();
    expect(f.nativeElement.style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.comfortable}px`,
    );
    f.componentRef.setInput('density', 'dense');
    f.detectChanges();
    expect(f.nativeElement.style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.dense}px`,
    );
  });

  it('shows three lane buttons and the comfortable overflow action', () => {
    const f = render();
    f.componentRef.setInput('lanes', lanes(4));
    f.detectChanges();
    expect(
      f.nativeElement.querySelectorAll('.rc-lane-rows button'),
    ).toHaveLength(4);
    const selected = jest.fn();
    const more = jest.fn();
    f.componentInstance.laneSelected.subscribe(selected);
    f.componentInstance.moreLanes.subscribe(more);
    button(f.nativeElement, 'Lane 0')?.click();
    button(f.nativeElement, '+1 more')?.click();
    expect(selected).toHaveBeenCalledWith('lane-0');
    expect(more).toHaveBeenCalledTimes(1);
  });

  it('places the comfortable overflow action on the 16px header above three 18px rows', () => {
    const f = render();
    f.componentRef.setInput('lanes', lanes(4));
    f.detectChanges();
    const header = f.nativeElement.querySelector(
      '.rc-lane-rows > .rc-line',
    ) as HTMLElement;
    const rows = f.nativeElement.querySelectorAll(
      '.rc-lane-buttons > button',
    ) as NodeListOf<HTMLElement>;
    expect(header.classList.contains('h-4')).toBe(true);
    expect(header.querySelector('button')?.textContent?.trim()).toBe('+1 more');
    expect(header.querySelector('button')?.classList.contains('rc-lane-overflow')).toBe(true);
    expect(rows).toHaveLength(3);
    expect([...rows].every((row) => row.classList.contains('h-[18px]'))).toBe(
      true,
    );
    expect(16 + rows.length * 18).toBe(70);
  });

  it('shows paint-only hover on the card, lane rows and actions without a geometry shift', () => {
    const f = render();
    f.componentRef.setInput('lanes', lanes(4));
    f.detectChanges();
    const rules = hoverRules();
    expect(rules.map((rule) => rule.selector)).toEqual([
      ':host(:hover)',
      '.rc-action:hover',
      '.rc-lane-row:hover',
    ]);
    for (const rule of rules) {
      for (const [prop] of rule.declarations) expect(PAINT_ONLY).toContain(prop);
    }
    const rows = [
      ...f.nativeElement.querySelectorAll('.rc-lane-buttons > button'),
    ] as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (row) =>
          row.classList.contains('rc-lane-row') &&
          row.classList.contains('h-[18px]'),
      ),
    ).toBe(true);
    expect(f.nativeElement.style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.comfortable}px`,
    );
  });

  it('keeps rc-lane-overflow as a 16px action that shares the action hover', () => {
    const f = render();
    f.componentRef.setInput('lanes', lanes(5));
    f.detectChanges();
    const overflow = button(f.nativeElement, '+2 more');
    expect(overflow?.classList.contains('rc-action')).toBe(true);
    expect(overflow?.classList.contains('rc-lane-overflow')).toBe(true);
    const sizing = cssRules().find(
      (rule) => rule.selector === '.rc-action.rc-lane-overflow',
    );
    expect(sizing?.declarations).toContainEqual(['height', '16px']);
    expect(sizing?.declarations).toContainEqual(['line-height', '16px']);
  });

  it('updates every inner tabindex with unchanged request data', () => {
    const f = render();
    f.componentRef.setInput('callout', permission('p1'));
    f.detectChanges();
    expect(button(f.nativeElement, 'Allow')?.tabIndex).toBe(-1);
    f.componentRef.setInput('innerTabbable', true);
    f.detectChanges();
    expect(button(f.nativeElement, 'Allow')?.tabIndex).toBe(0);
    f.componentRef.setInput('innerTabbable', false);
    f.detectChanges();
    expect(button(f.nativeElement, 'Allow')?.tabIndex).toBe(-1);
  });

  it('rebuilds replaced callouts and returns focus to selection', () => {
    const f = render();
    f.componentRef.setInput('callout', permission('p1'));
    f.detectChanges();
    const old = button(f.nativeElement, 'Allow') as HTMLButtonElement;
    old.focus();
    f.componentRef.setInput('callout', permission('p2'));
    f.detectChanges();
    expect(button(f.nativeElement, 'Allow')).not.toBe(old);
    expect(document.activeElement).toBe(
      f.nativeElement.querySelector('.rc-select'),
    );
  });

  it('emits the shown permission object', () => {
    const f = render();
    const p = permission('p1');
    f.componentRef.setInput('callout', p);
    f.detectChanges();
    const received = jest.fn();
    f.componentInstance.allow.subscribe(received);
    button(f.nativeElement, 'Allow')?.click();
    expect(received).toHaveBeenCalledWith(p);
  });

  it('holds text while updating a request', () => {
    const f = render();
    f.componentRef.setInput('holdText', true);
    f.detectChanges();
    f.componentRef.setInput('summary', summary('New now'));
    f.componentRef.setInput('callout', permission('p2'));
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Working now');
    expect(f.nativeElement.textContent).toContain('Run command');
    expect(f.nativeElement.textContent).not.toContain('New now');
  });

  it('shows an em dash and the unknown todo title', () => {
    const f = render();
    f.componentRef.setInput('todos', { kind: 'unknown' });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('—');
    expect(
      f.nativeElement.querySelector('[title]')?.getAttribute('title'),
    ).toBeTruthy();
    expect(
      f.nativeElement
        .querySelector('.rc-body > div:last-child')
        ?.getAttribute('title'),
    ).toContain('Todos unknown');
  });

  it.each([0, 1, 4])('dense mode handles %i lanes', (total) => {
    const f = render();
    f.componentRef.setInput('density', 'dense');
    f.componentRef.setInput('lanes', lanes(total));
    f.detectChanges();
    const more = jest.fn();
    f.componentInstance.moreLanes.subscribe(more);
    if (total === 0) {
      expect(f.nativeElement.textContent).toContain('Lanes none yet');
      expect(button(f.nativeElement, '+')).toBeUndefined();
    } else {
      const action = button(f.nativeElement, `+${total}`) as HTMLButtonElement;
      expect(action.getAttribute('aria-label')).toBe(
        `Open the ${total} lanes of Session A`,
      );
      action.click();
      expect(more).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['comfortable', 'dense'])(
    'answers a question in %s mode by click and Enter',
    (density) => {
      const f = render();
      f.componentRef.setInput('density', density);
      f.componentRef.setInput('callout', {
        kind: 'question',
        requestId: 'q1',
        text: 'Continue?',
      });
      f.detectChanges();
      const answer = jest.fn();
      f.componentInstance.answer.subscribe(answer);
      const action = button(f.nativeElement, 'Answer') as HTMLButtonElement;
      expect(action.tabIndex).toBe(-1);
      expect(action.getAttribute('aria-label')).toBe('Answer Continue?');
      action.click();
      f.componentRef.setInput('innerTabbable', true);
      f.detectChanges();
      action.focus();
      action.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      // Native keyboard activation is supplied by the browser; jsdom only dispatches the key event.
      action.click();
      expect(answer.mock.calls).toEqual([['q1'], ['q1']]);
    },
  );

  it('rebuilds a same-text question when its id changes', () => {
    const f = render();
    f.componentRef.setInput('callout', {
      kind: 'question',
      requestId: 'q1',
      text: 'Continue?',
    });
    f.detectChanges();
    const old = button(f.nativeElement, 'Answer') as HTMLButtonElement;
    old.focus();
    f.componentRef.setInput('callout', {
      kind: 'question',
      requestId: 'q2',
      text: 'Continue?',
    });
    f.detectChanges();
    const next = button(f.nativeElement, 'Answer') as HTMLButtonElement;
    expect(next).not.toBe(old);
    expect(document.activeElement).toBe(
      f.nativeElement.querySelector('.rc-select'),
    );
    const answer = jest.fn();
    f.componentInstance.answer.subscribe(answer);
    next.click();
    expect(answer).toHaveBeenCalledWith('q2');
  });

  it.each(['comfortable', 'dense'] as const)(
    'keeps %s height through content changes',
    (density) => {
      const f = render();
      f.componentRef.setInput('density', density);
      f.detectChanges();
      const height = f.nativeElement.style.height;
      f.componentRef.setInput('summary', summary('Changed'));
      f.detectChanges();
      f.componentRef.setInput('callout', permission('p1'));
      f.detectChanges();
      f.componentRef.setInput('holdText', true);
      f.detectChanges();
      expect(f.nativeElement.style.height).toBe(height);
      expect(height).toBe(`${COMPACT_RAIL_CARD_HEIGHT[density]}px`);
    },
  );
});

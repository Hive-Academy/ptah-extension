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
  kinds: { cli: total, subagent: 0, background: 0 },
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
    // The first rule's chunk also holds the decorator text up to the
    // styles backtick; keep only the selector after it.
    selector: selector
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[\s\S]*`/, '')
      .trim(),
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

  it('shows only known positive summary badges and preserves the diff', () => {
    const f = render();
    const value = summary();
    f.componentRef.setInput('summary', { ...value, metrics: { ...value.metrics, agentCount: 2 } });
    f.componentRef.setInput('lanes', lanes(1));
    f.componentRef.setInput('contextPercent', 35);
    f.componentRef.setInput('gitStats', { kind: 'known', additions: 35, deletions: 0, partial: false });
    f.detectChanges();
    const badges = () => [...(f.nativeElement as HTMLElement).querySelectorAll('.badge')].map(b => b.textContent?.trim());
    expect(badges()).toEqual(['2 agents', '1 CLI', '35% ctx']);
    expect(f.nativeElement.textContent).toContain('+35');
    expect(f.nativeElement.textContent).not.toContain('42 tokens');
    f.componentRef.setInput('summary', value);
    f.componentRef.setInput('lanes', lanes(0));
    f.componentRef.setInput('contextPercent', null);
    f.detectChanges();
    expect(badges()).toEqual([]);
    f.componentRef.setInput('contextPercent', 0);
    f.componentRef.setInput('lanes', lanes(4));
    f.detectChanges();
    // Three rows plus "+1 more": the badge still counts every CLI lane.
    expect(badges()).toEqual(['4 CLI']);
    f.componentRef.setInput('lanes', {
      ...lanes(6),
      kinds: { cli: 2, subagent: 4, background: 0 },
    });
    f.detectChanges();
    expect(badges()).toEqual(['2 CLI']);
  });

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

  it('marks only the focused card with a primary frame and tint that cannot shift layout', () => {
    const f = render();
    const host = f.nativeElement as HTMLElement;
    expect(host.classList.contains('rc-focused')).toBe(false);
    f.componentRef.setInput('focused', true);
    f.detectChanges();
    expect(host.classList.contains('rc-focused')).toBe(true);
    expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT.comfortable}px`);
    const selectors = cssRules().map((rule) => rule.selector);
    const focused = cssRules().find(
      (rule) => rule.selector === ':host(.rc-focused)',
    );
    // Paint only, theme tokens only (no hex), and after hover so it wins.
    expect(focused?.declarations.map(([prop]) => prop)).toEqual([
      'border-color',
      'box-shadow',
      'background-color',
    ]);
    for (const [, value] of focused?.declarations ?? []) {
      expect(value).toMatch(/var\(--(rc-focus-frame|p)\)/);
      expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
    expect(focused?.declarations).toContainEqual([
      'border-color',
      'var(--rc-focus-frame)',
    ]);
    expect(focused?.declarations).toContainEqual([
      'box-shadow',
      'inset 0 0 0 1px var(--rc-focus-frame)',
    ]);
    // F-A: the frame is primary, except in anubis-light where the bright teal
    // primary is 1.40:1 on the cream page; there it is the deep teal content ink.
    const frame = (selector: string) =>
      cssRules()
        .find((rule) => rule.selector === selector)
        ?.declarations.find(([prop]) => prop === '--rc-focus-frame')?.[1];
    expect(frame(':host')).toBe('oklch(var(--p))');
    expect(frame(":host-context([data-theme='anubis-light'])")).toBe(
      'oklch(var(--pc))',
    );
    expect(selectors.indexOf(':host(.rc-focused)')).toBeGreaterThan(
      selectors.indexOf(':host(:hover)'),
    );
    f.componentRef.setInput('focused', false);
    f.detectChanges();
    expect(host.classList.contains('rc-focused')).toBe(false);
  });

  it('names only the focused card "in focus" on its select button', () => {
    const f = render();
    f.componentRef.setInput('state', 'done');
    f.detectChanges();
    const select = f.nativeElement.querySelector('.rc-select') as HTMLButtonElement;
    expect(select.getAttribute('aria-label')).toBe('Session A, done');
    expect(select.getAttribute('aria-current')).toBeNull();
    f.componentRef.setInput('focused', true);
    f.detectChanges();
    expect(select.getAttribute('aria-label')).toBe('Session A, done, in focus');
    expect(select.getAttribute('aria-current')).toBe('true');
    f.componentRef.setInput('focused', false);
    f.detectChanges();
    expect(select.getAttribute('aria-label')).toBe('Session A, done');
  });

  it('draws the keyboard ring of the invisible select button on the host', () => {
    const rules = cssRules();
    // opacity 0 on .rc-select hides any outline drawn on the button itself.
    expect(
      rules.some(
        (rule) =>
          /\.rc-select:focus-visible/.test(rule.selector) &&
          !rule.selector.startsWith(':host(:has('),
      ),
    ).toBe(false);
    const ring = rules.find(
      (rule) => rule.selector === ':host(:has(.rc-select:focus-visible))',
    );
    expect(ring?.declarations).toEqual([
      ['outline', '2px solid var(--rail-state-ink)'],
      ['outline-offset', '-4px'],
    ]);
  });

  it('rounds the context percentage it shows', () => {
    const f = render();
    f.componentRef.setInput('contextPercent', 37.41666);
    f.detectChanges();
    const text = (f.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('37% ctx');
    expect(text).not.toContain('37.41666');
  });

  it('F-B: the 10px state pill lifts its state ink toward base-content for 4.5:1 text', () => {
    const f = render();
    const pill = f.nativeElement.querySelector('.rc-pill') as HTMLElement;
    expect(pill.classList.contains('text-[10px]')).toBe(true);
    const rule = cssRules().find((r) => r.selector === '.rc-pill');
    expect(rule?.declarations).toEqual([
      [
        'color',
        'color-mix(in oklab, var(--rail-state-ink) 70%, oklch(var(--bc)))',
      ],
    ]);
  });

  it('reserves the top-right corner on the title line only when asked, at both densities', () => {
    const f = render();
    const host = f.nativeElement as HTMLElement;
    const title = () => host.querySelector('.rc-body > .rc-title') as HTMLElement;
    expect(title()).toBe(host.querySelector('.rc-body > .rc-line'));
    expect(title().querySelector('.rc-pill')).not.toBeNull();
    expect(host.classList.contains('rc-corner-reserved')).toBe(false);
    for (const density of ['comfortable', 'dense'] as const) {
      f.componentRef.setInput('reserveActionCorner', true);
      f.componentRef.setInput('density', density);
      f.detectChanges();
      expect(host.classList.contains('rc-corner-reserved')).toBe(true);
      expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT[density]}px`);
      // The reserve is padding on the title line, never on the select button.
      expect(title().closest('.rc-select')).toBeNull();
    }
    const reserve = cssRules().find(
      (rule) => rule.selector === ':host(.rc-corner-reserved) .rc-title',
    );
    expect(reserve?.declarations).toEqual([['padding-right', '22px']]);
    f.componentRef.setInput('reserveActionCorner', false);
    f.detectChanges();
    expect(host.classList.contains('rc-corner-reserved')).toBe(false);
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

  it('shows a rename at once while a text selection holds the card', () => {
    const f = render();
    const host = f.nativeElement as HTMLElement;
    document.body.appendChild(host);
    try {
      // Select the card's "Now" text, as a user does before renaming.
      const nowText = host.querySelector('.rc-line:not(.rc-title) [title]')
        ?.firstChild as Text;
      const range = document.createRange();
      range.setStart(nowText, 0);
      range.setEnd(nowText, 7);
      const selection = document.getSelection() as Selection;
      selection.removeAllRanges();
      selection.addRange(range);
      f.componentRef.setInput('holdText', true);
      f.detectChanges();

      f.componentRef.setInput('title', 'Renamed session');
      f.componentRef.setInput('summary', summary('New now'));
      f.detectChanges();

      expect(selection.isCollapsed).toBe(false);
      expect(selection.toString()).toBe('Working');
      const title = host.querySelector('.rc-title .font-semibold');
      expect(title?.textContent?.trim()).toBe('Renamed session');
      expect(title?.getAttribute('title')).toBe('Renamed session');
      expect(host.textContent).not.toContain('Session A');
      // The summary stays held under the selection.
      expect(host.textContent).toContain('Working now');
      expect(host.textContent).not.toContain('New now');
    } finally {
      document.getSelection()?.removeAllRanges();
      host.remove();
    }
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

  it('shows no linked task by default', () => {
    const f = render();
    expect(
      f.nativeElement.querySelector('[data-testid="rail-linked-task"]'),
    ).toBeNull();
  });

  it('shows the linked task id in the footer and names it for the select button', () => {
    const f = render();
    f.componentRef.setInput('linkedTask', {
      taskId: 'TASK_2026_854_52e8',
      missing: false,
    });
    f.detectChanges();
    const task = f.nativeElement.querySelector(
      '[data-testid="rail-linked-task"]',
    ) as HTMLElement;
    expect(task.textContent?.trim()).toBe('TASK_2026_854_52e8');
    expect(task.getAttribute('title')).toBe('Linked task TASK_2026_854_52e8');
    expect(task.classList).not.toContain('line-through');
    expect(f.componentInstance.selectName()).toContain(
      ', task TASK_2026_854_52e8',
    );
  });

  it('strikes through a linked task whose folder is missing', () => {
    const f = render();
    f.componentRef.setInput('linkedTask', {
      taskId: 'TASK_2026_001',
      missing: true,
    });
    f.detectChanges();
    const task = f.nativeElement.querySelector(
      '[data-testid="rail-linked-task"]',
    ) as HTMLElement;
    expect(task.classList).toContain('line-through');
    expect(task.getAttribute('title')).toBe(
      'Linked task TASK_2026_001 (folder missing)',
    );
  });

  it.each([0, 1, 4])('dense mode handles %i lanes', (total) => {
    const f = render();
    f.componentRef.setInput('density', 'dense');
    f.componentRef.setInput('lanes', lanes(total));
    f.detectChanges();
    const more = jest.fn();
    f.componentInstance.moreLanes.subscribe(more);
    if (total === 0) {
      expect(f.nativeElement.textContent).not.toContain('Lanes none yet');
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

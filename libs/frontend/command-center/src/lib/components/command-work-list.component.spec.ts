import { TestBed } from '@angular/core/testing';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandWorkListComponent } from './command-work-list.component';

const nodes: CommandWorkNode[] = Array.from({ length: 30 }, (_, index) => ({
  id: `node:${index}`,
  kind: index ? 'child' : 'root',
  parentId: index ? 'node:0' : null,
  label: `Work ${index}`,
  providerId: index === 29 ? 'unlisted-provider' : 'codex',
  state: index === 29 ? 'unknown' : 'queued',
}));

describe('CommandWorkListComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [CommandWorkListComponent] });
    const fixture = TestBed.createComponent(CommandWorkListComponent);
    fixture.componentRef.setInput('projection', { nodes, edges: [] });
    fixture.componentRef.setInput('now', Date.now());
    fixture.detectChanges();
    return fixture;
  }

  it('lists 29 delegated nodes with identity, compact state and an end icon', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(29);
    expect(fixture.nativeElement.textContent).toContain('Delegated work · 29');
    expect(fixture.nativeElement.textContent).not.toContain('Work 0');
    expect(fixture.nativeElement.textContent).toContain('Work 29');
    expect(fixture.nativeElement.textContent).toMatch(
      /Unlisted Provider\s*·\s*unknown/,
    );
    expect(fixture.nativeElement.textContent).not.toContain('Provider:');
    expect(
      fixture.nativeElement.querySelectorAll(
        'li button [data-test="work-state-icon"]',
      ),
    ).toHaveLength(29);
  });

  it('shows clock-driven freshness and scene overflow counts with a visible state edge', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], updatedAt: 820_000 }],
      edges: [],
    });
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.componentRef.setInput('overflowCompleted', 2);
    fixture.componentRef.setInput('overflowOther', 3);
    fixture.componentRef.setInput('selectedId', nodes[1].id);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector(
      'li button',
    ) as HTMLButtonElement;
    expect(row.textContent).toContain('Updated 3m ago');
    expect(row.classList.contains('border-l-state-idle')).toBe(true);
    expect(row.classList.contains('ring-warning')).toBe(true);
    expect(row.classList.contains('outline')).toBe(true);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(fixture.nativeElement.textContent).toMatch(
      /Off canvas:\s*2 completed\s*·\s*3 other/,
    );
    fixture.componentRef.setInput('now', 1_060_000);
    fixture.detectChanges();
    expect(row.textContent).toContain('Updated 4m ago');
  });

  it('omits invalid freshness and zero overflow', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], updatedAt: Number.NaN }],
      edges: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Updated');
    expect(fixture.nativeElement.textContent).not.toContain('completed ·');
  });

  it('selects using arrow keys and Enter', () => {
    const fixture = setup();
    const selection = jest.fn();
    fixture.componentInstance.selection.subscribe(selection);
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].focus();
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(selection).toHaveBeenCalledWith('node:2');
  });

  it('focuses a delegated row from its full projection index', () => {
    const fixture = setup();
    fixture.componentInstance.focusRow(2);
    const buttons = fixture.nativeElement.querySelectorAll(
      'ul button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].className).toContain(
      'focus-visible:outline-base-content',
    );
  });

  it('announces a changed state through the one polite live region', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: nodes.map((node) =>
        node.id === 'node:1' ? { ...node, state: 'running' as const } : node,
      ),
      edges: [],
    });
    fixture.detectChanges();
    const live = fixture.nativeElement.querySelectorAll(
      '[aria-live="polite"]',
    ) as NodeListOf<HTMLElement>;
    expect(live.length).toBe(1);
    expect(live[0].textContent).toContain('Work 1: running');
  });

  it('renders an unknown provider with a monogram tile', () => {
    const fixture = setup();
    expect(fixture.componentInstance.knownProvider('pi')).toBe(true);
    expect(fixture.componentInstance.knownProvider('ptah-cli')).toBe(true);
    expect(
      fixture.nativeElement.querySelectorAll('ptah-monogram-tile').length,
    ).toBe(1);
  });

  it('keeps a row keyboard reachable after the projection shrinks', () => {
    const fixture = setup();
    fixture.componentInstance.activeId.set('node:29');
    fixture.componentRef.setInput('projection', {
      nodes: nodes.slice(0, 3),
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('tabindex')).toBe('0');
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    fixture.detectChanges();
    expect(buttons[1].getAttribute('tabindex')).toBe('0');
  });

  it('keeps the active node as the tab stop when projection rows reorder', () => {
    const fixture = setup();
    fixture.componentInstance.focusRow(2);
    fixture.detectChanges();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], nodes[2], nodes[1], ...nodes.slice(3)],
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].textContent).toContain('Work 2');
    expect(buttons[0].getAttribute('tabindex')).toBe('0');
    expect(buttons[1].getAttribute('tabindex')).toBe('-1');
    fixture.componentInstance.focusRow(2);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('shows the prototype empty state for a root-only projection', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: nodes.slice(0, 1),
      edges: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Delegated work · 0');
    expect(fixture.nativeElement.textContent).toContain(
      'No delegated work yet.',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'review the release plan',
    );
  });

  it('omits an unknown provider from secondary text', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], providerId: null, state: 'completed' }],
      edges: [],
    });
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector(
      'li button',
    ) as HTMLButtonElement;
    expect(row.textContent).toContain('completed');
    expect(row.querySelector('[data-test="work-state-icon"]')).not.toBeNull();
    expect(row.textContent).not.toContain('Unknown');
  });

  it('shows each state word with its own icon', () => {
    const fixture = setup();
    const states = [
      'completed',
      'failed',
      'cancelled',
      'awaiting input',
      'running',
      'starting',
      'queued',
      'idle',
      'unknown',
    ] as const;
    const icons = new Map<string, string>();
    for (const state of states) {
      fixture.componentRef.setInput('projection', {
        nodes: [nodes[0], { ...nodes[1], state }],
        edges: [],
      });
      fixture.detectChanges();
      const row = fixture.nativeElement.querySelector(
        'li button',
      ) as HTMLButtonElement;
      expect(row.textContent).toContain(state);
      const edge =
        state === 'completed'
          ? 'done'
          : state === 'failed'
            ? 'err'
            : state === 'awaiting input'
              ? 'need'
              : state === 'running' || state === 'starting'
                ? 'run'
                : 'idle';
      expect(row.classList.contains(`border-l-state-${edge}`)).toBe(true);
      const icon = row.querySelector(
        '[data-test="work-state-icon"] svg',
      ) as SVGElement;
      expect(icon).not.toBeNull();
      expect(
        icon.getAttribute('aria-hidden') ??
          icon.parentElement?.getAttribute('aria-hidden'),
      ).toBe('true');
      icons.set(state, icon.innerHTML);
    }
    expect(
      new Set(
        [
          'completed',
          'failed',
          'cancelled',
          'awaiting input',
          'running',
          'queued',
        ].map((state) => icons.get(state)),
      ).size,
    ).toBe(6);
    expect(icons.get('starting')).toBe(icons.get('running'));
    expect(icons.get('idle')).toBe(icons.get('queued'));
    expect(icons.get('unknown')).toBe(icons.get('queued'));
  });

  it('stops the running icon spin in reduced motion', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], state: 'running' }],
      edges: [],
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector(
      '[data-test="work-state-icon"]',
    ) as HTMLElement;
    expect(icon.classList.contains('animate-spin')).toBe(true);
    fixture.componentRef.setInput('reducedMotion', true);
    fixture.detectChanges();
    expect(icon.classList.contains('animate-spin')).toBe(false);
  });

  it('nests child-owned work and grandchildren while preserving projection-index focus', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [
        nodes[0],
        { ...nodes[1], id: 'child:one', kind: 'child', parentId: nodes[0].id },
        { ...nodes[2], id: 'child:two', kind: 'child', parentId: nodes[0].id },
        { ...nodes[3], id: 'lane:one', kind: 'agent', parentId: 'child:one' },
        { ...nodes[4], id: 'grandchild', kind: 'agent', parentId: 'lane:one' },
      ],
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    expect(Array.from(buttons, (button) => button.textContent?.trim())).toEqual([
      expect.stringContaining('Work 1'),
      expect.stringContaining('Work 3'),
      expect.stringContaining('Work 4'),
      expect.stringContaining('Work 2'),
    ]);
    expect(buttons[0].style.paddingInlineStart).toBe('8px');
    expect(buttons[1].style.paddingInlineStart).toBe('24px');
    expect(buttons[2].style.paddingInlineStart).toBe('40px');
    fixture.componentInstance.focusRow(2);
    expect(document.activeElement).toBe(buttons[3]);
  });

  it('promotes an orphaned node to a top-level row', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], parentId: 'missing-parent' }],
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].style.paddingInlineStart).toBe('8px');
  });

  it('renders both sides of a mutual parent cycle exactly once', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [
        nodes[0],
        { ...nodes[1], parentId: nodes[2].id },
        { ...nodes[2], parentId: nodes[1].id },
      ],
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(2);
    expect(Array.from(buttons, (button) => button.textContent?.trim())).toEqual([
      expect.stringContaining('Work 1'),
      expect.stringContaining('Work 2'),
    ]);
  });

  it('caps a deep descendant chain at three indentation levels', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], ...nodes.slice(1, 6).map((node, index) => ({
        ...node,
        parentId: index === 0 ? nodes[0].id : nodes[index].id,
      }))],
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    expect(Array.from(buttons, (button) => button.style.paddingInlineStart)).toEqual([
      '8px', '24px', '40px', '56px', '56px',
    ]);
  });

  it('shows the child kind glyph and full-opacity unknown child text', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0], { ...nodes[1], kind: 'child', label: 'Child session', providerId: null, state: 'unknown' }],
      edges: [],
    });
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
    expect(row.querySelector('[data-test="child-kind-icon"] svg')).not.toBeNull();
    expect(row.textContent).toContain('Child session');
    expect(row.textContent).toContain('unknown');
    expect(row.className).not.toContain('opacity-');
  });

  it('wraps the flat keyboard index in both directions', () => {
    const fixture = setup();
    const buttons = fixture.nativeElement.querySelectorAll('ul button') as NodeListOf<HTMLButtonElement>;
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(buttons[28]);
    buttons[28].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('measures clipping when rows change but not on clock-only renders', () => {
    const fixture = setup();
    const list = fixture.nativeElement.querySelector('ul') as HTMLUListElement;
    const scrollHeight = jest.fn(() => 200);
    const clientHeight = jest.fn(() => 100);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: scrollHeight });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: clientHeight });
    fixture.componentRef.setInput('projection', {
      nodes: nodes.slice(0, 3),
      edges: [],
    });
    fixture.detectChanges();
    expect(scrollHeight).toHaveBeenCalled();
    expect(clientHeight).toHaveBeenCalled();
    scrollHeight.mockClear();
    clientHeight.mockClear();
    fixture.componentRef.setInput('now', Date.now() + 60_000);
    fixture.detectChanges();
    expect(scrollHeight).not.toHaveBeenCalled();
    expect(clientHeight).not.toHaveBeenCalled();
  });

  it('observes one scroll container and shows the cue only while clipped', () => {
    const original = globalThis.ResizeObserver;
    const observe = jest.fn();
    const disconnect = jest.fn();
    class FakeResizeObserver implements ResizeObserver {
      public constructor(_callback: ResizeObserverCallback) { /* one container callback */ }
      public observe = observe;
      public unobserve = jest.fn();
      public disconnect = disconnect;
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    try {
      const fixture = setup();
      const list = fixture.nativeElement.querySelector('ul') as HTMLUListElement;
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(list);
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 200 });
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
      fixture.componentInstance.updateClipping();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-test="work-list-scroll-cue"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-test="work-list-fade"]')).not.toBeNull();
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
      fixture.componentInstance.updateClipping();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-test="work-list-scroll-cue"]')).toBeNull();
      fixture.destroy();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

import { TestBed } from '@angular/core/testing';
import { FloatingUIService } from '@ptah-extension/ui';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandCenterStore } from '../model/command-center.store';
import {
  COMMAND_OVERLAY_CLOSE_DELAY_MS,
  COMMAND_OVERLAY_OPEN_DELAY_MS,
  CommandOverlayComponent,
} from './command-overlay.component';

const nodes: CommandWorkNode[] = [
  {
    id: 'a',
    kind: 'root',
    parentId: null,
    label: 'Alpha',
    providerId: 'codex',
    state: 'running',
  },
  {
    id: 'b',
    kind: 'child',
    parentId: 'a',
    label: 'Beta',
    providerId: 'unknown',
    state: 'queued',
  },
];

describe('CommandOverlayComponent', () => {
  const position = jest.fn().mockResolvedValue(undefined);
  const cleanup = jest.fn();

  function setup() {
    TestBed.configureTestingModule({
      imports: [CommandOverlayComponent],
      providers: [CommandCenterStore],
    });
    TestBed.overrideComponent(CommandOverlayComponent, {
      set: {
        providers: [
          { provide: FloatingUIService, useValue: { position, cleanup } },
        ],
      },
    });
    const fixture = TestBed.createComponent(CommandOverlayComponent);
    TestBed.inject(CommandCenterStore).setProjection('a', nodes, []);
    fixture.componentRef.setInput('projection', { nodes, edges: [] });
    fixture.componentRef.setInput('now', Date.now());
    fixture.detectChanges();
    const labels = fixture.nativeElement.querySelectorAll(
      '[data-node-id]',
    ) as NodeListOf<HTMLButtonElement>;
    return { fixture, labels, component: fixture.componentInstance };
  }

  function advance(ms: number): void {
    jest.advanceTimersByTime(ms);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    position.mockClear();
    cleanup.mockClear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('hides plates without a placed scene label, including a previously placed plate', () => {
    const { fixture, labels } = setup();
    fixture.componentRef.setInput('visibleLabelIds', ['a', 'b']);
    fixture.detectChanges();
    expect(labels[1].style.visibility).toBe('visible');
    fixture.componentRef.setInput('visibleLabelIds', ['a']);
    fixture.detectChanges();
    expect(labels[0].style.visibility).toBe('visible');
    expect(labels[1].style.visibility).toBe('hidden');
  });

  it('shows a semantic context ring on the root plate only when verified', () => {
    const { fixture, labels } = setup();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-context-ring'),
    ).toHaveLength(0);
    fixture.componentRef.setInput('rootContextPercent', 69);
    fixture.componentRef.setInput('rootContextTone', 'normal');
    fixture.detectChanges();
    expect(
      labels[0].querySelector('ptah-context-ring svg')?.getAttribute('width'),
    ).toBe('28');
    expect(
      (labels[0].querySelector('ptah-context-ring svg') as SVGElement).style
        .color,
    ).toBe('var(--state-ink-done)');
    expect(labels[1].querySelector('ptah-context-ring')).toBeNull();
    fixture.componentRef.setInput('rootContextPercent', 70);
    fixture.componentRef.setInput('rootContextTone', 'warning');
    fixture.detectChanges();
    expect(
      (labels[0].querySelector('ptah-context-ring svg') as SVGElement).style
        .color,
    ).toBe('var(--state-ink-need)');
    fixture.componentRef.setInput('rootContextPercent', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ptah-context-ring')).toBeNull();
  });

  it('keeps state edges and selection visible and uses the shared detail body', () => {
    const { fixture, component, labels } = setup();
    expect(labels[0].classList.contains('border-l-state-run')).toBe(true);
    expect(labels[1].classList.contains('border-l-state-idle')).toBe(true);
    fixture.componentRef.setInput('selectedId', 'a');
    fixture.componentRef.setInput('projection', {
      nodes: [
        { ...nodes[0], task: '<b>Review</b>\nLater', updatedAt: 820_000 },
        { ...nodes[1], kind: 'phase', parentId: 'a', state: 'completed' },
      ],
      edges: [],
    });
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.detectChanges();
    expect(labels[0].classList.contains('ring-warning')).toBe(true);
    expect(labels[0].classList.contains('outline')).toBe(true);
    component.pin('a');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(
      '#command-node-card',
    ) as HTMLElement;
    expect(card.querySelector('ptah-command-node-detail')).not.toBeNull();
    expect(card.textContent).toContain('<b>Review</b>');
    expect(card.querySelector('b')).toBeNull();
    expect(card.textContent).toContain('Phase 1 / 1');
    expect(card.textContent).toContain('Updated 3m ago');
    expect(labels[0].getAttribute('aria-controls')).toBe('command-node-card');
  });

  it('unpins a hidden plate and requests focus on its work-list row', () => {
    const { fixture, component, labels } = setup();
    const focus = jest.fn();
    component.focusWorkListRow.subscribe(focus);
    fixture.componentRef.setInput('visibleLabelIds', ['a', 'b']);
    fixture.detectChanges();
    component.pin('b');
    fixture.detectChanges();
    // The plate held focus (keyboard pin), so the relayout hands it over.
    labels[1].focus();
    fixture.componentRef.setInput('visibleLabelIds', ['a']);
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith('b');
  });

  it('unpins a hidden plate without stealing focus from a control outside the overlay', () => {
    const { fixture, component } = setup();
    const focus = jest.fn();
    component.focusWorkListRow.subscribe(focus);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    try {
      outside.focus();
      fixture.componentRef.setInput('visibleLabelIds', ['a', 'b']);
      fixture.detectChanges();
      component.pin('b');
      fixture.detectChanges();
      fixture.componentRef.setInput('visibleLabelIds', ['a']);
      fixture.detectChanges();
      expect(component.pinnedNodeId()).toBeNull();
      expect(focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('keeps a pin whose plate was never laid out', () => {
    const { fixture, component } = setup();
    const focus = jest.fn();
    component.focusWorkListRow.subscribe(focus);
    fixture.componentRef.setInput('visibleLabelIds', ['a']);
    fixture.detectChanges();
    component.pin('b');
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBe('b');
    expect(focus).not.toHaveBeenCalled();
  });

  it('uses the base-content focus ring on scene labels', () => {
    const { labels } = setup();
    expect(labels[0].className).toContain('focus-visible:outline-base-content');
  });

  it('opens at 150 ms and cancels an early leave', () => {
    const { component, fixture } = setup();
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS - 1);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#command-node-card'),
    ).toBeNull();
    advance(1);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#command-node-card'),
    ).not.toBeNull();
    component.onLabelEnter('b');
    component.onLabelLeave('b');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(component.activeNodeId()).toBe('a');
  });

  it('keeps a dense moved or hidden label open while the scene hover stays on its node', () => {
    const { component, fixture, labels } = setup();
    fixture.componentRef.setInput('hoveredNodeId', 'a');
    fixture.detectChanges();
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('#command-node-card');
    labels[0].style.transform = 'translate3d(200px,20px,0)';
    labels[0].style.display = 'none';
    component.onLabelLeave('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS + 1);
    fixture.detectChanges();
    expect(component.activeNodeId()).toBe('a');
    expect(fixture.nativeElement.querySelector('#command-node-card')).toBe(
      card,
    );
  });

  it('closes after 200 ms and cancels closing on card, trigger, or bridge entry', () => {
    const { component, fixture } = setup();
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    component.onLabelLeave('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS - 1);
    expect(component.activeNodeId()).toBe('a');
    component.onCardEnter();
    advance(1);
    component.onCardLeave();
    component.onBridgeEnter();
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS);
    expect(component.activeNodeId()).toBe('a');
    component.onBridgeLeave();
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS);
    expect(component.activeNodeId()).toBe('a');
    component.onLabelLeave('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS);
    expect(component.activeNodeId()).toBeNull();
  });

  it('pins by click and Enter, survives hover leave, and unpins on close, Escape, selection, and destroy', () => {
    const { component, fixture, labels } = setup();
    labels[0].click();
    fixture.detectChanges();
    component.onLabelLeave('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS + 1);
    expect(component.pinnedNodeId()).toBe('a');
    fixture.nativeElement
      .querySelector('[aria-label="Close node details"]')
      .click();
    fixture.detectChanges();
    labels[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();
    const close = fixture.nativeElement.querySelector(
      '[aria-label="Close node details"]',
    ) as HTMLButtonElement;
    close.focus();
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBeNull();
    expect(document.activeElement).toBe(labels[0]);
    component.pin('a');
    TestBed.inject(CommandCenterStore).select('b');
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBeNull();
    component.pin('b');
    fixture.destroy();
    expect(cleanup).toHaveBeenCalled();
  });

  it('selects from a plate by click, Enter and Space through the page store', () => {
    const { fixture, labels } = setup();
    const store = TestBed.inject(CommandCenterStore);
    labels[0].click();
    expect(store.selectedId()).toBe('a');
    labels[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(store.selectedId()).toBe('b');
    labels[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    );
    expect(store.selectedId()).toBe('a');
    fixture.componentRef.setInput('selectedId', 'a');
    fixture.detectChanges();
    expect(labels[0].getAttribute('aria-pressed')).toBe('true');
    expect(labels[0].classList.contains('border-warning')).toBe(true);
  });

  it('shows compact provider and state without an unknown placeholder', () => {
    const { component, fixture, labels } = setup();
    expect(labels[0].textContent).toMatch(/Codex\s*·\s*running/);
    expect(labels[1].textContent).toContain('queued');
    expect(labels[1].textContent).not.toContain('Unknown');
    component.pin('b');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(
      '#command-node-card',
    ) as HTMLElement;
    expect(card.textContent).not.toContain('Provider: Unknown');
  });

  it('uses one card, replaces its node, and exposes fallback focus for a hidden trigger', () => {
    const { component, fixture, labels } = setup();
    const fallback = jest.fn();
    component.focusWorkListRow.subscribe(fallback);
    component.pin('a');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('#command-node-card');
    component.pin('b');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('#command-node-card'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('#command-node-card')).toBe(
      card,
    );
    expect(card.textContent).toContain('Beta');
    labels[1].style.display = 'none';
    (card.querySelector('button') as HTMLButtonElement).focus();
    component.closePinned();
    expect(fallback).toHaveBeenCalledWith('b');
  });

  it('passes edge middleware and coalesces two anchor moves into one frame', async () => {
    const { component, fixture, labels } = setup();
    const rect = jest
      .spyOn(labels[0], 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(1000, 800, 44, 44));
    component.pin('a');
    fixture.detectChanges();
    advance(16);
    expect(position).toHaveBeenCalledWith(labels[0], expect.any(HTMLElement), {
      offset: 8,
      flip: true,
      shift: true,
    });
    const count = position.mock.calls.length;
    rect.mockReturnValue(new DOMRect(980, 790, 44, 44));
    labels[0].style.transform = 'translate3d(300px,20px,0)';
    labels[0].style.transform = 'translate3d(320px,30px,0)';
    await jest.advanceTimersByTimeAsync(32);
    expect(position.mock.calls.length).toBe(count + 1);
  });

  it('moves the hover card away from a neighboring plate', async () => {
    const { component, fixture, labels } = setup();
    jest
      .spyOn(labels[0], 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 100, 44, 44));
    jest
      .spyOn(labels[1], 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 145, 150, 60));
    position.mockImplementationOnce(
      (_anchor: HTMLElement, card: HTMLElement) => {
        card.style.left = '100px';
        card.style.top = '145px';
        return Promise.resolve();
      },
    );
    component.pin('a');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(
      '#command-node-card',
    ) as HTMLElement;
    jest
      .spyOn(card, 'getBoundingClientRect')
      .mockImplementation(
        () =>
          new DOMRect(
            Number.parseFloat(card.style.left) || 100,
            Number.parseFloat(card.style.top) || 145,
            256,
            100,
          ),
      );
    await jest.advanceTimersByTimeAsync(16);
    expect(card.style.top).toBe('8px');
    expect(card.style.visibility).toBe('visible');
  });

  it('removes card motion classes when reduced motion is set', () => {
    const { component, fixture } = setup();
    fixture.componentRef.setInput('reducedMotion', true);
    component.pin('a');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(
      '#command-node-card',
    ) as HTMLElement;
    expect(card.classList.contains('transition-opacity')).toBe(false);
    expect(card.getAttribute('role')).toBe('region');
  });

  it('releases a pin when its node leaves the projection', () => {
    const { component, fixture } = setup();
    component.pin('b');
    fixture.detectChanges();
    fixture.componentRef.setInput('projection', {
      nodes: [nodes[0]],
      edges: [],
    });
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBeNull();
    expect(component.activeNodeId()).toBeNull();
    expect(cleanup).toHaveBeenCalled();
  });

  it('closes a hover preview with Escape until its hover ends', () => {
    const { component, fixture, labels } = setup();
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    expect(component.activeNodeId()).toBe('a');
    labels[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(component.activeNodeId()).toBeNull();
    component.onLabelLeave('a');
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(component.activeNodeId()).toBe('a');
  });

  it('cancels a pending hover preview when Escape is pressed during the open delay', () => {
    const { component, fixture, labels } = setup();
    component.onLabelEnter('a');
    labels[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    expect(component.activeNodeId()).toBeNull();
    component.onLabelLeave('a');
    component.onLabelEnter('a');
    advance(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(component.activeNodeId()).toBe('a');
  });

  it('keeps the provider mark outside the truncated label', () => {
    const { labels } = setup();
    const mark = labels[0].querySelector('ptah-provider-mark');
    const label = labels[0].querySelector('.truncate');
    expect(mark).not.toBeNull();
    expect(label?.textContent).toContain('Alpha');
    expect(label?.contains(mark)).toBe(false);
    expect(label?.classList.contains('min-w-0')).toBe(true);
  });

  it('links an expanded plate to its pinned card', () => {
    const { component, fixture, labels } = setup();
    component.pin('a');
    fixture.detectChanges();
    expect(labels[0].getAttribute('aria-expanded')).toBe('true');
    expect(labels[0].getAttribute('aria-controls')).toBe('command-node-card');
    expect(
      fixture.nativeElement.querySelector('#command-node-card'),
    ).not.toBeNull();
  });
});

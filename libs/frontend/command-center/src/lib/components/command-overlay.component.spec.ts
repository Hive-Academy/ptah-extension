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
});

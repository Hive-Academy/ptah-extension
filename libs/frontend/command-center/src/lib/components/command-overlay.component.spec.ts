import { TestBed } from '@angular/core/testing';
import { FloatingUIService } from '@ptah-extension/ui';
import type { CommandWorkNode } from '../model/command-center.store';
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
    TestBed.configureTestingModule({ imports: [CommandOverlayComponent] });
    TestBed.overrideComponent(CommandOverlayComponent, {
      set: {
        providers: [
          { provide: FloatingUIService, useValue: { position, cleanup } },
        ],
      },
    });
    const fixture = TestBed.createComponent(CommandOverlayComponent);
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
    const pin = jest.fn();
    const unpin = jest.fn();
    component.pinNode.subscribe(pin);
    component.unpinNode.subscribe(unpin);
    labels[0].click();
    fixture.detectChanges();
    expect(pin).toHaveBeenCalledWith('a');
    component.onLabelLeave('a');
    advance(COMMAND_OVERLAY_CLOSE_DELAY_MS + 1);
    expect(component.pinnedNodeId()).toBe('a');
    fixture.nativeElement
      .querySelector('[aria-label="Close node details"]')
      .click();
    fixture.detectChanges();
    expect(unpin).toHaveBeenCalledWith('a');
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
    fixture.componentRef.setInput('selectedId', 'b');
    fixture.detectChanges();
    expect(component.pinnedNodeId()).toBeNull();
    component.pin('b');
    fixture.destroy();
    expect(cleanup).toHaveBeenCalled();
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

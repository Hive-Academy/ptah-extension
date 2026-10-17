import { TestBed } from '@angular/core/testing';
import { CommandCenterStore, type CommandWorkNode } from '../model/command-center.store';
import type { SceneGeometry } from '../scene/connector-geometry';
import { COMMAND_OVERLAY_CLOSE_DELAY_MS, COMMAND_OVERLAY_OPEN_DELAY_MS, CommandOverlayComponent } from './command-overlay.component';

const nodes: CommandWorkNode[] = [
  { id: 'root', kind: 'root', parentId: null, label: 'Root', providerId: null, state: 'running' },
  { id: 'a', kind: 'child', parentId: 'root', label: 'Alpha', providerId: 'codex', state: 'running' },
  { id: 'b', kind: 'child', parentId: 'root', label: 'Beta', providerId: 'codex', state: 'queued' },
];
const geometry: SceneGeometry = {
  stage: { x: 0, y: 0, width: 1056, height: 620 },
  streamViewport: { x: 20, y: 80, width: 270, height: 500 },
  streamContent: { x: 27, y: 80, width: 241, height: 500 },
  rows: { a: { x: 27, y: 100, width: 241, height: 44 }, b: { x: 27, y: 150, width: 241, height: 44 } },
  dial: { x: 340, y: 120, width: 292, height: 292 },
  rootButton: { x: 380, y: 160, width: 212, height: 212 },
  cards: {
    inProgress: { x: 784, y: 80, width: 252, height: 100 },
    waiting: { x: 784, y: 190, width: 252, height: 100 },
    finished: { x: 784, y: 300, width: 252, height: 100 },
    other: { x: 784, y: 410, width: 252, height: 100 },
  },
};

describe('CommandOverlayComponent', () => {
  beforeEach(() => { jest.useFakeTimers(); TestBed.configureTestingModule({ imports: [CommandOverlayComponent], providers: [CommandCenterStore] }); });
  afterEach(() => { TestBed.resetTestingModule(); jest.useRealTimers(); });
  function setup() {
    const fixture = TestBed.createComponent(CommandOverlayComponent);
    TestBed.inject(CommandCenterStore).setProjection('root', nodes, []);
    fixture.componentRef.setInput('projection', { nodes, edges: [] });
    fixture.componentRef.setInput('geometry', geometry);
    fixture.detectChanges();
    return fixture;
  }

  it('opens a pointer-inert preview after 150ms and closes after 200ms', () => {
    const fixture = setup();
    const reservations: number[] = [];
    fixture.componentInstance.reservationChange.subscribe(value => reservations.push(value.reservedHeight + value.inlineSlotHeight));
    fixture.componentRef.setInput('hoveredNodeId', 'a');
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS - 1);
    expect(fixture.componentInstance.activeNodeId()).toBeNull();
    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeNodeId()).toBe('a');
    expect(reservations.every(value => value === 0)).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="tooltip"]')?.className).toContain('pointer-events-none');
    fixture.componentRef.setInput('hoveredNodeId', 'b');
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeNodeId()).toBe('b');
    fixture.componentRef.setInput('hoveredNodeId', null);
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_CLOSE_DELAY_MS);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeNodeId()).toBeNull();
    fixture.destroy();
  });

  it('reserves only a pin and releases it synchronously on close', () => {
    const fixture = setup();
    const stage = document.createElement('div');
    stage.dataset['sceneStage'] = '';
    fixture.nativeElement.parentElement?.appendChild(stage);
    const reservations: number[] = [];
    fixture.componentInstance.reservationChange.subscribe(value => reservations.push(value.inlineSlotHeight + value.reservedHeight));
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedNodeId()).toBe('a');
    expect(reservations.some(value => value > 0)).toBe(true);
    fixture.componentInstance.closePinned();
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    expect(reservations.at(-1)).toBe(0);
    fixture.destroy();
    stage.remove();
  });

  it('closes a pin on Escape and restores its trigger or rail focus', () => {
    const fixture = setup();
    const trigger = document.createElement('button');
    trigger.dataset['streamRowId'] = 'a';
    fixture.nativeElement.parentElement?.appendChild(trigger);
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    fixture.componentInstance.onEscape(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fixture.destroy();
    trigger.remove();
  });

  it('follows scroll geometry, hides a scrolled-out row, and releases the scroll listener on close', () => {
    const fixture = setup();
    const stage = document.createElement('div');
    stage.dataset['sceneStage'] = '';
    fixture.nativeElement.parentElement?.appendChild(stage);
    const requests: number[] = [];
    fixture.componentInstance.repositionRequested.subscribe(() => requests.push(1));
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('#command-plate') as HTMLElement;
    expect(card.style.visibility).toBe('visible');
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(requests).toHaveLength(2);
    fixture.componentRef.setInput('geometry', { ...geometry, rows: { ...geometry.rows, a: { ...geometry.rows.a, y: 20 } } });
    fixture.detectChanges();
    expect(card.style.visibility).toBe('hidden');
    fixture.componentRef.setInput('geometry', { ...geometry, rows: { ...geometry.rows, a: { ...geometry.rows.a, y: 180 } } });
    fixture.detectChanges();
    expect(card.style.visibility).toBe('visible');
    fixture.componentInstance.closePinned();
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(requests).toHaveLength(2);
    fixture.destroy();
    stage.remove();
  });

  it('releases a pin when its projected node disappears', () => {
    const fixture = setup();
    const stage = document.createElement('div');
    stage.dataset['sceneStage'] = '';
    fixture.nativeElement.parentElement?.appendChild(stage);
    const reservations: number[] = [];
    fixture.componentInstance.reservationChange.subscribe(value => reservations.push(value.reservedHeight + value.inlineSlotHeight));
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    fixture.componentRef.setInput('projection', { nodes: nodes.filter(node => node.id !== 'a'), edges: [] });
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    expect(reservations.at(-1)).toBe(0);
    fixture.destroy();
    stage.remove();
  });

  it('hides a pin without geometry and does not steal focus when its row is no longer placed', () => {
    const fixture = setup();
    const stage = document.createElement('div');
    stage.dataset['sceneStage'] = '';
    fixture.nativeElement.parentElement?.appendChild(stage);
    const focusRequests: string[] = [];
    fixture.componentInstance.focusWorkListRow.subscribe(id => focusRequests.push(id));
    fixture.componentRef.setInput('geometry', null);
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#command-plate') as HTMLElement).style.visibility).toBe('hidden');
    fixture.componentRef.setInput('geometry', { ...geometry, rows: { b: geometry.rows.b } });
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    expect(focusRequests).toEqual([]);
    fixture.destroy();
    stage.remove();
  });

  it('shows an unknown provider as Session and keeps one card when switching pins', () => {
    const fixture = setup();
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    fixture.componentInstance.pin('b');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('#command-plate')).toHaveLength(1);
    expect(fixture.componentInstance.providerName('unknown')).toBe('Session');
    fixture.destroy();
  });

  it('dismisses hover on Escape until the hovered node changes', () => {
    const fixture = setup();
    fixture.componentRef.setInput('hoveredNodeId', 'a');
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS);
    fixture.detectChanges();
    fixture.componentInstance.closePinned();
    expect(fixture.componentInstance.activeNodeId()).toBeNull();
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(fixture.componentInstance.activeNodeId()).toBeNull();
    fixture.componentRef.setInput('hoveredNodeId', 'b');
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(fixture.componentInstance.activeNodeId()).toBe('b');
    fixture.destroy();
  });

  it('suppresses a hover preview below 960px and releases a pin on destroy', () => {
    const fixture = setup();
    fixture.componentRef.setInput('geometry', { ...geometry, stage: { ...geometry.stage, width: 900 } });
    fixture.componentRef.setInput('hoveredNodeId', 'a');
    fixture.detectChanges();
    jest.advanceTimersByTime(COMMAND_OVERLAY_OPEN_DELAY_MS);
    expect(fixture.componentInstance.activeNodeId()).toBeNull();
    const stage = document.createElement('div');
    stage.dataset['sceneStage'] = '';
    fixture.nativeElement.parentElement?.appendChild(stage);
    const reservations: number[] = [];
    fixture.componentInstance.reservationChange.subscribe(value => reservations.push(value.reservedHeight + value.inlineSlotHeight));
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    expect(reservations.some(value => value > 0)).toBe(true);
    const emit = jest.spyOn(fixture.componentInstance.reservationChange, 'emit');
    fixture.destroy();
    expect(emit).toHaveBeenCalledWith({ pinnedId: null, anchorKind: null, inlineSlotHeight: 0, reservedHeight: 0 });
    stage.remove();
  });

  it('closes a pin on outside pointer and external selection change', () => {
    const fixture = setup();
    fixture.componentInstance.pin('a');
    fixture.detectChanges();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    fixture.componentInstance.pin('a');
    TestBed.inject(CommandCenterStore).select('b');
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedNodeId()).toBeNull();
    fixture.destroy();
  });
});

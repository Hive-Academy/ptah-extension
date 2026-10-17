import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandSceneComponent } from './command-scene.component';
import { CommandStreamsComponent } from './command-streams.component';

const root: CommandWorkNode = { id: 'root:r', kind: 'root', parentId: null, label: 'Ptah', providerId: null, state: 'running' };
const child: CommandWorkNode = { id: 'child:a', kind: 'child', parentId: root.id, label: 'Alpha', providerId: 'codex', state: 'running' };

describe('CommandSceneComponent', () => {
  const disconnect = jest.fn();
  const observe = jest.fn();
  let resizeCallback: (() => void) | null = null;
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
      public constructor(callback: ResizeObserverCallback) { resizeCallback = () => callback([], this); }
      public observe = observe;
      public disconnect = disconnect;
    } });
    TestBed.configureTestingModule({ imports: [CommandSceneComponent] });
  });

  it('renders root and stream buttons and forwards activation and hover', async () => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    const selections: string[] = [];
    const activations: string[] = [];
    const hover: (string | null)[] = [];
    fixture.componentInstance.selection.subscribe(id => selections.push(id));
    fixture.componentInstance.activate.subscribe(id => activations.push(id));
    fixture.componentInstance.hoveredNodeId.subscribe(id => hover.push(id));
    fixture.detectChanges();
    await fixture.whenStable();
    const row = fixture.nativeElement.querySelector('[data-stream-row-id]') as HTMLButtonElement;
    row.dispatchEvent(new MouseEvent('mouseenter'));
    row.click();
    expect(selections).toEqual([child.id]);
    expect(activations).toEqual([child.id]);
    expect(hover).toContain(child.id);
    (fixture.nativeElement.querySelector('[data-core-root-id]') as HTMLButtonElement).click();
    expect(activations).toEqual([child.id, root.id]);
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('stacks cards above the connector layer and carries reduced motion', () => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    fixture.componentRef.setInput('reducedMotion', true);
    fixture.detectChanges();
    const connectors = fixture.nativeElement.querySelector('ptah-command-connectors') as HTMLElement;
    const groups = fixture.nativeElement.querySelector('ptah-command-status-groups') as HTMLElement;
    const streams = fixture.nativeElement.querySelector('ptah-command-streams') as HTMLElement;
    const core = fixture.nativeElement.querySelector('.core-column') as HTMLElement;
    expect(connectors.querySelector('[data-scene-connectors]')).not.toBeNull();
    expect(groups.querySelectorAll('[data-status-card]')).toHaveLength(4);
    expect(groups.querySelectorAll('lucide-icon')).toHaveLength(4);
    expect(connectors.style.zIndex).toBe('0');
    expect(groups.style.zIndex).toBe('1');
    expect(streams.style.zIndex).toBe('1');
    expect(core.style.zIndex).toBe('1');
    expect(connectors.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fixture.destroy();
  });

  it.each(['Enter', ' '])('activates stream and root buttons with %s native keyboard click', key => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    fixture.detectChanges();
    const activations: string[] = [];
    fixture.componentInstance.activate.subscribe(id => activations.push(id));
    const row = fixture.nativeElement.querySelector('[data-stream-row-id]') as HTMLButtonElement;
    const rootButton = fixture.nativeElement.querySelector('[data-core-root-id]') as HTMLButtonElement;
    for (const button of [row, rootButton]) {
      button.focus();
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      // jsdom does not synthesize the button's default click from a key event.
      button.click();
    }
    expect(activations).toEqual([child.id, root.id]);
    fixture.destroy();
  });

  it('pauses when hidden and cancels measurement and listener on destroy', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const remove = jest.spyOn(document, 'removeEventListener');
    const fixture = TestBed.createComponent(CommandSceneComponent);
    const geometryEmit = jest.spyOn(fixture.componentInstance.geometryChange, 'emit');
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    expect(fixture.componentInstance.visibilityPaused()).toBe(true);
    expect(fixture.nativeElement.querySelector('ptah-command-core .dial.is-paused')).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(CommandStreamsComponent)).componentInstance.reducedMotion()).toBe(true);
    expect(resizeCallback).not.toBeNull();
    resizeCallback?.();
    fixture.componentInstance.requestMeasure();
    fixture.destroy();
    expect(cancel).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(geometryEmit).toHaveBeenCalledWith(null);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    request.mockRestore(); cancel.mockRestore(); remove.mockRestore();
  });

  it('clears stale geometry when a child measurement surface disappears', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    for (const callback of callbacks.splice(0)) callback(0);
    expect(fixture.componentInstance.geometry()).not.toBeNull();
    const streams = fixture.debugElement.query(By.directive(CommandStreamsComponent)).componentInstance as CommandStreamsComponent;
    jest.spyOn(streams, 'measurementElements').mockReturnValue({ viewport: null, rows: document.querySelectorAll<HTMLElement>('[data-no-rows]') });
    fixture.componentInstance.requestMeasure();
    for (const callback of callbacks.splice(0)) callback(0);
    expect(fixture.componentInstance.geometry()).toBeNull();
    fixture.destroy();
    request.mockRestore();
  });
});

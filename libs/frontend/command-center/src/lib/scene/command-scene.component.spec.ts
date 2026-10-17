import { TestBed } from '@angular/core/testing';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandSceneComponent } from './command-scene.component';

const root: CommandWorkNode = { id: 'root:r', kind: 'root', parentId: null, label: 'Ptah', providerId: null, state: 'running' };
const child: CommandWorkNode = { id: 'child:a', kind: 'child', parentId: root.id, label: 'Alpha', providerId: 'codex', state: 'running' };

describe('CommandSceneComponent', () => {
  const disconnect = jest.fn();
  const observe = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
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

  it('composes cards below the decorative connector layer and carries reduced motion', () => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', { nodes: [root, child], edges: [] });
    fixture.componentRef.setInput('reducedMotion', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-scene-connectors]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-status-card]')).toHaveLength(4);
    fixture.destroy();
  });
});

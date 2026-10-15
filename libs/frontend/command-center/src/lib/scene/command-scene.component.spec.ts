import { TestBed } from '@angular/core/testing';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandSceneComponent } from './command-scene.component';
import { CommandSceneRenderer } from './command-scene-renderer';
import { SpriteCache } from './sprite-cache';

const root: CommandWorkNode = {
  id: 'root:r',
  kind: 'root',
  parentId: null,
  label: 'Ptah',
  providerId: null,
  state: 'completed',
};
const projection = { nodes: [root], edges: [] };

describe('CommandSceneComponent', () => {
  const context = Object.assign({} as CanvasRenderingContext2D, {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    ellipse: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    setLineDash: jest.fn(),
    drawImage: jest.fn(),
  });
  const disconnect = jest.fn();
  let getContext: jest.SpyInstance;
  let sprite: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        public observe = jest.fn();
        public disconnect(): void {
          disconnect();
        }
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
    getContext = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => context);
    sprite = jest
      .spyOn(SpriteCache.prototype, 'get')
      .mockImplementation(() => document.createElement('canvas'));
    TestBed.configureTestingModule({ imports: [CommandSceneComponent] });
  });

  afterEach(() => {
    getContext.mockRestore();
    sprite.mockRestore();
  });

  const create = async () => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', projection);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  it('emits one hover for repeated moves, then null on leaving, without frame emissions', async () => {
    const fixture = await create();
    const emissions: (string | null)[] = [];
    fixture.componentInstance.hoveredNodeId.subscribe((id) =>
      emissions.push(id),
    );
    const canvas = fixture.nativeElement.querySelector(
      'canvas',
    ) as HTMLCanvasElement;
    const frames: FrameRequestCallback[] = [];
    const raf = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 400, clientY: 291 }),
    );
    canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 400, clientY: 291 }),
    );
    expect(frames).toHaveLength(1);
    frames.shift()?.(1000);
    expect(emissions).toEqual([root.id]);
    canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 400, clientY: 291 }),
    );
    frames.shift()?.(1016);
    expect(emissions).toEqual([root.id]);
    canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 790, clientY: 590 }),
    );
    frames.shift()?.(1032);
    expect(emissions).toEqual([root.id, null]);
    canvas.dispatchEvent(new MouseEvent('pointerleave'));
    expect(emissions).toEqual([root.id, null]);
    raf.mockRestore();
    fixture.destroy();
  });

  it('emits selection from the canvas and releases listeners and observer on teardown', async () => {
    const fixture = await create();
    const selected: string[] = [];
    const hovered: (string | null)[] = [];
    fixture.componentInstance.selection.subscribe((id) => selected.push(id));
    fixture.componentInstance.hoveredNodeId.subscribe((id) => hovered.push(id));
    const canvas = fixture.nativeElement.querySelector(
      'canvas',
    ) as HTMLCanvasElement;
    canvas.dispatchEvent(
      new MouseEvent('click', { clientX: 400, clientY: 291 }),
    );
    expect(selected).toEqual([root.id]);
    canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 400, clientY: 291 }),
    );
    canvas.dispatchEvent(new MouseEvent('pointerleave'));
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    // hoveredNodeId emits only on change; no hover was resolved, so the last known value stays null.
    expect(hovered.at(-1) ?? null).toBeNull();
  });

  it('reports unavailable Canvas 2D so the page can show its list', async () => {
    getContext.mockImplementation(() => null);
    const fixture = TestBed.createComponent(CommandSceneComponent);
    const unavailable: boolean[] = [];
    fixture.componentInstance.canvasUnavailable.subscribe((value) =>
      unavailable.push(value),
    );
    fixture.componentRef.setInput('projection', projection);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(unavailable).toEqual([true]);
    fixture.destroy();
  });

  it('updates voice levels without relayout or sprite requests, but relayouts a projection change', async () => {
    const fixture = await create();
    const firstLayout = fixture.componentInstance.layout();
    const firstSpriteCount = sprite.mock.calls.length;
    const invalidate = jest.spyOn(CommandSceneRenderer.prototype, 'invalidate');
    fixture.componentRef.setInput('inputLevel', 0.5);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.layout()).toBe(firstLayout);
    expect(sprite).toHaveBeenCalledTimes(firstSpriteCount);
    expect(invalidate).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('projection', {
      nodes: [
        root,
        {
          id: 'cli:a',
          kind: 'agent',
          parentId: root.id,
          label: 'A',
          providerId: 'codex',
          state: 'completed',
        },
      ],
      edges: [],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.layout()).not.toBe(firstLayout);
    expect(sprite.mock.calls.length).toBeGreaterThan(firstSpriteCount);
    invalidate.mockRestore();
    fixture.destroy();
  });
});

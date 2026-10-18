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
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    closePath: jest.fn(),
    scale: jest.fn(),
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
        public unobserve = jest.fn();
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
    jest
      .spyOn(SpriteCache.prototype, 'getVoiceHalo')
      .mockImplementation(() => document.createElement('canvas'));
    TestBed.configureTestingModule({ imports: [CommandSceneComponent] });
  });

  afterEach(() => {
    getContext.mockRestore();
    sprite.mockRestore();
    jest.restoreAllMocks();
  });

  const create = async () => {
    const fixture = TestBed.createComponent(CommandSceneComponent);
    fixture.componentRef.setInput('projection', projection);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  it('positions the overflow pill below the page caption', async () => {
    const fixture = await create();
    fixture.componentInstance.layout.set({
      ...fixture.componentInstance.layout(),
      overflowChip: { text: '+2 more', x: 700, y: 550 },
    });
    fixture.detectChanges();
    const chip = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('span'),
    ).find((element) => element.textContent?.includes('+2 more'));
    expect(chip?.className).toContain('top-12');
    expect(chip?.className).toContain('right-5');
  });

  it('refreshes inks after same-class data-theme switches and uses base content for idle', async () => {
    let onThemeChange: MutationCallback | undefined;
    const themeObserver = jest
      .spyOn(globalThis, 'MutationObserver')
      .mockImplementation((callback) => {
        onThemeChange = callback;
        return {
          observe: jest.fn(),
          disconnect: jest.fn(),
        } as unknown as MutationObserver;
      });
    const originalGetComputedStyle = window.getComputedStyle;
    const stageStyle = {
      color: 'rgb(1, 2, 3)',
      getPropertyValue: (name: string) => {
        if (name === '--state-ink-run')
          return document.documentElement.dataset['theme'] === 'forest'
            ? '#abcdef'
            : '#123456';
        if (name === '--bcm') return '50% 0 0';
        return '';
      },
    } as CSSStyleDeclaration;
    const style = jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element) =>
        element.getAttribute('role') === 'group'
          ? stageStyle
          : originalGetComputedStyle(element),
      );
    document.documentElement.dataset['theme'] = 'dark';
    const snapshots = jest.spyOn(CommandSceneRenderer.prototype, 'setSnapshot');
    const fixture = await create();
    fixture.detectChanges();
    expect(snapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inks: expect.objectContaining({
          run: '#123456',
          idle: 'oklch(50% 0 0)',
        }),
      }),
    );
    document.documentElement.dataset['theme'] = 'forest';
    onThemeChange?.([], {} as MutationObserver);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(snapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inks: expect.objectContaining({ run: '#abcdef' }),
      }),
    );
    fixture.destroy();
    snapshots.mockRestore();
    themeObserver.mockRestore();
    style.mockRestore();
    document.documentElement.removeAttribute('data-theme');
  });

  it('emits one hover for repeated moves, then null on leaving, without frame emissions', async () => {
    const fixture = await create();
    const hoverUpdate = jest.spyOn(
      CommandSceneRenderer.prototype,
      'setHoveredId',
    );
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
    expect(hoverUpdate.mock.calls).toEqual([[root.id], [null]]);
    canvas.dispatchEvent(new MouseEvent('pointerleave'));
    expect(emissions).toEqual([root.id, null]);
    raf.mockRestore();
    hoverUpdate.mockRestore();
    fixture.destroy();
  });

  it('does not resolve canvas inks during voice or theme class updates', async () => {
    const fixture = await create();
    const styles = jest.spyOn(window, 'getComputedStyle');
    const stage = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="group"]',
    );
    const stageReads = () =>
      styles.mock.calls.filter(([element]) => element === stage).length;
    await fixture.whenStable();
    const initialReads = stageReads();
    fixture.componentRef.setInput('theme', 'light');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stageReads()).toBe(initialReads);
    fixture.componentRef.setInput('inputLevel', 0.5);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stageReads()).toBe(initialReads);
    fixture.componentRef.setInput('theme', 'dark');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stageReads()).toBe(initialReads);
    styles.mockRestore();
    fixture.destroy();
  });

  it('caps sprite and halo DPR, and updates voice without rebuilding their sprites', async () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 3,
    });
    const halo = jest.spyOn(SpriteCache.prototype, 'getVoiceHalo');
    const fixture = await create();
    expect(sprite).toHaveBeenLastCalledWith(
      expect.objectContaining({ dpr: 2 }),
    );
    expect(halo).toHaveBeenLastCalledWith(expect.objectContaining({ dpr: 2 }));
    const spritesBefore = sprite.mock.calls.length;
    const halosBefore = halo.mock.calls.length;
    fixture.componentRef.setInput('outputLevel', 0.7);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sprite.mock.calls).toHaveLength(spritesBefore);
    expect(halo.mock.calls).toHaveLength(halosBefore);
    fixture.destroy();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDpr,
    });
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

  it('lays out root and child plates using their measured DOM sizes by node id', async () => {
    const child: CommandWorkNode = {
      id: 'child:builder',
      kind: 'child',
      parentId: root.id,
      label: 'Builder',
      providerId: 'codex',
      state: 'running',
    };
    const fixture = await create();
    fixture.componentRef.setInput('projection', {
      nodes: [root, child],
      edges: [],
    });
    fixture.detectChanges();
    const labels = [root, child].map((node, index) => {
      const element = document.createElement('button');
      element.dataset['nodeId'] = node.id;
      element.textContent = `${node.label}Provider · running`;
      Object.defineProperty(element, 'offsetWidth', {
        configurable: true,
        value: index ? 148 : 160,
      });
      Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        value: 44,
      });
      fixture.nativeElement.appendChild(element);
      return {
        id: node.id,
        element,
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    });
    fixture.componentInstance.setOverlayLabels(labels);
    fixture.detectChanges();
    await fixture.whenStable();
    const first = fixture.componentInstance.layout();
    expect(
      first.nodes.find((entry) => entry.node.id === root.id)?.labelRect,
    ).toMatchObject({ width: 160, height: 44 });
    expect(
      first.nodes.find((entry) => entry.node.id === child.id)?.labelRect,
    ).toMatchObject({ width: 148, height: 44 });
    fixture.componentInstance.setOverlayLabels([...labels]);
    fixture.detectChanges();
    expect(fixture.componentInstance.layout()).toBe(first);
    Object.defineProperty(labels[0].element, 'offsetWidth', {
      configurable: true,
      value: 172,
    });
    fixture.componentInstance.setOverlayLabels([
      { ...labels[0], width: labels[0].element.offsetWidth },
      labels[1],
    ]);
    fixture.detectChanges();
    expect(
      fixture.componentInstance
        .layout()
        .nodes.find((entry) => entry.node.id === root.id)?.labelRect?.width,
    ).toBe(172);
    fixture.destroy();
  });
});

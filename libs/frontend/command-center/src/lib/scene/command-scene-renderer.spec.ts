import type { CommandWorkNode } from '../model/command-center.store';
import {
  CommandSceneRenderer,
  type SceneRenderSnapshot,
} from './command-scene-renderer';

const root: CommandWorkNode = {
  id: 'root:r',
  kind: 'root',
  parentId: null,
  label: 'Ptah',
  providerId: null,
  state: 'completed',
};
const child: CommandWorkNode = {
  id: 'cli:a',
  kind: 'agent',
  parentId: root.id,
  label: 'A',
  providerId: null,
  state: 'completed',
};
const layout: SceneRenderSnapshot['layout'] = {
  orbitCount: 1,
  nodes: [
    {
      node: root,
      x: 100,
      y: 80,
      radius: 30,
      scale: 1,
      kind: 'root',
      label: 'Ptah',
      labelRect: { x: 80, y: 120, width: 40, height: 20 },
      phases: [],
    },
    {
      node: child,
      x: 210,
      y: 120,
      radius: 20,
      scale: 1,
      kind: 'delegate',
      label: 'A',
      labelRect: null,
      phases: [],
    },
  ],
  overflowCompleted: 0,
  overflowOther: 0,
  overflowChip: null,
};

describe('CommandSceneRenderer', () => {
  const frame = jest.fn<number, [FrameRequestCallback]>();
  const cancel = jest.fn();
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
    closePath: jest.fn(),
    setLineDash: jest.fn(),
    drawImage: jest.fn(),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    fillText: jest.fn(),
  });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(canvas, 'clientHeight', {
    configurable: true,
    value: 240,
  });
  canvas.width = 320;
  canvas.height = 240;
  const createBackdrop = jest.fn(() => {
    const backdrop = document.createElement('canvas');
    jest.spyOn(backdrop, 'getContext').mockReturnValue(context);
    return backdrop;
  });
  let callback: FrameRequestCallback;
  let renderer: CommandSceneRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    context.drawImage.mockReset();
    frame.mockImplementation((next) => {
      callback = next;
      return 1;
    });
    renderer = new CommandSceneRenderer(
      canvas,
      context,
      frame,
      cancel,
      createBackdrop,
    );
  });

  const snapshot = (
    state: CommandWorkNode['state'] = 'completed',
  ): SceneRenderSnapshot => ({
    layout: {
      ...layout,
      nodes: layout.nodes.map((node) => ({
        ...node,
        node: { ...node.node, state },
      })),
    },
    sprites: [
      { id: root.id, image: canvas },
      { id: child.id, image: canvas },
    ],
    labels: [
      {
        id: root.id,
        element: document.createElement('div'),
        width: 40,
        height: 20,
      },
    ],
    selectedId: child.id,
    hoveredId: null,
    inks: {
      run: '#3b82f6',
      need: '#f97316',
      err: '#ef4444',
      done: '#16a34a',
      idle: '#9ca3af',
    },
    voiceState: 'idle',
    inputLevel: 0,
    outputLevel: 0,
    reducedMotion: false,
    theme: 'dark',
  });

  it('limits ambient paints to one per 33ms while live work paints every frame', () => {
    renderer.setSnapshot(snapshot());
    for (const time of [1000, 1016, 1032, 1048, 1064, 1080]) callback(time);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    expect(frame).toHaveBeenCalledTimes(7);
    renderer.setSnapshot(snapshot('running'));
    for (const time of [1096, 1112, 1128]) callback(time);
    expect(context.clearRect).toHaveBeenCalledTimes(5);
    renderer.destroy();
  });

  it.each(['stopped', 'muted', 'error'] as const)(
    'keeps the ambient frame cap while voice is %s',
    (voiceState) => {
      renderer.setSnapshot(snapshot());
      renderer.setVoice({ voiceState, inputLevel: 0, outputLevel: 0 });
      for (const time of [1000, 1016, 1032, 1048, 1064, 1080]) callback(time);
      expect(context.clearRect).toHaveBeenCalledTimes(2);
      renderer.destroy();
    },
  );

  it('stops ambient scheduling under reduced motion', () => {
    renderer.setSnapshot({ ...snapshot(), reducedMotion: true });
    callback(1000);
    expect(frame).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('draws orbit tracks from the layout decision', () => {
    renderer.setSnapshot({
      ...snapshot(),
      layout: { ...layout, orbitCount: 9 },
    });
    expect(context.ellipse).toHaveBeenCalledTimes(2);
    renderer.destroy();
  });

  it('draws the voice glow before the root sprite and freezes its size for reduced motion', () => {
    renderer.setSnapshot({ ...snapshot(), inputLevel: 1 });
    callback(1000);
    const glowArc = context.arc.mock.calls.find(
      (call) => call[2] === 30 * 1.9 * 1.25,
    );
    expect(glowArc).toBeDefined();
    const glowGradient = context.createRadialGradient.mock.calls.at(-1);
    expect(glowGradient?.[5]).toBe(30 * 1.9 * 1.25);
    expect(
      context.createRadialGradient.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(context.drawImage.mock.invocationCallOrder[1]);
    renderer.setSnapshot({ ...snapshot(), reducedMotion: true, inputLevel: 1 });
    callback(1016);
    expect(context.createRadialGradient.mock.calls.at(-1)?.[5]).toBe(30 * 1.9);
    renderer.destroy();
  });

  it('moves link dashes toward work and keeps them static for reduced motion', () => {
    const offsets: number[] = [];
    Object.defineProperty(context, 'lineDashOffset', {
      configurable: true,
      set(value: number) {
        offsets.push(value);
      },
    });
    renderer.setSnapshot(snapshot());
    callback(1000);
    callback(2000);
    expect(offsets).toContain(-12);
    expect(offsets).toContain(-24);
    expect(context.setLineDash).toHaveBeenCalledWith([3, 7]);
    const tethered = snapshot();
    renderer.setSnapshot({
      ...tethered,
      layout: {
        ...tethered.layout,
        tethers: [
          {
            fromId: child.id,
            toId: root.id,
            fromX: 210,
            fromY: 120,
            toX: 100,
            toY: 80,
          },
        ],
      },
    });
    callback(2500);
    expect(offsets).toContain(-30);
    expect(context.moveTo).toHaveBeenCalledWith(100, 80);
    expect(context.lineTo).toHaveBeenCalledWith(210, 120);
    offsets.length = 0;
    renderer.setSnapshot({ ...snapshot(), reducedMotion: true });
    callback(3000);
    expect(offsets.every((offset) => offset === 0)).toBe(true);
    renderer.destroy();
    Reflect.deleteProperty(context, 'lineDashOffset');
  });

  it('draws a leader when a crowded root plate clears the sphere by more than 24px', () => {
    const data = snapshot();
    renderer.setSnapshot({
      ...data,
      layout: {
        ...data.layout,
        nodes: data.layout.nodes.map((node, index) =>
          index === 0
            ? { ...node, labelRect: { x: 80, y: 145, width: 40, height: 20 } }
            : node,
        ),
      },
    });
    callback(1000);
    expect(context.moveTo).toHaveBeenCalledWith(100, 80);
    expect(context.lineTo).toHaveBeenCalledWith(100, 145);
    renderer.destroy();
  });

  it('uses the theme line ink for the root leader after a running child link', () => {
    const strokes: Array<{ ink: string; width: number }> = [];
    let leader = false;
    context.lineTo.mockImplementation((x: number, y: number) => {
      if (x === 100 && y === 145) leader = true;
    });
    context.stroke.mockImplementation(() => {
      if (leader)
        strokes.push({
          ink: String(context.strokeStyle),
          width: context.lineWidth,
        });
      leader = false;
    });
    const data = snapshot('running');
    renderer.setSnapshot({
      ...data,
      layout: {
        ...data.layout,
        nodes: data.layout.nodes.map((node, index) =>
          index === 0
            ? { ...node, labelRect: { x: 80, y: 145, width: 40, height: 20 } }
            : node,
        ),
      },
    });
    callback(1000);
    expect(strokes).toEqual([{ ink: '#6b6388', width: 1 }]);
    renderer.destroy();
  });

  it('skips zero-size backdrops and releases the previous backing store', () => {
    const data = snapshot();
    renderer.setSnapshot(data);
    const previous = createBackdrop.mock.results[0].value;
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      value: 0,
    });
    renderer.setSnapshot(data);
    expect(previous.width).toBe(0);
    expect(previous.height).toBe(0);
    expect(createBackdrop).toHaveBeenCalledTimes(1);
    callback(1000);
    expect(
      context.drawImage.mock.calls.every(([source]) => source !== previous),
    ).toBe(true);
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    renderer.setSnapshot(data);
    expect(createBackdrop).toHaveBeenCalledTimes(2);
    callback(1016);
    const replacement = createBackdrop.mock.results[1].value;
    expect(
      context.drawImage.mock.calls.filter(([source]) => source === replacement),
    ).toHaveLength(1);
    renderer.destroy();
  });

  it('draws every sprite once and positions labels and the card anchor', () => {
    const anchor = document.createElement('div');
    const data = snapshot();
    renderer.setSnapshot(data);
    expect(createBackdrop).toHaveBeenCalledTimes(1);
    renderer.setCardAnchor(anchor, child.id);
    expect(frame).toHaveBeenCalledTimes(1);
    callback(1000);
    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(context.createRadialGradient).toHaveBeenCalledTimes(2);
    expect(data.labels[0].element.style.transform).toBe(
      'translate3d(80px,120px,0)',
    );
    expect(anchor.style.transform).toBe('translate3d(210px,120px,0)');
    expect(frame).toHaveBeenCalledTimes(2);
    renderer.setCardAnchor(anchor, null);
    expect(anchor.style.transform).toBe('');
    renderer.destroy();
  });

  it('draws the padded sprite around the sphere without changing its hit radius', () => {
    renderer.setSnapshot(snapshot());
    callback(1000);
    expect(context.drawImage).toHaveBeenNthCalledWith(
      2,
      canvas,
      100 - 30 * 2.2,
      80 - 30 * 2.2,
      60 * 2.2,
      60 * 2.2,
    );
    expect(context.drawImage).toHaveBeenNthCalledWith(
      3,
      canvas,
      210 - 20 * 2.2,
      120 - 20 * 2.2,
      40 * 2.2,
      40 * 2.2,
    );
    expect(renderer.hitTest(100 + 39, 80)).toBeNull();
    renderer.destroy();
  });

  it('pauses a live loop while hidden and resumes on visibility', () => {
    renderer.setSnapshot(snapshot('running'));
    renderer.setHidden(true);
    expect(cancel).toHaveBeenCalledWith(1);
    callback(1000);
    expect(context.drawImage).not.toHaveBeenCalled();
    renderer.setHidden(false);
    expect(frame).toHaveBeenCalledTimes(2);
    callback(1016);
    expect(frame).toHaveBeenCalledTimes(3);
    renderer.destroy();
  });

  it('writes unchanged label and anchor styles only on the first active frame', () => {
    const data = snapshot('running');
    const label = data.labels[0].element;
    const anchor = document.createElement('div');
    let labelTransform = '';
    let anchorTransform = '';
    const labelWrite = jest.fn((value: string) => {
      labelTransform = value;
    });
    const anchorWrite = jest.fn((value: string) => {
      anchorTransform = value;
    });
    const displayWrite = jest.fn();
    Object.defineProperty(label.style, 'transform', {
      configurable: true,
      get: () => labelTransform,
      set: labelWrite,
    });
    Object.defineProperty(label.style, 'display', {
      configurable: true,
      get: () => '',
      set: displayWrite,
    });
    Object.defineProperty(anchor.style, 'transform', {
      configurable: true,
      get: () => anchorTransform,
      set: anchorWrite,
    });
    renderer.setSnapshot(data);
    renderer.setCardAnchor(anchor, child.id);
    callback(1000);
    callback(1016);
    expect(labelWrite).toHaveBeenCalledTimes(1);
    expect(displayWrite).toHaveBeenCalledTimes(1);
    expect(anchorWrite).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('recomputes activity and invalidates on voice changes without a new layout snapshot', () => {
    renderer.setSnapshot(snapshot());
    callback(1000);
    renderer.setVoice({
      voiceState: 'listening',
      inputLevel: 0.5,
      outputLevel: 0,
    });
    expect(frame).toHaveBeenCalledTimes(2);
    callback(1016);
    expect(frame).toHaveBeenCalledTimes(3);
    renderer.destroy();
  });

  it('hit tests the last projected spheres', () => {
    renderer.setSnapshot(snapshot());
    expect(renderer.hitTest(210, 120)).toBe(child.id);
    expect(renderer.hitTest(5, 5)).toBeNull();
    renderer.destroy();
  });

  it('draws a live child silver ring and a tether ending at its sphere', () => {
    const data = snapshot();
    const childSession: CommandWorkNode = {
      id: 'child:one',
      kind: 'child',
      parentId: root.id,
      label: 'Release review',
      providerId: 'codex',
      tabId: 'tab:one',
      state: 'running',
    };
    renderer.setSnapshot({
      ...data,
      layout: {
        ...data.layout,
        nodes: [
          data.layout.nodes[0],
          { ...data.layout.nodes[1], node: childSession, radius: 29 },
          {
            ...data.layout.nodes[1],
            node: { ...child, parentId: childSession.id },
            x: 255,
            y: 145,
          },
        ],
        tethers: [
          {
            fromId: child.id,
            toId: childSession.id,
            fromX: 255,
            fromY: 145,
            toX: 210,
            toY: 120,
          },
        ],
      },
    });
    callback(1000);
    expect(context.moveTo).toHaveBeenCalledWith(210, 120);
    expect(context.lineTo).toHaveBeenCalledWith(255, 145);
    expect(context.arc).toHaveBeenCalledWith(210, 120, 42, 0, Math.PI * 2);
    expect(context.setLineDash).not.toHaveBeenCalledWith([3, 5]);
    expect(renderer.hitTest(210, 120)).toBe(childSession.id);
    renderer.destroy();
  });

  it('dims a persisted unknown child and draws its dashed ring and CS monogram', () => {
    const data = snapshot();
    let childOpacity = 1;
    context.drawImage.mockImplementation(
      (_image: CanvasImageSource, x: number) => {
        if (x === 210 - 29 * 2.2) childOpacity = context.globalAlpha;
      },
    );
    renderer.setSnapshot({
      ...data,
      layout: {
        ...data.layout,
        nodes: data.layout.nodes.map((node, index) =>
          index === 1
            ? {
                ...node,
                radius: 29,
                node: {
                  ...node.node,
                  kind: 'child' as const,
                  tabId: undefined,
                  state: 'unknown' as const,
                },
              }
            : node,
        ),
      },
    });
    callback(1000);
    expect(context.arc).toHaveBeenCalledWith(210, 120, 42, 0, Math.PI * 2);
    expect(context.setLineDash).toHaveBeenCalledWith([3, 5]);
    expect(context.fillText).toHaveBeenCalledWith('CS', 210, 120);
    expect(childOpacity).toBeLessThan(1);
    expect(renderer.hitTest(210, 120)).toBe(child.id);
    renderer.destroy();
  });

  it('draws one solid hover halo and invalidates once per hover change', () => {
    renderer.setSnapshot(snapshot());
    callback(1000);
    renderer.setHoveredId(child.id);
    renderer.setHoveredId(child.id);
    expect(frame).toHaveBeenCalledTimes(2);
    callback(1016);
    expect(context.arc).toHaveBeenCalledWith(210, 120, 41, 0, Math.PI * 2);
    expect(context.strokeStyle).toBe('#9ca3af');
    expect(frame).toHaveBeenCalledTimes(3);
    renderer.setHoveredId(null);
    expect(frame).toHaveBeenCalledTimes(3);
    renderer.destroy();
  });

  it('keeps state and voice arcs visible without scheduling motion', () => {
    renderer.setSnapshot({
      ...snapshot('running'),
      reducedMotion: true,
      voiceState: 'speaking',
    });
    callback(1000);
    expect(context.arc).toHaveBeenCalledWith(
      210,
      120,
      26,
      -Math.PI / 2,
      -Math.PI / 2 + 2.25,
    );
    expect(context.arc).toHaveBeenCalledWith(
      100,
      80,
      46,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2,
    );
    expect(frame).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('draws a static elapsed arc for a timed running lane and clamps it at five minutes', () => {
    const frameTime = 1_000;
    const epochTime = performance.timeOrigin + frameTime;
    const timed = (state: CommandWorkNode['state'], startedAt?: number) => {
      const data = snapshot(state);
      return {
        ...data,
        reducedMotion: true,
        layout: {
          ...data.layout,
          nodes: data.layout.nodes.map((node, index) =>
            index === 1
              ? {
                  ...node,
                  node: { ...node.node, kind: 'lane' as const, startedAt },
                }
              : node,
          ),
        },
      };
    };
    renderer.setSnapshot(timed('running', epochTime - 150_000));
    callback(frameTime);
    expect(context.arc).toHaveBeenCalledWith(
      210,
      120,
      30,
      -Math.PI / 2,
      Math.PI / 2,
    );
    expect(frame).toHaveBeenCalledTimes(1);

    context.arc.mockClear();
    renderer.setSnapshot(timed('running', epochTime - 600_000));
    callback(frameTime);
    expect(context.arc).toHaveBeenCalledWith(
      210,
      120,
      30,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2,
    );
    expect(frame).toHaveBeenCalledTimes(2);

    context.arc.mockClear();
    renderer.setSnapshot(timed('running', epochTime + 10_000));
    callback(frameTime);
    expect(context.arc.mock.calls.some((call) => call[2] === 30)).toBe(false);
    context.arc.mockClear();
    renderer.setSnapshot(timed('completed', epochTime - 150_000));
    callback(frameTime);
    expect(context.arc.mock.calls.some((call) => call[2] === 30)).toBe(false);
    context.arc.mockClear();
    renderer.setSnapshot(timed('running'));
    callback(frameTime);
    expect(context.arc.mock.calls.some((call) => call[2] === 30)).toBe(false);
    expect(frame).toHaveBeenCalledTimes(5);
    renderer.destroy();
  });

  it('uses resolved inks for status arcs, glyphs, and the voice ring', () => {
    const strokes: string[] = [];
    const fills: string[] = [];
    context.stroke.mockImplementation(() =>
      strokes.push(String(context.strokeStyle)),
    );
    context.fill.mockImplementation(() =>
      fills.push(String(context.fillStyle)),
    );
    renderer.setSnapshot({
      ...snapshot('awaiting input'),
      voiceState: 'error',
      inks: {
        run: '#2a56c6',
        need: '#8f5200',
        err: '#b4232a',
        done: '#13713a',
        idle: '#6b6570',
      },
      theme: 'light',
    });
    callback(1000);
    expect(strokes).toContain('#8f5200');
    expect(strokes).toContain('#b4232a');
    expect(fills).toContain('#8f5200');
    renderer.destroy();
  });

  it('leaves the overflow chip background to its DOM pill', () => {
    renderer.setSnapshot({
      ...snapshot(),
      layout: {
        ...layout,
        overflowChip: { text: '+2 more', x: 220, y: 190 },
      },
    });
    callback(1000);
    expect(context.fillRect).not.toHaveBeenCalledWith(212, 178, 120, 26);
    renderer.destroy();
  });

  it('prepares link paint and backdrop only when geometry, theme, or size changes', () => {
    const data = snapshot();
    renderer.setSnapshot(data);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    callback(1000);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    renderer.setSnapshot({ ...data, outputLevel: 0.7 });
    expect(createBackdrop).toHaveBeenCalledTimes(1);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    renderer.setVoice({
      voiceState: 'speaking',
      inputLevel: 0,
      outputLevel: 0.8,
    });
    callback(1016);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledTimes(3);
    renderer.setSnapshot({ ...data, theme: 'light' });
    expect(createBackdrop).toHaveBeenCalledTimes(2);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(2);
    canvas.width = 640;
    renderer.setSnapshot({ ...data, theme: 'light' });
    expect(createBackdrop).toHaveBeenCalledTimes(3);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(3);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    canvas.width = 960;
    renderer.setSnapshot({ ...data, theme: 'light' });
    expect(createBackdrop).toHaveBeenCalledTimes(3);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(3);
    canvas.width = 320;
    renderer.destroy();
  });

  it('rebuilds the cached orbital field when the reserved scene rectangle changes', () => {
    const data = snapshot();
    renderer.setSnapshot({
      ...data,
      sceneRect: { x: 0, y: 82, width: 320, height: 96 },
    });
    expect(createBackdrop).toHaveBeenCalledTimes(1);
    renderer.setSnapshot({
      ...data,
      sceneRect: { x: 0, y: 154, width: 320, height: 24 },
    });
    expect(createBackdrop).toHaveBeenCalledTimes(2);
    expect(context.ellipse).toHaveBeenCalledWith(
      160,
      166,
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      Math.PI * 2,
    );
    renderer.destroy();
  });

  it('draws the delegation chevron with opaque idle ink and an active state stroke', () => {
    const fills: Array<{ ink: string; alpha: number }> = [];
    const strokes: Array<{ ink: string; width: number }> = [];
    context.fill.mockImplementation(() =>
      fills.push({
        ink: String(context.fillStyle),
        alpha: context.globalAlpha,
      }),
    );
    context.stroke.mockImplementation(() =>
      strokes.push({
        ink: String(context.strokeStyle),
        width: context.lineWidth,
      }),
    );
    renderer.setSnapshot(snapshot('running'));
    callback(1000);
    expect(fills).toContainEqual({ ink: '#9ca3af', alpha: 1 });
    expect(strokes).toContainEqual({ ink: '#3b82f6', width: 2 });
    renderer.destroy();
  });

  it('keeps speaking ripples out of reduced motion while blitting a static halo', () => {
    const data = snapshot();
    renderer.setSnapshot({
      ...data,
      reducedMotion: true,
      voiceState: 'speaking',
      outputLevel: 0.8,
      voiceHalo: canvas,
    });
    callback(1000);
    expect(context.drawImage).toHaveBeenCalledTimes(4);
    expect(context.arc).toHaveBeenCalledWith(100, 80, 54, 0, Math.PI * 2);
    expect(frame).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });
});

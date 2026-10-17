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
    setLineDash: jest.fn(),
    drawImage: jest.fn(),
    createRadialGradient: jest.fn(),
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
  let callback: FrameRequestCallback;
  let renderer: CommandSceneRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    frame.mockImplementation((next) => {
      callback = next;
      return 1;
    });
    renderer = new CommandSceneRenderer(canvas, context, frame, cancel);
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
    voiceState: 'idle',
    inputLevel: 0,
    outputLevel: 0,
    reducedMotion: false,
    theme: 'dark',
  });

  it('draws every sprite once, positions labels and the card anchor, and stops when idle', () => {
    const anchor = document.createElement('div');
    const data = snapshot();
    renderer.setSnapshot(data);
    renderer.setCardAnchor(anchor, child.id);
    expect(frame).toHaveBeenCalledTimes(1);
    callback(1000);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.createRadialGradient).not.toHaveBeenCalled();
    expect(data.labels[0].element.style.transform).toBe(
      'translate3d(80px,120px,0)',
    );
    expect(anchor.style.transform).toBe('translate3d(210px,120px,0)');
    expect(frame).toHaveBeenCalledTimes(1);
    renderer.setCardAnchor(anchor, null);
    expect(anchor.style.transform).toBe('');
    renderer.destroy();
  });

  it('draws the padded sprite around the sphere without changing its hit radius', () => {
    renderer.setSnapshot(snapshot());
    callback(1000);
    expect(context.drawImage).toHaveBeenNthCalledWith(
      1,
      canvas,
      100 - 30 * 2.2,
      80 - 30 * 2.2,
      60 * 2.2,
      60 * 2.2,
    );
    expect(context.drawImage).toHaveBeenNthCalledWith(
      2,
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
});

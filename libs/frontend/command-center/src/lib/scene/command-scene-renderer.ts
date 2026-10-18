import type { CommandVoiceState } from '../model/command-center.store';
import type { SceneLayout, SceneNode } from './scene-layout';

export interface SceneSprite {
  readonly id: string;
  readonly image: CanvasImageSource;
}

export interface SceneLabel {
  readonly id: string;
  readonly element: HTMLElement;
  readonly width: number;
  readonly height: number;
}

export interface SceneRenderSnapshot {
  readonly layout: SceneLayout;
  readonly sprites: readonly SceneSprite[];
  readonly labels: readonly SceneLabel[];
  readonly selectedId: string | null;
  readonly voiceState: CommandVoiceState;
  readonly inputLevel: number;
  readonly outputLevel: number;
  readonly reducedMotion: boolean;
  readonly theme: 'light' | 'dark';
}

export type SceneVoiceSnapshot = Pick<
  SceneRenderSnapshot,
  'voiceState' | 'inputLevel' | 'outputLevel'
>;

export class CommandSceneRenderer {
  private snapshot: SceneRenderSnapshot | null = null;
  private voice: SceneVoiceSnapshot = {
    voiceState: 'idle',
    inputLevel: 0,
    outputLevel: 0,
  };
  private frameId = 0;
  private hidden = false;
  private disposed = false;
  private active = false;
  private anchor: HTMLElement | null = null;
  private anchorNodeId: string | null = null;
  private readonly spriteById = new Map<string, CanvasImageSource>();
  private readonly labelById = new Map<string, SceneLabel>();
  private readonly labelStyles = new Map<
    HTMLElement,
    { display: string; transform: string }
  >();
  private readonly nodeById = new Map<string, SceneNode>();
  private readonly dots: readonly { x: number; y: number; size: number }[];
  private meter: HTMLElement | null = null;
  private lastMeterTime = 0;
  private lastFrameTime = 0;
  private lastAnchorTransform: string | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly context: CanvasRenderingContext2D,
    private readonly requestFrame: (
      callback: FrameRequestCallback,
    ) => number = requestAnimationFrame,
    private readonly cancelFrame: (id: number) => void = cancelAnimationFrame,
  ) {
    this.dots = Array.from({ length: 48 }, (_, index) => ({
      x: ((index * 73) % 97) / 97,
      y: ((index * 41) % 89) / 89,
      size: index % 5 === 0 ? 1.5 : 0.8,
    }));
  }

  public setSnapshot(snapshot: SceneRenderSnapshot): void {
    this.snapshot = snapshot;
    this.voice = {
      voiceState: snapshot.voiceState,
      inputLevel: snapshot.inputLevel,
      outputLevel: snapshot.outputLevel,
    };
    this.spriteById.clear();
    this.labelById.clear();
    this.labelStyles.clear();
    this.nodeById.clear();
    for (const sprite of snapshot.sprites)
      this.spriteById.set(sprite.id, sprite.image);
    for (const label of snapshot.labels) this.labelById.set(label.id, label);
    for (const node of snapshot.layout.nodes)
      this.nodeById.set(node.node.id, node);
    this.recomputeActive();
    this.invalidate();
  }

  public setVoice(voice: SceneVoiceSnapshot): void {
    this.voice = voice;
    if (!this.snapshot) return;
    this.recomputeActive();
    this.invalidate();
  }

  public setCardAnchor(
    element: HTMLElement | null,
    nodeId: string | null,
  ): void {
    if (this.anchor !== element && this.anchor)
      this.anchor.style.transform = '';
    if (this.anchor !== element) this.lastAnchorTransform = null;
    this.anchor = element;
    this.anchorNodeId = nodeId;
    if (element && nodeId === null && this.lastAnchorTransform !== '') {
      element.style.transform = '';
      this.lastAnchorTransform = '';
    }
    this.invalidate();
  }

  public setMeter(element: HTMLElement | null): void {
    this.meter = element;
  }

  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden && this.frameId) {
      this.cancelFrame(this.frameId);
      this.frameId = 0;
    } else if (!hidden) this.invalidate();
  }

  public invalidate(): void {
    if (!this.hidden && !this.disposed && this.snapshot && !this.frameId)
      this.frameId = this.requestFrame(this.draw);
  }

  public hitTest(x: number, y: number): string | null {
    const nodes = this.snapshot?.layout.nodes;
    if (!nodes) return null;
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes[index];
      const dx = x - node.x;
      const dy = y - node.y;
      const radius = node.radius + 8;
      if (dx * dx + dy * dy <= radius * radius) return node.node.id;
    }
    return null;
  }

  public destroy(): void {
    this.disposed = true;
    if (this.frameId) this.cancelFrame(this.frameId);
    this.frameId = 0;
    this.spriteById.clear();
    this.labelById.clear();
    this.labelStyles.clear();
    this.nodeById.clear();
    if (this.anchor) this.anchor.style.transform = '';
    this.snapshot = null;
  }

  private recomputeActive(): void {
    const snapshot = this.snapshot;
    this.active =
      !!snapshot &&
      !snapshot.reducedMotion &&
      (this.voice.voiceState === 'listening' ||
        this.voice.voiceState === 'thinking' ||
        this.voice.voiceState === 'speaking' ||
        snapshot.layout.nodes.some(
          (node) =>
            node.node.state === 'running' || node.node.state === 'starting',
        ));
  }

  private readonly draw = (time: number): void => {
    this.frameId = 0;
    const snapshot = this.snapshot;
    if (!snapshot || this.hidden || this.disposed) return;
    const started = performance.now();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const context = this.context;
    const dpr = Math.min(
      2,
      Math.max(1, this.canvas.width / Math.max(1, width)),
    );
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = snapshot.theme === 'dark' ? '#9d93ae' : '#625d73';
    for (const dot of this.dots) {
      context.globalAlpha = 0.18;
      context.fillRect(dot.x * width, dot.y * height, dot.size, dot.size);
    }
    context.globalAlpha = 1;
    context.strokeStyle = snapshot.theme === 'dark' ? '#504b68' : '#cbc3d5';
    context.lineWidth = 1;
    for (let orbit = 0; orbit < 3; orbit++) {
      const inner = orbit === 0;
      context.beginPath();
      context.ellipse(
        width * 0.5,
        height * 0.485,
        width * (inner ? 0.235 : orbit === 1 ? 0.405 : 0.425),
        height * (inner ? 0.225 : orbit === 1 ? 0.365 : 0.385),
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.lineWidth = 1;
    context.strokeStyle = snapshot.theme === 'dark' ? '#6b6388' : '#aaa1b1';
    for (const node of snapshot.layout.nodes) {
      if (!node.node.parentId) continue;
      const parent = this.nodeById.get(node.node.parentId);
      if (!parent) continue;
      context.beginPath();
      context.moveTo(parent.x, parent.y);
      context.bezierCurveTo(
        parent.x,
        (parent.y + node.y) / 2,
        node.x,
        (parent.y + node.y) / 2,
        node.x,
        node.y,
      );
      context.stroke();
    }
    const root = snapshot.layout.nodes.find((node) => node.kind === 'root');
    if (root?.labelRect) {
      const rect = root.labelRect;
      const edgeX = Math.max(rect.x, Math.min(root.x, rect.x + rect.width));
      const edgeY = Math.max(rect.y, Math.min(root.y, rect.y + rect.height));
      if (Math.hypot(edgeX - root.x, edgeY - root.y) > root.radius + 24) {
        context.beginPath();
        context.moveTo(root.x, root.y);
        context.lineTo(edgeX, edgeY);
        context.stroke();
      }
    }
    let particles = 0;
    if (this.active) {
      for (const node of snapshot.layout.nodes) {
        if (particles >= 16) break;
        if (node.node.state !== 'running' && node.node.state !== 'starting')
          continue;
        const parent = node.node.parentId
          ? this.nodeById.get(node.node.parentId)
          : null;
        if (!parent) continue;
        const t = (time * 0.00025 + particles * 0.19) % 1;
        const inverse = 1 - t;
        const midY = (parent.y + node.y) / 2;
        const px =
          inverse * inverse * inverse * parent.x +
          3 * inverse * inverse * t * parent.x +
          3 * inverse * t * t * node.x +
          t * t * t * node.x;
        const py =
          inverse * inverse * inverse * parent.y +
          3 * inverse * inverse * t * midY +
          3 * inverse * t * t * midY +
          t * t * t * node.y;
        context.fillStyle = '#e7bd74';
        context.fillRect(px, py, 2, 2);
        particles++;
      }
    }
    for (const node of snapshot.layout.nodes) {
      const sprite = this.spriteById.get(node.node.id);
      if (sprite) {
        const paddedSize = node.radius * 2 * 2.2;
        context.drawImage(
          sprite,
          node.x - paddedSize / 2,
          node.y - paddedSize / 2,
          paddedSize,
          paddedSize,
        );
      }
      this.drawStatus(node, time, snapshot);
      if (node.kind === 'root') this.drawVoiceRing(node, time, snapshot);
      if (snapshot.selectedId === node.node.id) {
        context.strokeStyle = snapshot.theme === 'dark' ? '#f4efe3' : '#554a45';
        context.lineWidth = 1.5;
        context.setLineDash([2, 6]);
        context.beginPath();
        context.arc(
          node.x,
          node.y,
          node.radius + (node.kind === 'root' ? 26 : 16),
          0,
          Math.PI * 2,
        );
        context.stroke();
        context.setLineDash([]);
      }
      const label = this.labelById.get(node.node.id);
      if (label) {
        const display = node.labelRect ? '' : 'none';
        const transform = node.labelRect
          ? `translate3d(${Math.round(node.labelRect.x)}px,${Math.round(node.labelRect.y)}px,0)`
          : (this.labelStyles.get(label.element)?.transform ?? '');
        const previous = this.labelStyles.get(label.element);
        if (previous?.display !== display)
          label.element.style.display = display;
        if (node.labelRect && previous?.transform !== transform)
          label.element.style.transform = transform;
        if (previous?.display !== display || previous?.transform !== transform)
          this.labelStyles.set(label.element, { display, transform });
      }
    }
    if (this.anchor) {
      const node = this.anchorNodeId
        ? this.nodeById.get(this.anchorNodeId)
        : null;
      const transform = node
        ? `translate3d(${Math.round(node.x)}px,${Math.round(node.y)}px,0)`
        : '';
      if (this.lastAnchorTransform !== transform) {
        this.anchor.style.transform = transform;
        this.lastAnchorTransform = transform;
      }
    }
    if (this.meter && time - this.lastMeterTime >= 500) {
      this.meter.textContent =
        this.active && this.lastFrameTime > 0
          ? `${Math.round(1000 / Math.max(1, time - this.lastFrameTime))} FPS · ${Math.round((performance.now() - started) * 10) / 10} ms`
          : 'FPS idle';
      this.lastMeterTime = time;
    }
    this.lastFrameTime = time;
    if (this.active) this.invalidate();
  };

  private drawStatus(
    node: SceneNode,
    time: number,
    snapshot: SceneRenderSnapshot,
  ): void {
    if (node.kind === 'root') return;
    const context = this.context;
    const state = node.node.state;
    context.strokeStyle =
      state === 'failed'
        ? '#eb6d75'
        : state === 'awaiting input'
          ? '#f2bb65'
          : state === 'completed'
            ? '#75c9a5'
            : '#87b9dc';
    context.lineWidth = 2.5;
    if (state === 'queued') context.setLineDash([3, 6]);
    context.beginPath();
    const angle =
      state === 'running' && !snapshot.reducedMotion
        ? time * 0.0017
        : -Math.PI / 2;
    context.arc(
      node.x,
      node.y,
      node.radius + 6,
      angle,
      angle + (state === 'running' ? 2.25 : Math.PI * 2),
    );
    context.stroke();
    context.setLineDash([]);
    if (state === 'awaiting input') {
      context.fillStyle = '#f2bb65';
      context.beginPath();
      context.moveTo(node.x + node.radius + 12, node.y - 5);
      context.lineTo(node.x + node.radius + 18, node.y);
      context.lineTo(node.x + node.radius + 12, node.y + 5);
      context.lineTo(node.x + node.radius + 6, node.y);
      context.fill();
    } else if (
      state === 'completed' ||
      state === 'failed' ||
      state === 'cancelled'
    ) {
      const x = node.x + node.radius + 8;
      const y = node.y;
      context.beginPath();
      if (state === 'completed') {
        context.moveTo(x - 5, y);
        context.lineTo(x - 1, y + 4);
        context.lineTo(x + 6, y - 5);
      } else if (state === 'failed') {
        context.moveTo(x - 5, y - 5);
        context.lineTo(x + 5, y + 5);
        context.moveTo(x + 5, y - 5);
        context.lineTo(x - 5, y + 5);
      } else {
        context.moveTo(x - 5, y + 5);
        context.lineTo(x + 5, y - 5);
      }
      context.stroke();
    }
    if (node.kind === 'tribunal' && node.phases.length) {
      const done = node.phases.filter(
        (phase) => phase.state === 'completed',
      ).length;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(
        node.x,
        node.y,
        node.radius + 12,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * done) / node.phases.length,
      );
      context.stroke();
    }
  }

  private drawVoiceRing(
    node: SceneNode,
    time: number,
    snapshot: SceneRenderSnapshot,
  ): void {
    const context = this.context;
    const voice = this.voice.voiceState;
    context.strokeStyle =
      voice === 'error'
        ? '#eb6d75'
        : voice === 'muted' || voice === 'stopped'
          ? '#8e8993'
          : voice === 'listening'
            ? '#67d5c6'
            : voice === 'thinking'
              ? '#8ebcff'
              : '#e5bd79';
    context.lineWidth = 3;
    context.setLineDash(
      voice === 'muted'
        ? [6, 8]
        : voice === 'speaking' || voice === 'error'
          ? [17, 7]
          : [],
    );
    const pulse = snapshot.reducedMotion
      ? 0
      : voice === 'listening'
        ? Math.max(0, Math.min(1, this.voice.inputLevel)) * 4
        : voice === 'speaking'
          ? Math.max(0, Math.min(1, this.voice.outputLevel)) * 4
          : 0;
    const angle =
      voice === 'thinking' && !snapshot.reducedMotion
        ? time * 0.0017
        : -Math.PI / 2;
    context.beginPath();
    context.arc(
      node.x,
      node.y,
      node.radius + 16 + pulse,
      angle,
      angle + (voice === 'thinking' ? 2.25 : Math.PI * 2),
    );
    context.stroke();
    context.setLineDash([]);
  }
}

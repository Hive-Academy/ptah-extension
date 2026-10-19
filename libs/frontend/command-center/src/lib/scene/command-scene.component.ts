import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  NgZone,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type {
  CommandTheme,
  CommandVoiceState,
  CommandWorkNode,
} from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import { layoutScene, type SceneLayout } from './scene-layout';
import { SpriteCache, type SpritePalette } from './sprite-cache';
import {
  CommandSceneRenderer,
  type SceneLabel,
  type SceneInks,
  type SceneSprite,
  type SceneVoiceSnapshot,
} from './command-scene-renderer';

const SCENE_PALETTES: Record<CommandTheme, Record<string, SpritePalette>> = {
  dark: {
    gold: { lit: '#f6d58f', mid: '#a16d37', dark: '#392818', rim: '#f7deaa' },
    blue: { lit: '#a8d3f5', mid: '#4579ae', dark: '#1c3457', rim: '#b9ddfa' },
    teal: { lit: '#9ce8df', mid: '#387f80', dark: '#1d4149', rim: '#adf1e9' },
    plum: { lit: '#d9b7e9', mid: '#865b9c', dark: '#3d2853', rim: '#e4c9ef' },
    red: { lit: '#f2b5ae', mid: '#ac585f', dark: '#542a39', rim: '#f7cac1' },
    jade: { lit: '#b6eac8', mid: '#548b6d', dark: '#234b3e', rim: '#c9f2d4' },
    silver: { lit: '#e8e6f0', mid: '#898ba5', dark: '#41445d', rim: '#f1eff8' },
  },
  light: {
    gold: { lit: '#fff0c5', mid: '#ce9d53', dark: '#79532d', rim: '#b27b3b' },
    blue: { lit: '#e5f3ff', mid: '#8ab4db', dark: '#446c99', rim: '#638db7' },
    teal: { lit: '#e0faf5', mid: '#85cbc3', dark: '#43817e', rim: '#589b95' },
    plum: { lit: '#f7eaff', mid: '#c6a4d7', dark: '#795e91', rim: '#9574a7' },
    red: { lit: '#ffebea', mid: '#e7a19b', dark: '#9a555a', rim: '#bb6e70' },
    jade: { lit: '#e8fae9', mid: '#a5d8b5', dark: '#568368', rim: '#75a184' },
    silver: { lit: '#fafaff', mid: '#c4c5d2', dark: '#777a91', rim: '#9c9eb2' },
  },
};

const FALLBACK_INKS: Record<CommandTheme, SceneInks> = {
  dark: {
    run: '#3b82f6',
    need: '#f97316',
    err: '#ef4444',
    done: '#16a34a',
    idle: '#9ca3af',
  },
  light: {
    run: '#2a56c6',
    need: '#8f5200',
    err: '#b4232a',
    done: '#13713a',
    idle: '#6b6570',
  },
};

function paletteName(
  kind: string,
  providerId: string | null,
  nodeKind: CommandWorkNode['kind'],
): string {
  if (kind === 'root' || kind === 'tribunal') return 'gold';
  if (kind === 'satellite' || nodeKind === 'child') return 'silver';
  const id = providerId?.toLowerCase() ?? '';
  if (id.includes('grok')) return 'teal';
  if (id.includes('opencode')) return 'plum';
  if (id.includes('antigravity')) return 'red';
  if (id.includes('glm') || id.includes('z.ai')) return 'jade';
  return 'blue';
}

@Component({
  selector: 'ptah-command-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #stage
      class="relative h-full min-h-[320px] w-full overflow-hidden"
      role="group"
      aria-label="Command Center scene"
    >
      <canvas
        #canvas
        class="absolute inset-0 h-full w-full"
        aria-hidden="true"
      ></canvas>
      <div class="pointer-events-none absolute inset-0">
        @if (layout().overflowChip; as chip) {
          <span
            class="absolute right-5 max-w-[90%] rounded-full bg-base-200 px-2 py-1 text-xs text-base-content"
            [style.top.px]="reservedTop() + 16"
            >{{ chip.text }}</span
          >
        }
      </div>
    </div>
  `,
})
export class CommandSceneComponent {
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly theme = input<CommandTheme>('dark');
  public readonly reservedTop = input<number>(72);
  public readonly voiceState = input<CommandVoiceState>('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly selection = output<string>();
  public readonly canvasUnavailable = output<boolean>();
  public readonly hoveredNodeId = output<string | null>();

  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stageRef =
    viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly overlayLabels = signal<readonly SceneLabel[]>([]);
  private readonly viewport = signal({ width: 0, height: 0 });
  private readonly reducedMotion = signal(false);
  private readonly ready = signal(false);
  private readonly inks = signal<SceneInks>(FALLBACK_INKS.dark);
  private resolveInks(): void {
    const theme = this.theme();
    const style = getComputedStyle(this.stageRef().nativeElement);
    const fallback = FALLBACK_INKS[theme];
    const read = (name: string, defaultValue: string): string =>
      style.getPropertyValue(`--state-ink-${name}`).trim() || defaultValue;
    const baseContent =
      style.getPropertyValue('--bcm').trim() ||
      style.getPropertyValue('--bc').trim();
    this.inks.set({
      run: read('run', fallback.run),
      need: read('need', fallback.need),
      err: read('err', fallback.err),
      done: read('done', fallback.done),
      idle: read('idle', baseContent ? `oklch(${baseContent})` : style.color),
    });
  }
  private readonly cache = new SpriteCache(() =>
    document.createElement('canvas'),
  );
  private renderer: CommandSceneRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private media: MediaQueryList | null = null;
  private pointerFrame = 0;
  private pointerX = 0;
  private pointerY = 0;
  private hoveredId: string | null = null;
  private cardAnchor: HTMLElement | null = null;
  private cardAnchorNodeId: string | null = null;
  private voiceSnapshot: SceneVoiceSnapshot = {
    voiceState: 'idle',
    inputLevel: 0,
    outputLevel: 0,
  };

  public readonly layout = signal<SceneLayout>({
    nodes: [],
    overflowCompleted: 0,
    overflowOther: 0,
    overflowChip: null,
  });

  private readonly sceneViewport = computed(() => {
    const viewport = this.viewport();
    const top = Math.min(viewport.height, Math.max(0, this.reservedTop() + 10));
    const bottom = Math.max(top, viewport.height - 62);
    return {
      ...viewport,
      sceneRect: {
        x: 0,
        y: top,
        width: viewport.width,
        height: bottom - top,
      },
    };
  });

  private readonly measuredLayout = computed(() => {
    const labels = this.overlayLabels();
    const measured = new Map(
      labels.map((label) => [
        label.id,
        { width: label.width, height: label.height },
      ]),
    );
    return layoutScene(
      this.projection(),
      this.sceneViewport(),
      (nodeId, text) => {
        const size = measured.get(nodeId);
        return size?.width && size.height
          ? size
          : {
              width: Math.min(220, Math.max(72, text.length * 7 + 24)),
              height: 28,
            };
      },
      this.selectedId(),
    );
  });

  public constructor() {
    afterNextRender(() => this.initialize());
    effect(() => {
      this.theme();
      if (this.ready()) this.resolveInks();
    });
    effect(() => {
      if (!this.ready()) return;
      const selectedId = this.selectedId();
      const theme = this.theme();
      const inks = this.inks();
      const reducedMotion = this.reducedMotion();
      const labels = this.overlayLabels();
      const layout = this.measuredLayout();
      this.layout.set(layout);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const sprites: SceneSprite[] = layout.nodes.map((sceneNode) => {
        const name = paletteName(
          sceneNode.kind,
          sceneNode.node.providerId,
          sceneNode.node.kind,
        );
        return {
          id: sceneNode.node.id,
          rim: SCENE_PALETTES[theme][name].rim,
          image: this.cache.get({
            node: sceneNode.node,
            theme,
            paletteName: name,
            palette: SCENE_PALETTES[theme][name],
            size: Math.ceil(sceneNode.radius * 2),
            dpr,
          }),
        };
      });
      const root = layout.nodes.find((node) => node.kind === 'root');
      const voiceHalo = root
        ? this.cache.getVoiceHalo({
            theme,
            paletteName: 'gold',
            palette: SCENE_PALETTES[theme]['gold'],
            dpr,
          })
        : undefined;
      this.cache.prune(new Set(layout.nodes.map((node) => node.node.id)));
      this.zone.runOutsideAngular(() => {
        this.renderer?.setSnapshot({
          layout,
          sceneRect: this.sceneViewport().sceneRect,
          sprites,
          voiceHalo,
          labels,
          selectedId,
          hoveredId: this.hoveredId,
          inks,
          ...this.voiceSnapshot,
          reducedMotion,
          theme,
        });
        this.renderer?.setCardAnchor(this.cardAnchor, this.cardAnchorNodeId);
      });
    });
    effect(() => {
      if (!this.ready()) return;
      this.voiceSnapshot = {
        voiceState: this.voiceState(),
        inputLevel: this.inputLevel(),
        outputLevel: this.outputLevel(),
      };
      this.zone.runOutsideAngular(() =>
        this.renderer?.setVoice(this.voiceSnapshot),
      );
    });
    this.destroyRef.onDestroy(() => this.teardown());
  }

  /** Used by the shared node card to follow a sphere when its label is hidden. */
  public setCardAnchor(
    element: HTMLElement | null,
    nodeId: string | null,
  ): void {
    this.cardAnchor = element;
    this.cardAnchorNodeId = nodeId;
    this.zone.runOutsideAngular(() =>
      this.renderer?.setCardAnchor(element, nodeId),
    );
  }

  /** Attach the overlay's measured label elements to the next scene snapshot. */
  public setOverlayLabels(labels: readonly SceneLabel[]): void {
    const previous = this.overlayLabels();
    const previousById = new Map(previous.map((label) => [label.id, label]));
    labels = labels.map((label) => {
      const old = previousById.get(label.id);
      return old?.element === label.element
        ? {
            ...label,
            width: label.width || old.width,
            height: label.height || old.height,
          }
        : label;
    });
    if (
      previous.length === labels.length &&
      previous.every(
        (label, index) =>
          label.id === labels[index].id &&
          label.element === labels[index].element &&
          label.width === labels[index].width &&
          label.height === labels[index].height,
      )
    )
      return;
    const previousElements = new Set(previous.map((label) => label.element));
    const nextElements = new Set(labels.map((label) => label.element));
    for (const element of previousElements) {
      if (!nextElements.has(element)) this.observer?.unobserve(element);
    }
    for (const element of nextElements) {
      if (!previousElements.has(element)) this.observer?.observe(element);
    }
    this.overlayLabels.set(labels);
  }

  private initialize(): void {
    const canvas = this.canvasRef().nativeElement;
    const context = canvas.getContext('2d');
    if (!context) {
      this.canvasUnavailable.emit(true);
      return;
    }
    this.canvasUnavailable.emit(false);
    const stage = this.stageRef().nativeElement;
    this.zone.runOutsideAngular(() => {
      this.renderer = new CommandSceneRenderer(canvas, context);
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver((entries) => {
          if (entries.some((entry) => entry.target === stage)) this.resize();
          if (entries.some((entry) => entry.target !== stage)) {
            const labels = this.overlayLabels().map((label) => ({
              ...label,
              width: label.element.offsetWidth,
              height: label.element.offsetHeight,
            }));
            this.zone.run(() => this.setOverlayLabels(labels));
          }
        });
        this.observer.observe(stage);
        for (const label of this.overlayLabels())
          this.observer.observe(label.element);
      }
      document.addEventListener('visibilitychange', this.onVisibility);
      this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.media.addEventListener('change', this.onMotion);
      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('pointerleave', this.onPointerLeave);
      canvas.addEventListener('click', this.onCanvasClick);
      this.resize();
      this.onMotion();
      this.onVisibility();
    });
    this.ready.set(true);
    this.resolveInks();
    this.themeObserver = new MutationObserver(() =>
      this.zone.run(() => this.resolveInks()),
    );
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  private resize(): void {
    const canvas = this.canvasRef().nativeElement;
    const stage = this.stageRef().nativeElement;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    this.zone.run(() => this.viewport.set({ width, height }));
  }

  private readonly onVisibility = (): void => {
    this.renderer?.setHidden(document.hidden);
  };

  private readonly onMotion = (): void => {
    this.zone.run(() => this.reducedMotion.set(this.media?.matches ?? false));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (!this.pointerFrame)
      this.pointerFrame = requestAnimationFrame(this.hitPointer);
  };

  private readonly hitPointer = (): void => {
    this.pointerFrame = 0;
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.updateHover(
      this.renderer?.hitTest(
        this.pointerX - rect.left,
        this.pointerY - rect.top,
      ) ?? null,
    );
  };

  private readonly onPointerLeave = (): void => {
    if (this.pointerFrame) cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = 0;
    this.updateHover(null);
  };

  private readonly onCanvasClick = (event: MouseEvent): void => {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const id = this.renderer?.hitTest(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (id) this.zone.run(() => this.selection.emit(id));
  };

  private updateHover(id: string | null): void {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer?.setHoveredId(id);
    this.zone.run(() => this.hoveredNodeId.emit(id));
  }

  private teardown(): void {
    this.zone.runOutsideAngular(() => {
      if (this.pointerFrame) cancelAnimationFrame(this.pointerFrame);
      this.pointerFrame = 0;
      this.observer?.disconnect();
      this.themeObserver?.disconnect();
      this.media?.removeEventListener('change', this.onMotion);
      document.removeEventListener('visibilitychange', this.onVisibility);
      const canvas = this.canvasRef().nativeElement;
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('click', this.onCanvasClick);
      this.renderer?.destroy();
      this.cache.prune(new Set());
    });
    this.updateHover(null);
  }
}

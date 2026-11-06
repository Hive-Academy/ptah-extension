import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { LIGHTFALL_DEFAULTS, LightfallOptions } from './lightfall-options';
import { LightfallRuntime } from './lightfall-runtime';

/** Why the light is (not) running; exposed as `data-state` for styling and tests. */
export type LightfallState = 'static' | 'live';

/**
 * A port of NGXUI Lightfall: a beam of light falling to a flare at the bottom
 * of the host, with drifting fog and wisps, in one WebGL context. Size the host;
 * the canvas fills it and screens onto what lies beneath. A static CSS beam
 * stands in during SSR, for reduced motion and save-data, without WebGL, and
 * until the first frame lands.
 */
@Component({
  selector: 'ptah-lightfall',
  standalone: true,
  template: `
    <div class="lf-fallback" [class.is-hidden]="state() === 'live'" aria-hidden="true"></div>
    <canvas #canvas class="lf-canvas" [class.is-live]="state() === 'live'" aria-hidden="true"></canvas>
  `,
  styleUrl: './lightfall.component.css',
  host: { '[attr.data-state]': 'state()', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightfallComponent {
  /** Any subset of the NGXUI inputs; the rest keep the brand defaults. */
  public readonly options = input<Partial<LightfallOptions>>({});

  protected readonly state = signal<LightfallState>('static');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly resolved = computed<LightfallOptions>(() => ({ ...LIGHTFALL_DEFAULTS, ...this.options() }));
  private readonly document = inject(DOCUMENT);
  private runtime?: LightfallRuntime;

  public constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => this.runtime?.setOptions(this.resolved()));
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => this.start());
    destroyRef.onDestroy(() => {
      this.runtime?.destroy();
      this.runtime = undefined;
    });
  }

  private start(): void {
    const view = this.document.defaultView;
    if (!view || this.runtime || !motionAllowed(view)) return;
    const runtime = new LightfallRuntime(this.canvas().nativeElement, view, this.resolved(), {
      onLive: () => this.state.set('live'),
      onDark: () => this.state.set('static'),
    });
    if (runtime.start()) this.runtime = runtime;
  }
}

/** Reduced motion and save-data keep the static beam. */
export function motionAllowed(view: Window): boolean {
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const nav = view.navigator as Navigator & { connection?: { saveData?: boolean } };
  return !reduced && nav.connection?.saveData !== true;
}

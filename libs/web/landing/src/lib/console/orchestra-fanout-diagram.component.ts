import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(MotionPathPlugin);

interface Specialist {
  readonly name: string;
  readonly y: number;
  readonly cy: number;
  readonly edge: string;
}

/**
 * OrchestraFanoutDiagramComponent — mechanism diagram proving Pillar 2: "Not one
 * agent guessing — a staffed team that compounds."
 *
 * A main agent fans work to five specialists (Architect, Backend, Frontend,
 * Tester, Reviewer): edges draw, dots travel outward along them, and each
 * specialist ignites as work arrives. A completed run then crystallizes into a
 * skill token that flies onto a growing SKILLS LIBRARY stack counting 01→02→03.
 *
 * SSG / reduced-motion safe: static DOM is the resolved still — edges drawn,
 * specialists lit, stack full (3 layers), counter "03", transient dots/token
 * hidden. The looping timeline only runs under `no-preference`.
 */
@Component({
  selector: 'ptah-orchestra-fanout-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      data-root
      viewBox="0 0 680 360"
      class="w-full h-auto"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <!-- main agent -->
      <rect
        x="36"
        y="150"
        width="92"
        height="44"
        rx="8"
        fill="#12151b"
        stroke="#f5a524"
        stroke-opacity="0.55"
      />
      <text
        x="82"
        y="177"
        fill="#f5a524"
        font-size="12"
        font-family="monospace"
        text-anchor="middle"
      >
        main
      </text>
      <text x="36" y="134" fill="#5b616f" font-size="9" font-family="monospace">
        orchestration · 3-tier
      </text>

      <!-- fan-out edges -->
      @for (s of specialists; track s.name) {
        <path
          data-edge
          [attr.d]="s.edge"
          fill="none"
          stroke="#2b303a"
          stroke-width="1.5"
          pathLength="1"
        />
      }

      <!-- specialist nodes -->
      @for (s of specialists; track s.name) {
        <g data-spec>
          <rect
            [attr.x]="300"
            [attr.y]="s.y"
            width="120"
            height="30"
            rx="6"
            fill="#12151b"
            stroke="#2b303a"
          />
          <circle cx="308" [attr.cy]="s.cy" r="3" fill="#f5a524" />
          <text
            x="320"
            [attr.y]="s.cy + 4"
            fill="#e6e9ef"
            font-size="11"
            font-family="monospace"
          >
            {{ s.name }}
          </text>
        </g>
      }

      <!-- travelling dots (transient particles) -->
      @for (s of specialists; track s.name) {
        <circle data-dot cx="0" cy="0" r="4" fill="#f5a524" opacity="0" />
      }

      <!-- skills library stack -->
      @for (l of layers; track l) {
        <rect
          data-layer
          x="556"
          [attr.y]="326 - (l + 1) * 30"
          width="96"
          height="26"
          rx="4"
          fill="#1a1d24"
          stroke="#f5a524"
          stroke-opacity="0.4"
        />
      }
      <text
        data-count
        x="604"
        y="212"
        fill="#f5a524"
        font-size="20"
        font-family="monospace"
        text-anchor="middle"
        font-weight="700"
      >
        03
      </text>
      <text
        x="604"
        y="196"
        fill="#5b616f"
        font-size="9"
        font-family="monospace"
        text-anchor="middle"
      >
        skills curator
      </text>
      <text
        x="604"
        y="348"
        fill="#5b616f"
        font-size="9"
        font-family="monospace"
        text-anchor="middle"
      >
        skills library
      </text>

      <!-- flying skill token (transient) -->
      <g data-skill opacity="0">
        <rect x="-22" y="-11" width="44" height="22" rx="4" fill="#f5a524" />
        <text
          x="0"
          y="4"
          fill="#0a0c10"
          font-size="9"
          font-family="monospace"
          text-anchor="middle"
          font-weight="700"
        >
          skill
        </text>
      </g>

      <text
        x="340"
        y="352"
        fill="#5b616f"
        font-size="9"
        font-family="monospace"
        text-anchor="middle"
      >
        orchestra canvas · 9 tiles · workflows library
      </text>
    </svg>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class OrchestraFanoutDiagramComponent {
  public readonly ariaLabel = input<string>(
    'Diagram: a main agent fans work to five specialists — architect, backend, ' +
      'frontend, tester, reviewer — along drawn edges; completed runs crystallize ' +
      'into skills that stack into a growing skills library counting up to three.',
  );

  protected readonly specialists: readonly Specialist[] = [
    'Architect',
    'Backend',
    'Frontend',
    'Tester',
    'Reviewer',
  ].map((name, i) => {
    const y = 36 + i * 66;
    const cy = y + 15;
    return { name, y, cy, edge: `M 128 172 C 214 172, 216 ${cy}, 300 ${cy}` };
  });

  protected readonly layers: readonly number[] = [0, 1, 2];

  private readonly targetY = [309, 279, 249];

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.buildDemo(this.host.nativeElement);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  private buildDemo(host: HTMLElement): void {
    const root = host.querySelector<SVGElement>('[data-root]');
    if (!root) return;

    const edges = gsap.utils.toArray<SVGPathElement>('[data-edge]', root);
    const specs = gsap.utils.toArray<SVGElement>('[data-spec]', root);
    const dots = gsap.utils.toArray<SVGElement>('[data-dot]', root);
    const layers = gsap.utils.toArray<SVGElement>('[data-layer]', root);
    const skill = root.querySelector<SVGElement>('[data-skill]');
    const count = root.querySelector<SVGElement>('[data-count]');

    const reset = (): void => {
      edges.forEach((e) =>
        gsap.set(e, { strokeDasharray: 1, strokeDashoffset: 1 }),
      );
      gsap.set(specs, { autoAlpha: 0.3 });
      gsap.set(dots, { autoAlpha: 0 });
      gsap.set(layers, { autoAlpha: 0 });
      if (skill) gsap.set(skill, { autoAlpha: 0, x: 360, y: 176 });
      if (count) count.textContent = '00';
    };

    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2, onRepeat: reset });

    edges.forEach((e, i) => {
      tl.to(
        e,
        { strokeDashoffset: 0, duration: 0.5, ease: 'power2.out' },
        0.1 + i * 0.1,
      );
    });

    dots.forEach((d, i) => {
      const edge = edges[i];
      const spec = specs[i];
      const at = 0.55 + i * 0.14;
      if (!edge) return;
      tl.set(d, { autoAlpha: 1 }, at);
      tl.to(
        d,
        {
          motionPath: { path: edge, align: edge, alignOrigin: [0.5, 0.5] },
          duration: 0.7,
          ease: 'power1.inOut',
        },
        at,
      );
      tl.to(d, { autoAlpha: 0, duration: 0.15 }, at + 0.7);
      if (spec) tl.to(spec, { autoAlpha: 1, duration: 0.3 }, at + 0.5);
    });

    // crystallize: three skill tokens fly onto the growing stack (01 → 03).
    let t = 2.1;
    this.layers.forEach((k) => {
      const layer = layers[k];
      if (skill) {
        tl.set(skill, { autoAlpha: 0, x: 360, y: 176 }, t);
        tl.to(skill, { autoAlpha: 1, duration: 0.2 }, t);
        tl.to(
          skill,
          { x: 604, y: this.targetY[k], duration: 0.55, ease: 'power2.inOut' },
          t + 0.2,
        );
        tl.to(skill, { autoAlpha: 0, duration: 0.15 }, t + 0.78);
      }
      if (layer) tl.to(layer, { autoAlpha: 1, duration: 0.3 }, t + 0.72);
      tl.call(
        () => {
          if (count) count.textContent = `0${k + 1}`;
        },
        undefined,
        t + 0.75,
      );
      t += 1;
    });
  }
}

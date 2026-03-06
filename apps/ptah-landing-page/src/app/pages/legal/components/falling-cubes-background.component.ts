import {
  Component,
  ChangeDetectionStrategy,
  inject,
  ElementRef,
  afterNextRender,
  DestroyRef,
  input,
} from '@angular/core';
import { GsapCoreService } from '@hive-academy/angular-gsap';

interface CubeConfig {
  id: number;
  left: number;
  size: number;
  topPercent: number;
  rotation: number;
  spinDuration: number;
  opacity: number;
}

/**
 * FallingCubesBackgroundComponent
 *
 * Decorative 3D cubes with the hieroglyph circuit pattern scattered across
 * the page. They drift downward as the user scrolls via GSAP ScrollTrigger.
 *
 * Placement: Inside <main> with position:absolute, overflow:hidden, and
 * pointer-events:none so they never interfere with text or links.
 *
 * Each cube is placed at a percentage of the container height and drifts
 * downward at its own parallax speed on scroll.
 */
@Component({
  selector: 'ptah-falling-cubes-background',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="falling-cubes-container" aria-hidden="true">
      @for (cube of cubes; track cube.id) {
      <div
        class="cube-wrapper"
        [attr.data-cube-id]="cube.id"
        [style.left.%]="cube.left"
        [style.top.%]="cube.topPercent"
        [style.width.px]="cube.size"
        [style.height.px]="cube.size"
        [style.opacity]="cube.opacity"
      >
        <div
          class="cube"
          [style.width.px]="cube.size"
          [style.height.px]="cube.size"
          [style.animation-duration]="cube.spinDuration + 's'"
        >
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="'translateZ(' + cube.size / 2 + 'px)'"
          ></div>
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="
              'rotateY(180deg) translateZ(' + cube.size / 2 + 'px)'
            "
            [style.background-position]="'50px 50px'"
          ></div>
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="
              'rotateY(90deg) translateZ(' + cube.size / 2 + 'px)'
            "
            [style.background-position]="'100px 0'"
          ></div>
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="
              'rotateY(-90deg) translateZ(' + cube.size / 2 + 'px)'
            "
            [style.background-position]="'0 100px'"
          ></div>
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="
              'rotateX(90deg) translateZ(' + cube.size / 2 + 'px)'
            "
            [style.background-position]="'50px 0'"
          ></div>
          <div
            class="cube-face"
            [style.width.px]="cube.size"
            [style.height.px]="cube.size"
            [style.transform]="
              'rotateX(-90deg) translateZ(' + cube.size / 2 + 'px)'
            "
            [style.background-position]="'0 50px'"
          ></div>
        </div>
      </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        z-index: 1;
      }

      .falling-cubes-container {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .cube-wrapper {
        position: absolute;
        perspective: 600px;
        will-change: transform;
      }

      .cube {
        transform-style: preserve-3d;
        animation: cube-idle-spin linear infinite;
      }

      .cube-face {
        position: absolute;
        top: 0;
        left: 0;
        backface-visibility: visible;
        background-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
        background-size: 200px 200px;
        background-repeat: repeat;
        border: 1px solid rgba(245, 158, 11, 0.12);
      }

      @keyframes cube-idle-spin {
        from {
          transform: rotateX(0deg) rotateY(0deg);
        }
        to {
          transform: rotateX(360deg) rotateY(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cube {
          animation: none;
        }
      }
    `,
  ],
})
export class FallingCubesBackgroundComponent {
  public readonly cubeCount = input(10);

  private readonly gsapService = inject(GsapCoreService);
  private readonly elRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  public cubes: CubeConfig[] = [];
  private scrollTriggers: { kill: () => void }[] = [];

  constructor() {
    this.generateCubes();

    afterNextRender(() => {
      this.setupScrollAnimations();
    });

    this.destroyRef.onDestroy(() => {
      this.scrollTriggers.forEach((st) => st.kill());
      this.scrollTriggers = [];
    });
  }

  private generateCubes(): void {
    const count = this.cubeCount();
    this.cubes = Array.from({ length: count }, (_, i) => {
      const size = 35 + Math.random() * 45; // 35-80px
      // Alternate left edge / right edge placement
      const isLeft = i % 2 === 0;
      const left = isLeft
        ? Math.random() * 12 // 0-12% (left edge)
        : 88 + Math.random() * 12; // 88-100% (right edge)
      return {
        id: i,
        left,
        size,
        // Distribute evenly across the page height with some randomness
        topPercent: (i / count) * 85 + Math.random() * 10,
        rotation: Math.random() * 360,
        spinDuration: 15 + Math.random() * 20, // 15-35s per full spin
        opacity: 0.08 + Math.random() * 0.1, // 8-18% — visible but subtle
      };
    });
  }

  private setupScrollAnimations(): void {
    const gsap = this.gsapService.gsap;
    const scrollTrigger = this.gsapService.scrollTrigger;
    if (!gsap || !scrollTrigger) return;

    const container = this.elRef.nativeElement as HTMLElement;
    const wrappers = container.querySelectorAll('.cube-wrapper');

    wrappers.forEach((wrapper, index) => {
      const cube = this.cubes[index];
      if (!cube) return;

      // Each cube drifts down at a different speed (parallax)
      const fallDistance = 80 + Math.random() * 200; // 80-280px drift

      const tween = gsap.to(wrapper, {
        y: fallDistance,
        ease: 'none',
        scrollTrigger: {
          trigger: container,
          start: 'top top',
          end: 'bottom top',
          scrub: 1 + Math.random() * 1.5, // 1-2.5 smoothness
        },
      });

      const st = (tween as unknown as { scrollTrigger: { kill: () => void } })
        .scrollTrigger;
      if (st) {
        this.scrollTriggers.push(st);
      }
    });
  }
}

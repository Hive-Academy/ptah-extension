import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

export interface FloatingGlyph {
  src: string;
  size: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  delay: number;
  duration: number;
}

@Component({
  selector: 'ptah-floating-glyphs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <div
      class="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      @for (glyph of glyphs(); track glyph.src + glyph.delay) {
        <div
          class="absolute glyph-float"
          [style.top]="glyph.top"
          [style.left]="glyph.left"
          [style.right]="glyph.right"
          [style.bottom]="glyph.bottom"
          [style.width.px]="glyph.size"
          [style.height.px]="glyph.size"
          [style.animation-delay.s]="glyph.delay"
          [style.animation-duration.s]="glyph.duration"
        >
          <img
            [ngSrc]="glyph.src"
            alt=""
            [width]="glyph.size"
            [height]="glyph.size"
            class="w-full h-full object-contain opacity-[0.28]"
          />
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .glyph-float {
        animation-name: glyph-drift;
        animation-timing-function: ease-in-out;
        animation-iteration-count: infinite;
      }
      @keyframes glyph-drift {
        0%,
        100% {
          transform: translateY(0) rotate(0deg);
        }
        50% {
          transform: translateY(-18px) rotate(3deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .glyph-float {
          animation: none;
        }
      }
    `,
  ],
})
export class FloatingGlyphsComponent {
  public readonly glyphs = input.required<FloatingGlyph[]>();
}

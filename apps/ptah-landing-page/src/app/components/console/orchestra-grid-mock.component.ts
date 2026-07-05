import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

interface CanvasTile {
  id: number;
  label: string;
  active: boolean;
  tall: boolean;
  wide: boolean;
  streaming: boolean;
}

/**
 * OrchestraGridMockComponent — the 3×3 agent-tile grid with the "streaming"
 * sweep micro-animation (design spec §4 S5, §7.4).
 *
 * Extracted from the retired `CanvasOrchestraComponent` (tile grid + tile-config
 * stagger), re-skinned from pharaoh-gold to console amber. The 3D tilt-on-hover
 * depth cue and the `stream-sweep` keyframe + its `prefers-reduced-motion` guard
 * are carried forward verbatim (SSG-safe: resting transform is a fixed non-zero
 * rotation, not JS-computed). Designed to sit inside `DeviceFrameComponent` and
 * to render standalone (default min-height + internal aspect).
 */
@Component({
  selector: 'ptah-orchestra-grid-mock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <div
      class="canvas-frame absolute inset-0 rounded-lg border border-amber-500/15 overflow-hidden bg-ink-900"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <div
        class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2 p-3"
        aria-hidden="true"
      >
        @for (tile of tiles(); track tile.id; let i = $index) {
          <div
            viewportAnimation
            [viewportConfig]="getTileConfig(i)"
            class="rounded-lg border border-amber-500/15 bg-ink-950/80 p-2.5 flex flex-col"
            [class.row-span-2]="tile.tall"
            [class.col-span-2]="tile.wide"
          >
            <div class="flex items-center gap-1.5 mb-2">
              @if (tile.active) {
                <span
                  class="w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
                ></span>
              } @else {
                <span class="w-1.5 h-1.5 rounded-full bg-ink-600"></span>
              }
              <span class="text-[10px] font-mono text-amber-500/70">{{
                tile.label
              }}</span>
            </div>
            <div class="space-y-1.5 flex-1">
              <div class="h-1.5 rounded-full bg-white/10 w-full"></div>
              <div class="h-1.5 rounded-full bg-white/10 w-4/5"></div>
              @if (tile.streaming) {
                <div class="h-1.5 rounded-full w-3/5 stream-line"></div>
              } @else {
                <div class="h-1.5 rounded-full w-3/5 bg-amber-500/20"></div>
              }
              @if (tile.tall) {
                <div class="h-1.5 rounded-full bg-white/10 w-5/6"></div>
                @if (tile.streaming) {
                  <div class="h-1.5 rounded-full w-2/3 stream-line"></div>
                } @else {
                  <div class="h-1.5 rounded-full w-2/3 bg-white/10"></div>
                }
              }
            </div>
          </div>
        }
      </div>
      <div
        class="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-ink-950 to-transparent pointer-events-none"
        aria-hidden="true"
      ></div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 260px;
        perspective: 1400px;
      }
      .canvas-frame {
        transform: rotateY(-8deg) rotateX(4deg);
        transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .canvas-frame:hover {
        transform: rotateY(0deg) rotateX(0deg);
      }
      .stream-line {
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.08) 0%,
          rgba(245, 165, 36, 0.45) 50%,
          rgba(255, 255, 255, 0.08) 100%
        );
        background-size: 200% 100%;
        animation: stream-sweep 2.4s linear infinite;
      }
      @keyframes stream-sweep {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .stream-line {
          animation: none;
          background-position: 50% 0;
        }
        .canvas-frame {
          transform: none;
        }
      }
    `,
  ],
})
export class OrchestraGridMockComponent {
  public readonly ariaLabel = input<string>(
    'Illustration of the Orchestra Canvas showing multiple active agent tiles streaming in a grid.',
  );

  public readonly tiles = input<readonly CanvasTile[]>([
    {
      id: 1,
      label: 'Claude',
      active: true,
      tall: true,
      wide: false,
      streaming: true,
    },
    {
      id: 2,
      label: 'Copilot',
      active: true,
      tall: false,
      wide: true,
      streaming: true,
    },
    {
      id: 3,
      label: 'Codex',
      active: false,
      tall: false,
      wide: false,
      streaming: false,
    },
    {
      id: 4,
      label: 'Ollama',
      active: true,
      tall: false,
      wide: false,
      streaming: true,
    },
    {
      id: 5,
      label: 'Agent 5',
      active: true,
      tall: false,
      wide: false,
      streaming: false,
    },
  ]);

  public getTileConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: 0.15 + index * 0.1,
      threshold: 0.2,
    };
  }
}

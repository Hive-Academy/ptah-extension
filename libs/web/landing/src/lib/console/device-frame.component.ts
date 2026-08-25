import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * DeviceFrameComponent — the canonical "this is real software" window-chrome
 * wrapper for every coded Operator Console mock and the demo video.
 *
 * Design spec §3.1: traffic-light title bar + optional live status badge, then
 * a projected body at a fixed aspect ratio. Pure DOM/CSS — SSG-safe (renders
 * identically at prerender and after hydration, no image decode).
 */
@Component({
  selector: 'ptah-device-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-xl border border-ink-700 bg-ink-900 shadow-device overflow-hidden"
    >
      <!-- Title bar -->
      <div
        class="h-9 flex items-center gap-2 px-4 bg-ink-800 border-b border-ink-700"
      >
        <span
          class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"
          aria-hidden="true"
        ></span>
        <span
          class="w-2.5 h-2.5 rounded-full bg-[#febc2e]"
          aria-hidden="true"
        ></span>
        <span
          class="w-2.5 h-2.5 rounded-full bg-[#28c840]"
          aria-hidden="true"
        ></span>
        <span class="font-mono text-xs text-ink-400 ml-2 truncate">{{
          title()
        }}</span>

        @if (liveLabel(); as label) {
          <span class="ml-auto flex items-center gap-1.5">
            <span
              class="w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
              aria-hidden="true"
            ></span>
            <span class="font-mono text-[11px] text-emerald-400">{{
              label
            }}</span>
          </span>
        }
      </div>

      <!-- Body -->
      <div class="relative bg-ink-950" [style.aspectRatio]="aspectRatio()">
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class DeviceFrameComponent {
  /** Title-bar label, e.g. "Ptah — Orchestra Canvas". */
  public readonly title = input.required<string>();

  /** Optional right-aligned live status badge, e.g. "9 agents active". */
  public readonly liveLabel = input<string | undefined>(undefined);

  /** Body aspect ratio. */
  public readonly aspect = input<'16/10' | '16/9'>('16/10');

  /** CSS `aspect-ratio` value derived from {@link aspect}. */
  public readonly aspectRatio = computed(() =>
    this.aspect().replace('/', ' / '),
  );
}

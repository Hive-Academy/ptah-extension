import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type GatewayStatus = 'Standby' | 'Connected';

export interface GatewayPlatform {
  readonly name: string;
  readonly status: GatewayStatus;
}

/**
 * GatewayMockComponent — coded messaging-gateway mock (design spec §4 S6).
 *
 * Three platform cards (Telegram / Discord / Slack). Connected platforms show an
 * emerald pulsing status dot ("reachable"); standby platforms are muted. Each
 * card carries 1–2 skeleton "recent message" bars. Illustrative → `role="img"` +
 * `aria-label`. The pulse uses `motion-safe:` so it self-disables under
 * reduced-motion.
 */
@Component({
  selector: 'ptah-gateway-mock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full w-full p-4 sm:p-5 flex flex-col sm:flex-row gap-3"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      @for (p of platforms(); track p.name) {
        <div
          class="flex-1 rounded-lg border border-ink-700 bg-ink-850 p-4 flex flex-col gap-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs sm:text-sm text-ink-100">{{
              p.name
            }}</span>
            @if (p.status === 'Connected') {
              <span class="flex items-center gap-1.5">
                <span
                  class="w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
                  aria-hidden="true"
                ></span>
                <span class="font-mono text-[11px] text-emerald-400"
                  >Connected</span
                >
              </span>
            } @else {
              <span class="font-mono text-[11px] text-ink-500">Standby</span>
            }
          </div>
          <div class="space-y-1.5">
            <div class="h-1.5 rounded-full bg-white/10 w-full"></div>
            <div class="h-1.5 rounded-full bg-white/10 w-2/3"></div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class GatewayMockComponent {
  public readonly platforms = input<readonly GatewayPlatform[]>([
    { name: 'Telegram', status: 'Standby' },
    { name: 'Discord', status: 'Connected' },
    { name: 'Slack', status: 'Standby' },
  ]);

  public readonly ariaLabel = input<string>(
    'Messaging gateway illustration: Telegram, Discord, and Slack cards — Discord connected and live, the others on standby.',
  );
}

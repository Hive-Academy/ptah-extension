import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';
import { OrchestraGridMockComponent } from '../../components/console/orchestra-grid-mock.component';

/**
 * HeroDeviceShowcaseComponent — the hero's proof-of-life visual (design spec §4 S1).
 *
 * Thin composition: a `DeviceFrameComponent` ("Ptah — Orchestra Canvas", live
 * "9 agents active") wrapping the reused `OrchestraGridMockComponent`. Carries
 * the page's single resting `shadow-glow-amber` signature (design §2.4 reserves
 * the amber glow for exactly the hero frame + primary CTA hover). Entrance is a
 * `scaleIn` — SSG-safe, since the resting state is fully visible.
 */
@Component({
  selector: 'ptah-hero-device-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewportAnimationDirective,
    DeviceFrameComponent,
    OrchestraGridMockComponent,
  ],
  template: `
    <div class="px-4 sm:px-6 pb-20 sm:pb-28">
      <div
        viewportAnimation
        [viewportConfig]="showcaseConfig"
        class="max-w-5xl mx-auto rounded-xl shadow-glow-amber"
      >
        <ptah-device-frame
          title="Ptah — Orchestra Canvas"
          liveLabel="9 agents active"
          aspect="16/10"
        >
          <ptah-orchestra-grid-mock />
        </ptah-device-frame>
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
export class HeroDeviceShowcaseComponent {
  /** Device-frame entrance — scale in. */
  public readonly showcaseConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.15,
  };
}

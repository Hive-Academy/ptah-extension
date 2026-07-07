import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { YouTubePlayer } from '@angular/youtube-player';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';

/**
 * VideoShowcaseComponent — S3 Demo (design spec §4 S3, copy deck S3).
 *
 * The one literal footage on the page (real product session). Operator Console
 * restyle: eyebrow `SEE IT WORK`, desktop-only H2/subhead, and the
 * `<youtube-player>` wrapped in a `DeviceFrameComponent` ("Ptah — Live Session").
 * `id="demo"` is the hero "Watch it work" anchor target. YouTube player renders
 * a static thumbnail at prerender → SSG-safe.
 */
@Component({
  selector: 'ptah-video-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, YouTubePlayer, DeviceFrameComponent],
  template: `
    <section
      id="demo"
      aria-label="See it work"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <!-- Background glow -->
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-amber-500/[0.04] rounded-full blur-[150px] pointer-events-none"
        aria-hidden="true"
      ></div>

      <div class="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
        <!-- Section header -->
        <div class="max-w-3xl mx-auto text-center mb-16">
          <span
            viewportAnimation
            [viewportConfig]="badgeConfig"
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >SEE IT WORK</span
          >

          <h2
            viewportAnimation
            [viewportConfig]="headlineConfig"
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            One Desktop App. Real Sessions.
          </h2>

          <p
            viewportAnimation
            [viewportConfig]="subtitleConfig"
            class="text-lg sm:text-xl text-ink-400 leading-relaxed"
          >
            No slideware — this is Ptah running against real projects: memory
            recall, sub-agent fan-out, and scheduled runs, captured as they
            happened.
          </p>
        </div>

        <!-- Video device frame -->
        <div
          viewportAnimation
          [viewportConfig]="videoConfig"
          class="max-w-5xl mx-auto"
        >
          <ptah-device-frame
            title="Ptah — Live Session"
            liveLabel="LIVE SESSION"
            aspect="16/9"
          >
            <div class="video-wrapper absolute inset-0">
              <youtube-player
                videoId="cRrwNahaEas"
                [disableCookies]="true"
                placeholderImageQuality="high"
              />
            </div>
          </ptah-device-frame>

          <p class="text-center text-sm text-ink-400 mt-5">
            Ptah desktop — memory recall, sub-agent fan-out, scheduled runs.
          </p>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .video-wrapper {
        position: absolute;
      }

      /* Force youtube-player to fill the device-frame body */
      .video-wrapper ::ng-deep youtube-player,
      .video-wrapper ::ng-deep iframe,
      .video-wrapper ::ng-deep .youtube-player-placeholder {
        width: 100% !important;
        height: 100% !important;
        position: absolute;
        top: 0;
        left: 0;
      }
    `,
  ],
})
export class VideoShowcaseComponent {
  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
  };

  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.25,
    threshold: 0.1,
  };

  public readonly videoConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.4,
    threshold: 0.1,
    ease: 'power2.out',
  };
}

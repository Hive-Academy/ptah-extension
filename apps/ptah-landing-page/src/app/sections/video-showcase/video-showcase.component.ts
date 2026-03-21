import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, Sparkles } from 'lucide-angular';
import { YouTubePlayer } from '@angular/youtube-player';

@Component({
  selector: 'ptah-video-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, LucideAngularModule, YouTubePlayer],
  template: `
    <section class="relative bg-slate-950 py-24 sm:py-32 overflow-hidden">
      <!-- Background glow -->
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-[#d4af37]/[0.03] rounded-full blur-[150px] pointer-events-none"
        aria-hidden="true"
      ></div>

      <div class="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
        <!-- Badge -->
        <div
          viewportAnimation
          [viewportConfig]="badgeConfig"
          class="text-center mb-6"
        >
          <span
            class="inline-flex items-center gap-2 px-5 py-2 bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-full text-sm font-semibold text-[#f4d47c]"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            WHAT PTAH OFFERS
          </span>
        </div>

        <!-- Headline -->
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-center text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight"
        >
          Everything You Need to
          <span
            class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
          >
            Ship Faster
          </span>
        </h2>

        <!-- Subtitle -->
        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-center text-lg sm:text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto mb-14"
        >
          See Ptah in action — one harness, every model, total control
        </p>

        <!-- Video Card -->
        <div
          viewportAnimation
          [viewportConfig]="videoConfig"
          class="video-card relative w-full max-w-5xl mx-auto rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm"
        >
          <!-- Video Player -->
          <div class="video-wrapper aspect-video rounded-t-2xl overflow-hidden">
            <youtube-player
              videoId="cRrwNahaEas"
              [disableCookies]="true"
              placeholderImageQuality="high"
            />
          </div>

          <!-- Bottom Sheet -->
          <div class="px-6 py-5 border-t border-white/[0.06]">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-white font-semibold text-base sm:text-lg">
                  Ptah — AI Coding Orchestra
                </h3>
                <p class="text-gray-500 text-sm mt-0.5">
                  Full showcase walkthrough
                </p>
              </div>
              <span
                class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 text-xs font-medium text-[#f4d47c]"
              >
                HD 1080p
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .video-card {
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05),
          0 25px 60px -12px rgba(0, 0, 0, 0.6),
          0 0 40px rgba(212, 175, 55, 0.08), 0 0 80px rgba(212, 175, 55, 0.04);
      }

      .video-wrapper {
        position: relative;
      }

      /* Force youtube-player to fill the container */
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
  public readonly SparklesIcon = Sparkles;

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

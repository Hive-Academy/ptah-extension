import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, CirclePlay, Download } from 'lucide-angular';

/**
 * HeroContentOverlayComponent — the centered hero text block (design spec §4 S1).
 *
 * Operator Console rebuild: eyebrow pill → H1 wedge → subhead → two CTAs
 * (primary Download, secondary "Watch it work") → mono stat row. Entrance is
 * staggered via `ViewportAnimationDirective` (final DOM state is fully opaque
 * and positioned — the directive applies the `from` state via JS post-hydration,
 * never as a static class), so the copy lands intact in the prerendered HTML.
 */
@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, RouterLink, LucideAngularModule],
  template: `
    <div class="max-w-3xl mx-auto text-center pt-40 pb-16 px-6">
      <!-- Eyebrow pill -->
      <div
        viewportAnimation
        [viewportConfig]="badgeConfig"
        class="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full bg-amber-500/10 border border-amber-500/20"
      >
        <span
          class="w-1.5 h-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse"
          aria-hidden="true"
        ></span>
        <span
          class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/90"
          >PERSISTENT · MULTI-AGENT · ALWAYS ON</span
        >
      </div>

      <!-- Main Headline (the wedge) -->
      <h1
        viewportAnimation
        [viewportConfig]="headlineConfig"
        class="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-extrabold tracking-tight leading-[0.95] text-white"
      >
        Your AI Employee, Not Your Autocomplete.
      </h1>

      <!-- Subheadline -->
      <p
        viewportAnimation
        [viewportConfig]="subheadlineConfig"
        class="text-lg sm:text-xl text-ink-300 max-w-2xl mx-auto leading-relaxed mt-6"
      >
        Ptah is a desktop AI coding agent that remembers your codebase, runs up
        to nine agents in parallel, works on a schedule while you're away, and
        takes instructions from Telegram, Discord, or Slack. Bring your own
        model — Claude, GitHub Copilot, OpenAI Codex, OpenRouter, local Ollama,
        Kimi K2, or GLM.
      </p>

      <!-- CTA row -->
      <div
        viewportAnimation
        [viewportConfig]="ctaConfig"
        class="flex flex-col sm:flex-row gap-4 justify-center items-center mt-10"
      >
        <!-- Primary: Download -->
        <div class="flex flex-col items-center w-full sm:w-auto">
          <a
            routerLink="/download"
            class="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm sm:text-base transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            aria-label="Download the Ptah desktop app"
          >
            <lucide-angular
              [img]="DownloadIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Download Ptah
          </a>
          <span class="text-xs text-ink-500 mt-2 text-center"
            >100 days free. No credit card.</span
          >
        </div>

        <!-- Secondary ghost: Watch it work -->
        <a
          href="#demo"
          class="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-ink-600 text-ink-100 font-medium text-sm sm:text-base transition-colors duration-200 hover:border-amber-500/40 hover:text-white hover:bg-ink-850 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Watch Ptah in action"
        >
          <lucide-angular [img]="PlayIcon" class="w-4 h-4" aria-hidden="true" />
          Watch it work
        </a>
      </div>

      <!-- Stat row -->
      <div
        viewportAnimation
        [viewportConfig]="socialProofConfig"
        class="grid grid-cols-2 sm:flex sm:justify-center gap-x-8 gap-y-4 mt-14"
      >
        @for (stat of stats; track stat.label) {
          <div class="flex flex-col items-center text-center">
            <span
              class="font-mono text-3xl sm:text-4xl font-bold text-white leading-none"
              >{{ stat.value }}</span
            >
            <span class="text-xs sm:text-sm text-ink-400 mt-1.5">{{
              stat.label
            }}</span>
          </div>
        }
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
export class HeroContentOverlayComponent {
  public readonly DownloadIcon = Download;
  public readonly PlayIcon = CirclePlay;

  public readonly stats = [
    { value: '9', label: 'concurrent agent tiles' },
    { value: '7', label: 'model providers, zero lock-in' },
    { value: '100-day', label: 'free trial' },
    { value: '3', label: 'platforms: Windows, macOS, Linux' },
  ];

  /** Eyebrow pill entrance — quick scale in. */
  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
  };

  /** Headline entrance — slide up. */
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.15,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /** Subheadline — fade in after headline. */
  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.3,
    threshold: 0.1,
  };

  /** CTAs — slide up together. */
  public readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.45,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /** Stats — fade in last. */
  public readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.6,
    threshold: 0.1,
  };
}

import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Globe,
  ArrowRight,
  Repeat,
  Server,
  Play,
} from 'lucide-angular';

import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';

@Component({
  selector: 'ptah-docs-providers-api',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsSectionShellComponent,
    DocsCollapsibleCardComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="providers">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Provider APIs
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-4 max-w-2xl"
      >
        Ptah supports multiple AI providers out of the box. Bring your own API
        key from any supported provider and use Ptah's full agentic coding
        experience
        <strong class="text-base-content/70"
          >with the model of your choice</strong
        >
        — pay only through your provider's billing.
      </p>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content/60 text-sm mb-8 max-w-2xl"
      >
        Each provider integrates through a compatible API protocol, so Ptah
        routes requests seamlessly. Your credentials for each provider are
        stored independently.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- OpenRouter -->
        <ptah-docs-collapsible-card
          [icon]="GlobeIcon"
          title="OpenRouter"
          subtitle="200+ models through a single API key"
          [expanded]="true"
        >
          <p class="text-sm text-neutral-content mb-4">
            OpenRouter is a multi-provider gateway giving you access to models
            from Anthropic, OpenAI, Google, Meta, and many more — all through
            one API key. Models and pricing are fetched dynamically at startup.
          </p>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs text-neutral-content/60">Key format:</span>
            <code
              class="px-1.5 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/80"
              >sk-or-v1-...</code
            >
          </div>
          <p class="text-sm text-neutral-content">
            Get your key at
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              class="text-secondary hover:text-secondary/80 underline underline-offset-2"
              >openrouter.ai/keys</a
            >.
          </p>
        </ptah-docs-collapsible-card>

        <!-- Moonshot (Kimi) -->
        <ptah-docs-collapsible-card
          [icon]="ServerIcon"
          title="Moonshot (Kimi)"
          subtitle="Kimi K2 models with extended thinking"
        >
          <p class="text-sm text-neutral-content mb-4">
            Moonshot AI's Kimi models provide competitive coding performance at
            lower price points. Kimi K2 supports up to 256K context and extended
            thinking for complex reasoning tasks.
          </p>

          <h4 class="text-sm font-semibold text-base-content/70 mb-2">
            Available models:
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            @for (model of moonshotModels; track model.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/50 border border-secondary/10"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-secondary/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-base-content/70">{{ model.name }}</span>
              <span
                class="text-xs text-neutral-content/40 ml-auto whitespace-nowrap"
                >{{ model.note }}</span
              >
            </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Z.AI (GLM) -->
        <ptah-docs-collapsible-card
          [icon]="ServerIcon"
          title="Z.AI (GLM)"
          subtitle="GLM-5 &amp; GLM-4 families with free-tier models"
        >
          <p class="text-sm text-neutral-content mb-4">
            Z.AI's GLM models offer strong multilingual performance. The GLM-5
            family brings Opus-class intelligence and code-optimized variants,
            while GLM-4.7 Flash and GLM-4.5 Flash include free tiers — great for
            getting started at no cost.
          </p>

          <h4 class="text-sm font-semibold text-base-content/70 mb-2">
            Available models:
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            @for (model of glmModels; track model.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/50 border border-secondary/10"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-secondary/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-base-content/70">{{ model.name }}</span>
              <span
                class="text-xs text-neutral-content/40 ml-auto whitespace-nowrap"
                >{{ model.note }}</span
              >
            </div>
            }
          </div>
        </ptah-docs-collapsible-card>

        <!-- Model Tier Mapping -->
        <ptah-docs-collapsible-card
          [icon]="RepeatIcon"
          title="Model Tier Mapping"
        >
          <p class="text-sm text-neutral-content mb-4">
            When using a third-party provider, Ptah maps capability tiers (Opus,
            Sonnet, Haiku) to the provider's actual models. You can customize
            which model handles each tier from the settings.
          </p>
          <div class="space-y-2">
            @for (tier of modelTiers; track tier.name) {
            <div
              class="flex items-center gap-3 px-3 py-2 rounded-lg bg-base-300/30 border border-secondary/10"
            >
              <span class="text-sm font-medium text-secondary/80 w-16">{{
                tier.name
              }}</span>
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-neutral-content/20"
                aria-hidden="true"
              />
              <span class="text-sm text-neutral-content">{{
                tier.description
              }}</span>
            </div>
            }
          </div>
          <p class="text-xs text-neutral-content/40 mt-3">
            Example: Map Opus to
            <code class="text-secondary/60">kimi-k2</code> so when Ptah requests
            the Opus tier, it uses Kimi K2 via Moonshot.
          </p>
        </ptah-docs-collapsible-card>
      </div>

      <ng-container media>
        <div
          class="group relative cursor-pointer"
          (click)="toggleVideo($event)"
        >
          <video
            muted
            loop
            playsinline
            preload="metadata"
            class="w-full rounded-xl border border-white/10 shadow-2xl"
          >
            <source src="assets/videos/providers.mp4" type="video/mp4" />
          </video>
          <div
            class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 transition-opacity duration-300 pointer-events-none"
            [class.opacity-0]="isPlaying()"
            [class.opacity-100]="!isPlaying()"
          >
            <div
              class="w-20 h-20 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-xl"
            >
              <lucide-icon
                [img]="PlayIcon"
                class="w-10 h-10 text-slate-900 ml-1"
                [size]="40"
              />
            </div>
          </div>
        </div>
      </ng-container>
    </ptah-docs-section-shell>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersApiSectionComponent {
  public readonly GlobeIcon = Globe;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly RepeatIcon = Repeat;
  public readonly ServerIcon = Server;
  public readonly PlayIcon = Play;

  public readonly moonshotModels = [
    { name: 'kimi-k2', note: '128K ctx' },
    { name: 'kimi-k2-0905-preview', note: '256K ctx' },
    { name: 'kimi-k2-thinking', note: 'extended thinking' },
    { name: 'kimi-k2.5', note: '256K ctx' },
  ];

  public readonly glmModels = [
    { name: 'GLM-5', note: 'Opus-class, 200K ctx' },
    { name: 'GLM-5 Code', note: 'code-optimized, 200K ctx' },
    { name: 'GLM-4.7', note: '200K ctx' },
    { name: 'GLM-4.7 FlashX', note: '200K ctx' },
    { name: 'GLM-4.7 Flash', note: 'free tier' },
    { name: 'GLM-4.6', note: '200K ctx' },
    { name: 'GLM-4.5-X', note: 'extended thinking, 128K ctx' },
    { name: 'GLM-4.5', note: '128K ctx' },
    { name: 'GLM-4.5 AirX', note: 'accelerated MoE, 128K ctx' },
    { name: 'GLM-4.5 Air', note: 'lightweight, 128K ctx' },
    { name: 'GLM-4.5 Flash', note: 'free tier, 128K ctx' },
  ];

  public readonly modelTiers = [
    {
      name: 'Opus',
      description: 'Most capable tier — best for complex coding tasks',
    },
    {
      name: 'Sonnet',
      description: 'Balanced tier — good performance at lower cost',
    },
    { name: 'Haiku', description: 'Fast tier — ideal for quick, simple tasks' },
  ];

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly introConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly contentConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.1,
  };

  public readonly isPlaying = signal(false);

  public toggleVideo(event: MouseEvent): void {
    const container = event.currentTarget as HTMLElement;
    const video = container.querySelector('video');
    if (!video) return;
    if (video.paused) {
      video.play();
      this.isPlaying.set(true);
    } else {
      video.pause();
      this.isPlaying.set(false);
    }
  }
}

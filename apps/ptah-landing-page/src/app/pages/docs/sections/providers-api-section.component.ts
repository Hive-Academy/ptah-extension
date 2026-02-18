import { Component, ChangeDetectionStrategy } from '@angular/core';
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
} from 'lucide-angular';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-providers-api',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="providers">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Provider APIs
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-4 max-w-2xl"
      >
        Ptah supports three Anthropic-compatible third-party providers. These
        let you use Ptah's full coding agent experience
        <strong class="text-white/70">without a Claude subscription</strong> —
        you bring your own API key from the provider and pay through their
        billing.
      </p>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/40 text-sm mb-8 max-w-2xl"
      >
        Each provider speaks the Anthropic API protocol, so Ptah routes requests
        seamlessly by setting a custom base URL. Your credentials for each
        provider are stored independently.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- OpenRouter -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="GlobeIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">OpenRouter</h3>
              <span class="text-xs text-white/40"
                >200+ models through a single API key</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            OpenRouter is a multi-provider gateway giving you access to models
            from Anthropic, OpenAI, Google, Meta, and many more — all through
            one API key. Models and pricing are fetched dynamically at startup.
          </p>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs text-white/40">Key format:</span>
            <code
              class="px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
              >sk-or-v1-...</code
            >
          </div>
          <p class="text-sm text-white/50">
            Get your key at
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              class="text-amber-400 hover:text-amber-300 underline underline-offset-2"
              >openrouter.ai/keys</a
            >.
          </p>
        </div>

        <!-- Moonshot (Kimi) -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ServerIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">
                Moonshot (Kimi)
              </h3>
              <span class="text-xs text-white/40"
                >Kimi K2 models with extended thinking</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Moonshot AI's Kimi models provide competitive coding performance at
            lower price points. Kimi K2 supports up to 256K context and extended
            thinking for complex reasoning tasks.
          </p>

          <h4 class="text-sm font-semibold text-white/70 mb-2">
            Available models:
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            @for (model of moonshotModels; track model.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-amber-400/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-white/70">{{ model.name }}</span>
              <span class="text-xs text-white/30 ml-auto whitespace-nowrap">{{
                model.note
              }}</span>
            </div>
            }
          </div>
        </div>

        <!-- Z.AI (GLM) -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ServerIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">Z.AI (GLM)</h3>
              <span class="text-xs text-white/40"
                >GLM-4 family with free-tier flash model</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Z.AI's GLM models offer strong multilingual performance. The GLM-4.7
            Flash model includes a free tier, making it a great option for
            getting started at no cost.
          </p>

          <h4 class="text-sm font-semibold text-white/70 mb-2">
            Available models:
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            @for (model of glmModels; track model.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-amber-400/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-white/70">{{ model.name }}</span>
              <span class="text-xs text-white/30 ml-auto whitespace-nowrap">{{
                model.note
              }}</span>
            </div>
            }
          </div>
        </div>

        <!-- Model Tier Mapping -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="RepeatIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">
              Model Tier Mapping
            </h3>
          </div>
          <p class="text-sm text-white/50 mb-4">
            When using a third-party provider, Ptah maps Claude's model tiers
            (Opus, Sonnet, Haiku) to the provider's actual models. You can
            customize which model handles each tier from the settings.
          </p>
          <div class="space-y-2">
            @for (tier of modelTiers; track tier.name) {
            <div
              class="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <span class="text-sm font-medium text-amber-400/80 w-16">{{
                tier.name
              }}</span>
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-white/20"
                aria-hidden="true"
              />
              <span class="text-sm text-white/50">{{ tier.description }}</span>
            </div>
            }
          </div>
          <p class="text-xs text-white/30 mt-3">
            Example: Map Opus to
            <code class="text-amber-400/60">kimi-k2</code> so when Ptah requests
            Claude Opus, it uses Kimi K2 via Moonshot.
          </p>
        </div>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="Configuring Third-Party Providers"
          aspectRatio="16/9"
          mediaType="gif"
        />
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

  public readonly moonshotModels = [
    { name: 'kimi-k2', note: '128K ctx' },
    { name: 'kimi-k2-0905-preview', note: '256K ctx' },
    { name: 'kimi-k2-thinking', note: 'extended thinking' },
    { name: 'kimi-k2.5', note: '256K ctx' },
  ];

  public readonly glmModels = [
    { name: 'GLM-4.7', note: '200K ctx' },
    { name: 'GLM-4.7 FlashX', note: '200K ctx' },
    { name: 'GLM-4.7 Flash', note: 'free tier' },
    { name: 'GLM-4.6', note: '200K ctx' },
    { name: 'GLM-4.5', note: '128K ctx' },
    { name: 'GLM-4.5 Air', note: 'lightweight' },
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
}

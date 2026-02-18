import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Key,
  ShieldCheck,
  Cpu,
  Layers,
  Settings,
} from 'lucide-angular';
import { DocsStepCardComponent } from '../components/docs-step-card.component';
import { DocsCodeBlockComponent } from '../components/docs-code-block.component';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-authentication',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsStepCardComponent,
    DocsCodeBlockComponent,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="authentication">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Authentication Setup
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-4 max-w-2xl"
      >
        Ptah offers five authentication methods. Choose the one that matches
        your subscription or preferred provider.
      </p>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/40 text-sm mb-8 max-w-2xl"
      >
        Open the Ptah sidebar → click the
        <strong class="text-white/60">gear icon</strong> to access settings.
        You'll see five tabs: <strong class="text-white/60">Provider</strong>,
        <strong class="text-white/60">OAuth</strong>,
        <strong class="text-white/60">API Key</strong>, and
        <strong class="text-white/60">Auto</strong>.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- OAuth Token -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ShieldCheckIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">OAuth Token</h3>
              <span class="text-xs text-amber-400/60"
                >Claude Max / Pro subscription</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            If you have a Claude Max or Pro subscription, use your OAuth token.
            This covers usage under your existing subscription — no per-token
            charges.
          </p>

          <div class="space-y-4">
            <ptah-docs-step-card [stepNumber]="1" title="Generate your token">
              <p>Open a terminal and run:</p>
              <div class="mt-2">
                <ptah-docs-code-block
                  code="claude setup-token"
                  label="Terminal"
                />
              </div>
            </ptah-docs-step-card>

            <ptah-docs-step-card
              [stepNumber]="2"
              title="Copy and paste into Ptah"
            >
              <p>
                Follow the terminal prompts. Once complete, copy the token
                (starts with
                <code
                  class="px-1 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
                  >sk-ant-oat01-</code
                >) and paste it in the
                <strong class="text-white/80">OAuth</strong> tab in Ptah
                settings.
              </p>
            </ptah-docs-step-card>
          </div>
        </div>

        <!-- API Key -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="KeyIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">API Key</h3>
              <span class="text-xs text-amber-400/60"
                >Anthropic Console — pay-per-token</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Use a direct Anthropic API key for pay-per-token billing. No
            subscription required — you pay only for what you use.
          </p>

          <div class="space-y-4">
            <ptah-docs-step-card [stepNumber]="1" title="Get your API key">
              <p>
                Go to
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                  >console.anthropic.com/settings/keys</a
                >
                → Create Key. Keys start with
                <code
                  class="px-1 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
                  >sk-ant-api03-</code
                >.
              </p>
            </ptah-docs-step-card>

            <ptah-docs-step-card
              [stepNumber]="2"
              title="Enter in Ptah settings"
            >
              <p>
                Open Ptah settings →
                <strong class="text-white/80">API Key</strong> tab → paste your
                key → Save &amp; Test.
              </p>
            </ptah-docs-step-card>
          </div>
        </div>

        <!-- Third-party Providers -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="LayersIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">Provider</h3>
              <span class="text-xs text-amber-400/60"
                >OpenRouter, Moonshot (Kimi), Z.AI (GLM) — no Claude
                subscription needed</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50 mb-4">
            Use third-party AI providers with your own API key from that
            provider. These providers speak an Anthropic-compatible API, so Ptah
            routes requests through them seamlessly —
            <strong class="text-white/70"
              >no Claude subscription required</strong
            >.
          </p>
          <p class="text-sm text-white/50 mb-4">
            Select the <strong class="text-white/80">Provider</strong> tab,
            choose your provider from the dropdown, and enter your API key. Each
            provider's key is stored separately, so you can switch between
            providers without losing credentials.
          </p>
          <p class="text-sm text-white/40 italic">
            See the
            <a
              href="#providers"
              class="text-amber-400/80 hover:text-amber-300 underline underline-offset-2"
              >Provider APIs</a
            >
            section below for details on each provider and their available
            models.
          </p>
        </div>

        <!-- Auto Mode -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="SettingsIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white/90">Auto</h3>
              <span class="text-xs text-amber-400/60"
                >Tries all configured credentials automatically</span
              >
            </div>
          </div>
          <p class="text-sm text-white/50">
            Auto mode detects and uses the first available credential in
            priority order:
            <strong class="text-white/70"> Provider → OAuth → API Key</strong>.
            Configure multiple credentials and Ptah will use whichever is
            available. All credential fields are shown simultaneously in this
            mode.
          </p>
        </div>
      </div>

      <!-- Test connection tip -->
      <div
        viewportAnimation
        [viewportConfig]="tipConfig"
        class="mt-8 flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15"
      >
        <lucide-angular
          [img]="ShieldCheckIcon"
          class="w-5 h-5 text-green-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p class="text-sm text-white/60">
          <strong class="text-white/80">Always test your connection:</strong>
          After entering credentials, click
          <strong class="text-white/80">Save &amp; Test Connection</strong>.
          Ptah will verify your credentials are valid and show a success or
          error message with specific troubleshooting tips.
        </p>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="Setting Up Authentication"
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
export class AuthenticationSectionComponent {
  public readonly KeyIcon = Key;
  public readonly ShieldCheckIcon = ShieldCheck;
  public readonly CpuIcon = Cpu;
  public readonly LayersIcon = Layers;
  public readonly SettingsIcon = Settings;

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

  public readonly tipConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
  };
}

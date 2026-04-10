import { Component, ChangeDetectionStrategy } from '@angular/core';

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
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsVideoPlayerComponent } from '../components/docs-video-player.component';

@Component({
  selector: 'ptah-docs-authentication',
  imports: [
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsStepCardComponent,
    DocsCodeBlockComponent,
    DocsCollapsibleCardComponent,
    DocsSectionShellComponent,
    DocsVideoPlayerComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="authentication">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Authentication Setup
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-4 max-w-2xl"
      >
        Ptah offers multiple authentication methods. Choose whichever fits your
        workflow — all options are fully supported.
      </p>
      <div
        viewportAnimation
        [viewportConfig]="introConfig"
        class="flex items-start gap-2.5 p-3 rounded-lg bg-success/10 border border-success/20 mb-4 max-w-2xl"
      >
        <lucide-angular
          [img]="ShieldCheckIcon"
          class="w-4 h-4 text-success shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p class="text-sm text-neutral-content">
          <strong class="text-base-content/80">Runs 100% locally.</strong>
          All AI integrations in Ptah execute directly on your machine. Your
          credentials and requests never pass through our servers — there are no
          proxies, no middleware, no data collection. The connection goes
          straight from your machine to the AI provider.
        </p>
      </div>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content/60 text-sm mb-8 max-w-2xl"
      >
        Open the Ptah sidebar → click the
        <strong class="text-neutral-content">gear icon</strong> to access
        settings. You'll see four tabs:
        <strong class="text-neutral-content">Provider</strong>,
        <strong class="text-neutral-content">OAuth</strong>,
        <strong class="text-neutral-content">API Key</strong>, and
        <strong class="text-neutral-content">Auto</strong>.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- OAuth Token -->
        <ptah-docs-collapsible-card
          [icon]="ShieldCheckIcon"
          title="OAuth Token"
          subtitle="Claude Max / Pro subscription"
        >
          <p class="text-sm text-neutral-content mb-4">
            Use your Claude subscription token for direct access. Since Ptah
            runs entirely on your local machine with no server proxy, your token
            is used the same way Claude Code uses it.
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
                  class="px-1 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/80"
                  >sk-ant-oat01-</code
                >) and paste it in the
                <strong class="text-base-content/80">OAuth</strong> tab in Ptah
                settings.
              </p>
            </ptah-docs-step-card>
          </div>
        </ptah-docs-collapsible-card>

        <!-- API Key -->
        <ptah-docs-collapsible-card
          [icon]="KeyIcon"
          title="API Key"
          subtitle="Anthropic Console — pay-per-token (Recommended)"
          [expanded]="true"
        >
          <p class="text-sm text-neutral-content mb-4">
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
                  class="text-secondary hover:text-secondary/80 underline underline-offset-2"
                  >console.anthropic.com/settings/keys</a
                >
                → Create Key. Keys start with
                <code
                  class="px-1 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/80"
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
                <strong class="text-base-content/80">API Key</strong> tab →
                paste your key → Save &amp; Test.
              </p>
            </ptah-docs-step-card>
          </div>
        </ptah-docs-collapsible-card>

        <!-- Third-party Providers -->
        <ptah-docs-collapsible-card
          [icon]="LayersIcon"
          title="Provider"
          subtitle="OpenRouter, Moonshot (Kimi), Z.AI (GLM) — no Claude subscription needed"
        >
          <p class="text-sm text-neutral-content mb-4">
            Use third-party AI providers with your own API key from that
            provider. These providers speak an Anthropic-compatible API, so Ptah
            routes requests through them seamlessly —
            <strong class="text-base-content/70"
              >no Claude subscription required</strong
            >.
          </p>
          <p class="text-sm text-neutral-content mb-4">
            Select the
            <strong class="text-base-content/80">Provider</strong> tab, choose
            your provider from the dropdown, and enter your API key. Each
            provider's key is stored separately, so you can switch between
            providers without losing credentials.
          </p>
          <p class="text-sm text-neutral-content/60 italic">
            See the
            <a
              href="#providers"
              class="text-secondary/80 hover:text-secondary/80 underline underline-offset-2"
              >Provider APIs</a
            >
            section below for details on each provider and their available
            models.
          </p>
        </ptah-docs-collapsible-card>

        <!-- Auto Mode -->
        <ptah-docs-collapsible-card
          [icon]="SettingsIcon"
          title="Auto"
          subtitle="Tries all configured credentials automatically"
        >
          <p class="text-sm text-neutral-content">
            Auto mode detects and uses the first available credential in
            priority order:
            <strong class="text-base-content/70">
              Provider → OAuth → API Key</strong
            >. Configure multiple credentials and Ptah will use whichever is
            available. All credential fields are shown simultaneously in this
            mode.
          </p>
        </ptah-docs-collapsible-card>
      </div>

      <!-- Test connection tip -->
      <div
        viewportAnimation
        [viewportConfig]="tipConfig"
        class="mt-8 flex items-start gap-3 p-4 rounded-xl bg-secondary/5 border border-secondary/20"
      >
        <lucide-angular
          [img]="ShieldCheckIcon"
          class="w-5 h-5 text-success shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p class="text-sm text-neutral-content">
          <strong class="text-base-content/80"
            >Always test your connection:</strong
          >
          After entering credentials, click
          <strong class="text-base-content/80"
            >Save &amp; Test Connection</strong
          >. Ptah will verify your credentials are valid and show a success or
          error message with specific troubleshooting tips.
        </p>
      </div>

      <ng-container media>
        <ptah-docs-video-player src="assets/videos/auth.mp4" />
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

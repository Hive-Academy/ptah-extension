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
  Terminal,
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
        How Ptah Uses the Claude CLI
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-4 max-w-2xl"
      >
        Ptah integrates with the official Claude Agent SDK, which spawns the
        Claude CLI binary directly on your machine. There is no proxy, no
        middleware, and no token collection — the CLI uses its own credential
        store, exactly the same way it works when you run it in a terminal.
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
          credentials never pass through our servers — the connection goes
          straight from your machine to the AI provider.
        </p>
      </div>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- Claude CLI (Primary) -->
        <ptah-docs-collapsible-card
          [icon]="TerminalIcon"
          title="Claude CLI"
          subtitle="Official Claude Agent SDK — primary integration"
          [expanded]="true"
        >
          <p class="text-sm text-neutral-content mb-4">
            Ptah spawns the Claude CLI binary via the official Agent SDK. The
            CLI handles its own authentication using credentials from
            <code
              class="px-1 py-0.5 rounded bg-base-300 border border-secondary/10 text-xs font-mono text-secondary/80"
              >claude auth login</code
            >. Ptah never sees, stores, or transmits your login credentials.
          </p>

          <div class="space-y-4">
            <ptah-docs-step-card
              [stepNumber]="1"
              title="Install the Claude CLI"
            >
              <p>Install the Claude CLI globally via npm:</p>
              <div class="mt-2">
                <ptah-docs-code-block
                  code="npm install -g @anthropic-ai/claude-code"
                  label="Terminal"
                />
              </div>
            </ptah-docs-step-card>

            <ptah-docs-step-card [stepNumber]="2" title="Authenticate">
              <p>
                Sign in with your Anthropic account. This stores credentials in
                the CLI's own credential store — Ptah does not access or manage
                them.
              </p>
              <div class="mt-2">
                <ptah-docs-code-block
                  code="claude auth login"
                  label="Terminal"
                />
              </div>
            </ptah-docs-step-card>

            <ptah-docs-step-card [stepNumber]="3" title="Open Ptah">
              <p>
                That's it. Ptah automatically detects the Claude CLI and uses it
                for all agent sessions. No additional configuration needed.
              </p>
            </ptah-docs-step-card>
          </div>
        </ptah-docs-collapsible-card>

        <!-- API Key (Alternative) -->
        <ptah-docs-collapsible-card
          [icon]="KeyIcon"
          title="API Key"
          subtitle="Anthropic Console — pay-per-token alternative"
        >
          <p class="text-sm text-neutral-content mb-4">
            Alternatively, use a direct Anthropic API key for pay-per-token
            billing. No subscription required — you pay only for what you use.
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
                → Create Key.
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
          title="Third-Party Providers"
          subtitle="OpenRouter, Moonshot (Kimi), Z.AI (GLM) — bring your own key"
        >
          <p class="text-sm text-neutral-content mb-4">
            Use third-party AI providers with your own API key. These providers
            speak an Anthropic-compatible API, so Ptah routes requests through
            them seamlessly —
            <strong class="text-base-content/70"
              >no Claude subscription required</strong
            >.
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
  public readonly TerminalIcon = Terminal;
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

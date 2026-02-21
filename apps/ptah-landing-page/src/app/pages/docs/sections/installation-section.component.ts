import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Download,
  UserPlus,
  Sparkles,
} from 'lucide-angular';
import { DocsStepCardComponent } from '../components/docs-step-card.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-installation',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsStepCardComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="installation">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-8"
      >
        Installation &amp; Pro Trial
      </h2>

      <div class="space-y-6" viewportAnimation [viewportConfig]="contentConfig">
        <ptah-docs-step-card
          [stepNumber]="1"
          title="Install from VS Code Marketplace"
        >
          <p class="mb-2">
            Open VS Code and search for
            <strong class="text-white/80">"Ptah"</strong> in the Extensions
            panel (<kbd
              class="px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
              >Ctrl+Shift+X</kbd
            >), or install directly from the
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
              target="_blank"
              rel="noopener noreferrer"
              class="text-amber-400 hover:text-amber-300 underline underline-offset-2"
              >VS Code Marketplace</a
            >.
          </p>
        </ptah-docs-step-card>

        <ptah-docs-step-card [stepNumber]="2" title="Create your Ptah account">
          <p>
            Visit
            <a
              href="https://ptah.live/signup"
              class="text-amber-400 hover:text-amber-300 underline underline-offset-2"
              >ptah.live/signup</a
            >
            to create a free account. No credit card required — your 14-day Pro
            trial activates automatically on sign-up.
          </p>
        </ptah-docs-step-card>

        <ptah-docs-step-card [stepNumber]="3" title="Activate your license">
          <p>
            Open the Ptah sidebar in VS Code (look for the Ptah icon in the
            Activity Bar). Sign in with your account and your Pro trial license
            will activate automatically.
          </p>
        </ptah-docs-step-card>
      </div>

      <!-- Callout -->
      <div
        viewportAnimation
        [viewportConfig]="calloutConfig"
        class="mt-8 flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15"
      >
        <lucide-angular
          [img]="SparklesIcon"
          class="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p class="text-sm text-white/60">
          <strong class="text-white/80">Pro trial includes:</strong> All 13 AI
          agents, orchestration workflows, multi-provider support, plugin
          system, and the full setup wizard — free for 14 days.
        </p>
      </div>

      <ng-container media>
        <video
          autoplay
          muted
          loop
          playsinline
          preload="metadata"
          class="w-full rounded-xl border border-white/10 shadow-2xl"
        >
          <source src="assets/videos/install.mp4" type="video/mp4" />
        </video>
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
export class InstallationSectionComponent {
  public readonly DownloadIcon = Download;
  public readonly UserPlusIcon = UserPlus;
  public readonly SparklesIcon = Sparkles;

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly contentConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.1,
    threshold: 0.1,
  };

  public readonly calloutConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
  };
}

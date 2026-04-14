import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  LucideAngularModule,
} from 'lucide-angular';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
import { GitHubReleaseService } from '../../services/github-release.service';

@Component({
  selector: 'ptah-download-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavigationComponent,
    FooterComponent,
    ViewportAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />

      <!-- Hero Header -->
      <div class="relative pt-32 pb-16 sm:pt-40 sm:pb-20 overflow-hidden">
        <!-- Background layers -->
        <div
          class="absolute inset-0 opacity-40"
          style="
            background-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
            background-repeat: repeat;
            background-size: 400px 400px;
          "
          aria-hidden="true"
        ></div>
        <div
          class="absolute inset-0 bg-gradient-to-b from-base-100/30 via-base-100/60 to-base-100"
          aria-hidden="true"
        ></div>

        <div class="relative z-10 max-w-5xl mx-auto px-6 sm:px-10">
          <h1
            viewportAnimation
            [viewportConfig]="headlineConfig"
            class="text-4xl sm:text-5xl lg:text-6xl font-display font-bold leading-tight mb-4"
          >
            <span class="gradient-text-gold">Downloads</span>
          </h1>
          <p
            viewportAnimation
            [viewportConfig]="subheadlineConfig"
            class="text-lg sm:text-xl text-neutral-content max-w-2xl leading-relaxed"
          >
            Download the Ptah Desktop app for Windows, macOS, or Linux.
            Auto-updates keep you on the latest version.
          </p>
        </div>
      </div>

      <!-- Main Content -->
      <div class="max-w-5xl mx-auto px-6 sm:px-10 pb-24">
        @if (loading()) {
          <!-- Loading State -->
          <div class="flex flex-col items-center justify-center py-24 gap-4">
            <div
              class="w-10 h-10 border-2 border-secondary/30 border-t-secondary rounded-full animate-spin"
            ></div>
            <p class="text-neutral-content text-sm">Loading releases...</p>
          </div>
        } @else if (error()) {
          <!-- Error State -->
          <div
            class="rounded-2xl border border-error/20 bg-error/5 p-8 text-center"
          >
            <p class="text-error mb-4">{{ error() }}</p>
            <button
              (click)="retry()"
              class="btn btn-sm btn-outline border-secondary/30 text-secondary hover:bg-secondary hover:text-base-100"
            >
              Try Again
            </button>
          </div>
        } @else {
          <!-- Releases -->
          @for (release of releases(); track release.tagName; let i = $index) {
            <div
              viewportAnimation
              [viewportConfig]="getReleaseConfig(i)"
              class="mb-4"
            >
              <!-- Version Header (clickable) -->
              <button
                (click)="toggleRelease(release.tagName)"
                class="w-full group"
                [attr.aria-expanded]="isExpanded(release.tagName)"
              >
                <div
                  class="flex items-center justify-between px-6 py-5 rounded-2xl border transition-all duration-300"
                  [class]="
                    i === 0
                      ? 'border-secondary/30 bg-base-200/80 hover:border-secondary/50'
                      : 'border-secondary/10 bg-base-200/40 hover:border-secondary/30'
                  "
                >
                  <div class="flex items-center gap-4">
                    <span class="text-sm text-neutral-content font-medium"
                      >Version</span
                    >
                    <span
                      class="text-lg font-display font-bold"
                      [class]="i === 0 ? 'text-secondary' : 'text-base-content'"
                    >
                      {{ release.version }}
                    </span>
                    @if (i === 0) {
                      <span
                        class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-secondary/15 text-secondary border border-secondary/20"
                      >
                        Latest
                      </span>
                    }
                    <span
                      class="text-xs text-neutral-content/60 hidden sm:inline"
                    >
                      {{ formatDate(release.publishedAt) }}
                    </span>
                  </div>
                  <lucide-angular
                    [img]="
                      isExpanded(release.tagName)
                        ? ChevronUpIcon
                        : ChevronDownIcon
                    "
                    class="w-5 h-5 text-neutral-content/50 group-hover:text-secondary transition-colors"
                    aria-hidden="true"
                  />
                </div>
              </button>

              <!-- Expanded Platform Grid -->
              @if (isExpanded(release.tagName)) {
                <div
                  class="mt-2 rounded-2xl border border-secondary/10 bg-base-200/30 overflow-hidden"
                >
                  <div
                    class="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-secondary/10"
                  >
                    <!-- macOS -->
                    <div class="p-6">
                      <div class="flex items-center gap-2.5 mb-5">
                        <svg
                          class="w-5 h-5 text-neutral-content"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
                          />
                        </svg>
                        <h3 class="font-display font-bold text-base-content">
                          macOS
                        </h3>
                      </div>
                      @for (asset of release.macos; track asset.fileName) {
                        <a
                          [href]="asset.downloadUrl"
                          class="download-link group/dl flex items-center gap-3 px-4 py-3 -mx-2 rounded-xl hover:bg-secondary/5 transition-colors"
                        >
                          <lucide-angular
                            [img]="DownloadIcon"
                            class="w-4 h-4 text-secondary/60 group-hover/dl:text-secondary transition-colors shrink-0"
                            aria-hidden="true"
                          />
                          <div class="flex-1 min-w-0">
                            <p
                              class="text-sm text-neutral-content group-hover/dl:text-secondary transition-colors"
                            >
                              {{ asset.label }}
                            </p>
                            <p class="text-xs text-neutral-content/40">
                              {{ asset.size }}
                            </p>
                          </div>
                        </a>
                      } @empty {
                        <p class="text-sm text-neutral-content/40 italic px-2">
                          No macOS builds
                        </p>
                      }
                    </div>

                    <!-- Windows -->
                    <div class="p-6">
                      <div class="flex items-center gap-2.5 mb-5">
                        <svg
                          class="w-5 h-5 text-neutral-content"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"
                          />
                        </svg>
                        <h3 class="font-display font-bold text-base-content">
                          Windows
                        </h3>
                      </div>
                      @for (asset of release.windows; track asset.fileName) {
                        <a
                          [href]="asset.downloadUrl"
                          class="download-link group/dl flex items-center gap-3 px-4 py-3 -mx-2 rounded-xl hover:bg-secondary/5 transition-colors"
                        >
                          <lucide-angular
                            [img]="DownloadIcon"
                            class="w-4 h-4 text-secondary/60 group-hover/dl:text-secondary transition-colors shrink-0"
                            aria-hidden="true"
                          />
                          <div class="flex-1 min-w-0">
                            <p
                              class="text-sm text-neutral-content group-hover/dl:text-secondary transition-colors"
                            >
                              {{ asset.label }}
                            </p>
                            <p class="text-xs text-neutral-content/40">
                              {{ asset.size }}
                            </p>
                          </div>
                        </a>
                      } @empty {
                        <p class="text-sm text-neutral-content/40 italic px-2">
                          No Windows builds
                        </p>
                      }
                    </div>

                    <!-- Linux -->
                    <div class="p-6">
                      <div class="flex items-center gap-2.5 mb-5">
                        <svg
                          class="w-5 h-5 text-neutral-content"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            d="M20.581 19.049c-.55-.446-.336-1.431-.907-1.917.553-3.365-.997-6.331-2.845-8.232-1.551-1.595-1.958-3.321-1.881-4.243.039-.467-.084-.986-.222-1.385-.869-.266-1.727-.312-2.712-.074-.105.378-.233.93-.198 1.459.077.922-.33 2.648-1.881 4.243-1.848 1.901-3.398 4.867-2.845 8.232-.571.486-.357 1.471-.907 1.917-1.37 1.112-.086 3.447 2.581 2.449 1.598-.597 2.21-2.18 2.258-3.256.175.015.354.024.536.024h.822c.182 0 .361-.009.536-.024.048 1.076.66 2.659 2.258 3.256 2.667.998 3.951-1.337 2.581-2.449zm-8.548-5.381c-.272 0-.492-.22-.492-.492s.22-.493.492-.493.493.221.493.493-.221.492-.493.492zm3.934 0c-.272 0-.492-.22-.492-.492s.22-.493.492-.493.493.221.493.493-.221.492-.493.492z"
                          />
                        </svg>
                        <h3 class="font-display font-bold text-base-content">
                          Linux
                        </h3>
                      </div>
                      @for (asset of release.linux; track asset.fileName) {
                        <a
                          [href]="asset.downloadUrl"
                          class="download-link group/dl flex items-center gap-3 px-4 py-3 -mx-2 rounded-xl hover:bg-secondary/5 transition-colors"
                        >
                          <lucide-angular
                            [img]="DownloadIcon"
                            class="w-4 h-4 text-secondary/60 group-hover/dl:text-secondary transition-colors shrink-0"
                            aria-hidden="true"
                          />
                          <div class="flex-1 min-w-0">
                            <p
                              class="text-sm text-neutral-content group-hover/dl:text-secondary transition-colors"
                            >
                              {{ asset.label }}
                            </p>
                            <p class="text-xs text-neutral-content/40">
                              {{ asset.size }}
                            </p>
                          </div>
                        </a>
                      } @empty {
                        <p class="text-sm text-neutral-content/40 italic px-2">
                          No Linux builds
                        </p>
                      }
                    </div>
                  </div>

                  <!-- Release link -->
                  <div
                    class="px-6 py-3 border-t border-secondary/5 flex items-center justify-end"
                  >
                    <a
                      [href]="release.releaseUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1.5 text-xs text-neutral-content/40 hover:text-secondary transition-colors"
                    >
                      View release notes
                      <lucide-angular
                        [img]="ExternalLinkIcon"
                        class="w-3 h-3"
                        aria-hidden="true"
                      />
                    </a>
                  </div>
                </div>
              }
            </div>
          }

          <!-- VS Code Extension Callout -->
          <div
            viewportAnimation
            [viewportConfig]="calloutConfig"
            class="mt-12 rounded-2xl border border-secondary/15 bg-base-200/50 p-8 flex flex-col sm:flex-row items-center gap-6"
          >
            <div
              class="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center shrink-0"
            >
              <svg
                class="w-7 h-7 text-secondary"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
                />
              </svg>
            </div>
            <div class="flex-1 text-center sm:text-left">
              <h3 class="font-display font-bold text-base-content text-lg mb-1">
                Looking for the VS Code Extension?
              </h3>
              <p class="text-neutral-content text-sm">
                Install directly from the VS Code Marketplace for seamless IDE
                integration with automatic updates.
              </p>
            </div>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra"
              target="_blank"
              rel="noopener noreferrer"
              class="btn bg-gradient-to-r from-secondary to-accent text-base-100 border-0 font-semibold shadow-lg shadow-secondary/20 hover:shadow-secondary/40 hover:scale-105 transition-all shrink-0"
            >
              VS Code Marketplace
            </a>
          </div>
        }
      </div>

      <ptah-footer />
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
export class DownloadPageComponent implements OnInit {
  private readonly releaseService = inject(GitHubReleaseService);

  readonly DownloadIcon = Download;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronUpIcon = ChevronUp;
  readonly ExternalLinkIcon = ExternalLink;

  readonly releases = this.releaseService.releases;
  readonly loading = this.releaseService.loading;
  readonly error = this.releaseService.error;

  /** Track which versions are expanded */
  private readonly expandedSet = signal<Set<string>>(new Set());

  /** Auto-expand the latest release */
  readonly autoExpandApplied = signal(false);

  // Animation configs
  readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    threshold: 0.1,
    ease: 'power2.out',
  };

  readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.1,
  };

  readonly calloutConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
  };

  ngOnInit(): void {
    this.releaseService.fetchReleases(3);

    // Auto-expand the latest release once data loads
    const checkExpand = setInterval(() => {
      const r = this.releases();
      if (r.length > 0 && !this.autoExpandApplied()) {
        this.expandedSet.update((s) => new Set(s).add(r[0].tagName));
        this.autoExpandApplied.set(true);
        clearInterval(checkExpand);
      }
      if (!this.loading()) {
        clearInterval(checkExpand);
      }
    }, 100);
  }

  toggleRelease(tagName: string): void {
    this.expandedSet.update((current) => {
      const next = new Set(current);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  }

  isExpanded(tagName: string): boolean {
    return this.expandedSet().has(tagName);
  }

  getReleaseConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.1 * index,
      threshold: 0.1,
      ease: 'power2.out',
    };
  }

  formatDate(isoDate: string): string {
    return new Date(isoDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  retry(): void {
    this.releaseService.fetchReleases(3);
  }
}

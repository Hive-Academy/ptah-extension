import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ViewportAnimationConfig, ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import type { ParsedRelease } from '@ptah-web/core';
import { ChevronDown, ChevronUp, ExternalLink, LucideAngularModule } from 'lucide-angular';
import { PLATFORMS, formatReleaseDate } from '../platforms';
import { ReleasePlatformComponent } from './release-platform.component';

/** Expanded releases list their platforms in this order (macOS, Windows, Linux). */
const COLUMNS = [PLATFORMS.macos, PLATFORMS.windows, PLATFORMS.linux];

/**
 * The release history as app-style cards: loading, error with retry, an empty
 * note, and one collapsible card per release (the newest opens on its own).
 */
@Component({
  selector: 'ptah-release-list',
  standalone: true,
  imports: [ViewportAnimationDirective, LucideAngularModule, ReleasePlatformComponent],
  template: `
    <section class="dl-section" id="releases" aria-labelledby="releases-title">
      <div class="dl-shell">
        <header class="dl-head">
          <p class="dl-eyebrow"><span class="cue-line" aria-hidden="true"></span><span>Releases</span><span class="cue-line" aria-hidden="true"></span></p>
          <h2 class="dl-title" id="releases-title">Downloads</h2>
          <p class="dl-subline">
            Choose your installer on the latest GitHub release page. Direct downloads appear below when
            release details load.
          </p>
        </header>

        @if (loading()) {
          <div class="rl-state" role="status">
            <span class="rl-spinner" aria-hidden="true"></span>
            <p>Loading releases...</p>
          </div>
        } @else if (error()) {
          <div class="dl-card rl-error" role="alert">
            <p>{{ error() }}</p>
            <button type="button" class="dl-button" (click)="retry.emit()">Try Again</button>
          </div>
        } @else {
          @for (release of releases(); track release.tagName; let i = $index) {
            <article viewportAnimation [viewportConfig]="revealConfig(i)" class="dl-card rl-release" [class.is-latest]="i === 0">
              <button
                type="button"
                class="rl-toggle"
                (click)="toggleRelease(release.tagName)"
                [attr.aria-expanded]="isExpanded(release.tagName)"
              >
                <span class="rl-label">Version</span>
                <span class="rl-version">{{ release.version }}</span>
                @if (i === 0) {
                  <span class="rl-badge">Latest</span>
                }
                <span class="rl-date">{{ formatDate(release.publishedAt) }}</span>
                <lucide-angular
                  [img]="isExpanded(release.tagName) ? ChevronUpIcon : ChevronDownIcon"
                  [size]="20"
                  class="rl-chevron"
                  aria-hidden="true"
                />
              </button>

              @if (isExpanded(release.tagName)) {
                <div class="rl-body">
                  <div class="rl-columns">
                    @for (platform of columns; track platform.id) {
                      <ptah-release-platform [platform]="platform" [assets]="release[platform.id]" />
                    }
                  </div>
                  <div class="rl-foot">
                    <a [href]="release.releaseUrl" target="_blank" rel="noopener noreferrer" class="rl-notes">
                      View release notes
                      <lucide-angular [img]="ExternalLinkIcon" [size]="12" class="rl-notes-icon" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              }
            </article>
          } @empty {
            <p class="rl-empty">
              No release details are available right now. Use the platform links above to check the
              latest GitHub release.
            </p>
          }
        }
      </div>
    </section>
  `,
  styleUrls: ['../download-section.css', './release-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleaseListComponent {
  public readonly releases = input.required<readonly ParsedRelease[]>();
  public readonly loading = input.required<boolean>();
  public readonly error = input<string | null>(null);
  public readonly retry = output<void>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly columns = COLUMNS;
  protected readonly formatDate = formatReleaseDate;

  /** Which versions are expanded. */
  private readonly expandedSet = signal<ReadonlySet<string>>(new Set());
  private readonly autoExpandApplied = signal(false);

  public constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Open the newest release once it arrives; stop watching when loading ends.
      const checkExpand = setInterval(() => {
        const r = this.releases();
        if (r.length > 0 && !this.autoExpandApplied()) {
          this.expandedSet.update((s) => new Set(s).add(r[0].tagName));
          this.autoExpandApplied.set(true);
          clearInterval(checkExpand);
        }
        if (!this.loading()) clearInterval(checkExpand);
      }, 100);
      destroyRef.onDestroy(() => clearInterval(checkExpand));
    });
  }

  protected toggleRelease(tagName: string): void {
    this.expandedSet.update((current) => {
      const next = new Set(current);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  }

  protected isExpanded(tagName: string): boolean {
    return this.expandedSet().has(tagName);
  }

  protected revealConfig(index: number): ViewportAnimationConfig {
    return { animation: 'slideUp', duration: 0.5, delay: 0.1 * index, threshold: 0.1, ease: 'power2.out' };
  }
}

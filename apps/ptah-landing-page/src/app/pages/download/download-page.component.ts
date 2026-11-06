import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { GitHubReleaseService, SeoService } from '@ptah-web/core';
import { FooterComponent, NavigationComponent } from '@ptah-web/ui';
import { DownloadHeroComponent } from './download-hero/download-hero.component';
import { PlatformCardsComponent } from './platform-cards/platform-cards.component';
import { DesktopOs, NavigatorHints, detectDesktopOs } from './platforms';
import { ReleaseListComponent } from './release-list/release-list.component';

/**
 * The /download route: the Lightfall hero with the primary download, the
 * platform cards, and the release history from the GitHub release API.
 */
@Component({
  selector: 'ptah-download-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavigationComponent, FooterComponent, DownloadHeroComponent, PlatformCardsComponent, ReleaseListComponent],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />
      <main>
        <ptah-download-hero [os]="os()" [latest]="latest()" />
        <ptah-platform-cards [os]="os()" [latest]="latest()" />
        <ptah-release-list
          [releases]="releases()"
          [loading]="loading()"
          [error]="error()"
          (retry)="retry()"
        />
      </main>
      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background: #08090c;
      }
    `,
  ],
})
export class DownloadPageComponent {
  private readonly releaseService = inject(GitHubReleaseService);
  private readonly document = inject(DOCUMENT);

  protected readonly releases = this.releaseService.releases;
  protected readonly loading = this.releaseService.loading;
  protected readonly error = this.releaseService.error;
  protected readonly latest = computed(() => this.releases()[0] ?? null);
  /** Detected after hydration only: the server render stays OS-neutral. */
  protected readonly os = signal<DesktopOs | null>(null);

  public constructor() {
    inject(SeoService).setPage({
      title: 'Download PtahCode — AI Coding Agent for Windows, macOS & Linux',
      description:
        'Download PtahCode for Windows, macOS, or Linux. Persistent memory, sub-agent orchestration, scheduled agents. Free and open source, no credit card.',
      url: 'https://ptah.live/download',
      ogTitle: 'Download PtahCode — Windows, macOS & Linux',
      ogDescription:
        "The desktop AI coding agent that remembers your codebase and works while you're away. Free and open source, no credit card.",
    });

    afterNextRender(() => {
      this.releaseService.fetchReleases(3);
      const nav = this.document.defaultView?.navigator as (Navigator & NavigatorHints) | undefined;
      if (nav) this.os.set(detectDesktopOs(nav));
    });
  }

  protected retry(): void {
    this.releaseService.fetchReleases(3);
  }
}

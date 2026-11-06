import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ParsedRelease } from '@ptah-web/core';
import { DesktopOs, LATEST_RELEASE_URL, PLATFORM_ORDER, PlatformInfo } from '../platforms';

/**
 * One app-style card per desktop platform, where the stage's light lands.
 * Each card's link goes to the latest GitHub release, so it works before (and
 * without) the release API. The detected platform's card is the primary CTA.
 */
@Component({
  selector: 'ptah-platform-cards',
  standalone: true,
  template: `
    <ul class="dl-platforms" role="list" aria-label="Download platforms">
      @for (platform of platforms; track platform.id) {
        <li class="dl-card dl-platform" [class.is-detected]="os() === platform.id">
          <div class="dl-platform-head">
            <span class="dl-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="platform.icon" /></svg>
            </span>
            <h2>{{ platform.name }}</h2>
            @if (os() === platform.id) {
              <span class="dl-detected">This device</span>
            }
          </div>
          <p class="dl-detail">{{ detail(platform) }}</p>
          <a
            class="dl-button"
            [class.is-solid]="os() === platform.id"
            [attr.data-testid]="os() === platform.id ? 'download-primary' : null"
            [href]="latestUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download for {{ platform.name }}
          </a>
        </li>
      }
    </ul>
  `,
  styleUrls: ['../download-section.css', './platform-cards.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformCardsComponent {
  public readonly os = input<DesktopOs | null>(null);
  public readonly latest = input<ParsedRelease | null>(null);

  protected readonly platforms = PLATFORM_ORDER;
  protected readonly latestUrl = LATEST_RELEASE_URL;

  /** The latest release's installers for this platform, read from the API when it loaded. */
  protected detail(platform: PlatformInfo): string {
    const release = this.latest();
    if (!release) return 'Latest GitHub release';
    const assets = release[platform.id];
    if (assets.length > 0) return assets.map((asset) => asset.label).join(' · ');
    return platform.id === 'windows' ? 'Get it from the Microsoft Store' : `No ${platform.name} builds`;
  }
}

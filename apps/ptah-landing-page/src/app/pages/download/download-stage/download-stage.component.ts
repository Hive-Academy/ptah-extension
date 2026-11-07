import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ParsedRelease } from '@ptah-web/core';
import { LightfallComponent } from '../lightfall/lightfall.component';
import { LightfallOptions } from '../lightfall/lightfall-options';
import { PlatformCardsComponent } from '../platform-cards/platform-cards.component';
import { DesktopOs, formatReleaseDate } from '../platforms';

/** The beam pours down through the copy and lands on the top edge of the platform cards. */
const LIGHT: Partial<LightfallOptions> = {
  verticalBeamOffset: 0.035,
  horizontalSizing: 0.5,
  verticalSizing: 2.4,
  fogIntensity: 0.5,
  wispIntensity: 4,
  mouseTiltStrength: 0.2,
  mouseSmoothTime: 0.35,
};

/**
 * The one-screen download stage: the temple scene and gold symbols, the
 * centred copy, and the Lightfall beam falling straight through it onto the
 * top edge of the platform cards (the detected card glows brightest).
 */
@Component({
  selector: 'ptah-download-stage',
  standalone: true,
  imports: [LightfallComponent, PlatformCardsComponent],
  template: `
    <section class="dl-stage" aria-labelledby="download-title">
      <img class="dl-temple" src="/assets/backgrounds/temple-bg.webp" alt="" aria-hidden="true" fetchpriority="high" />
      <div class="dl-scrim" aria-hidden="true"></div>
      <div class="dl-symbols" aria-hidden="true">
        <img src="/assets/textures/ankh-sphere.webp" alt="" class="dl-symbol is-ankh" />
        <img src="/assets/textures/scarab.webp" alt="" class="dl-symbol is-scarab" />
        <img src="/assets/textures/eye_of_horus.webp" alt="" class="dl-symbol is-eye" />
        <img src="/assets/textures/sun_disk_ra.webp" alt="" class="dl-symbol is-sun" />
      </div>

      <div class="dl-stack">
        <div class="dl-copy">
          <p class="dl-eyebrow">
            <img class="dl-mark" src="/assets/icons/ptah-icon.webp" alt="" width="28" height="28" />
            <span>PtahCode Desktop</span>
          </p>
          <h1 id="download-title">Download PtahCode</h1>
          <p class="dl-lead">
            Download the PtahCode Desktop app for Windows, macOS, or Linux. Auto-updates keep you on
            the latest version.
          </p>
        </div>

        <div class="dl-landing">
          <ptah-lightfall class="dl-light" [options]="light" />
          <ptah-platform-cards class="dl-cards" [os]="os()" [latest]="latest()" />
        </div>

        <p class="dl-meta">
          @if (latest(); as release) {
            <span class="dl-version">Latest {{ release.version }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ formatDate(release.publishedAt) }}</span>
          } @else {
            <span>No account, no license key, no credit card</span>
          }
          <a class="dl-notes" href="#releases"><span aria-hidden="true">↘</span> Release notes</a>
        </p>
      </div>
    </section>
  `,
  styleUrls: ['./download-stage.component.css', './download-stage-landing.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadStageComponent {
  /** The visitor's desktop OS, when the browser reveals one. */
  public readonly os = input<DesktopOs | null>(null);
  /** The newest release, once the release list loads. */
  public readonly latest = input<ParsedRelease | null>(null);

  protected readonly light = LIGHT;
  protected readonly formatDate = formatReleaseDate;
}

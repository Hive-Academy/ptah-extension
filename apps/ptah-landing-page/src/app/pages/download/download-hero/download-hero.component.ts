import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ParsedRelease } from '@ptah-web/core';
import { LightfallComponent } from '../lightfall/lightfall.component';
import { LightfallOptions } from '../lightfall/lightfall-options';
import { DesktopOs, LATEST_RELEASE_URL, PLATFORMS, formatReleaseDate } from '../platforms';

/** Light landing on the app window's top edge, with the flare spread along it. */
const LIGHT: Partial<LightfallOptions> = {
  verticalBeamOffset: 0.08,
  horizontalSizing: 0.62,
  verticalSizing: 2.2,
  fogIntensity: 0.55,
  wispIntensity: 4,
  mouseTiltStrength: 0.2,
  mouseSmoothTime: 0.35,
};

/**
 * The download hero: the temple scene, the gold symbols, the headline and the
 * primary download, and the app window the Lightfall beam pours onto.
 */
@Component({
  selector: 'ptah-download-hero',
  standalone: true,
  imports: [LightfallComponent],
  template: `
    <section class="dl-hero" aria-labelledby="download-title">
      <img class="dl-temple" src="/assets/backgrounds/temple-bg.webp" alt="" aria-hidden="true" fetchpriority="high" />
      <div class="dl-scrim" aria-hidden="true"></div>
      <div class="dl-symbols" aria-hidden="true">
        <img src="/assets/textures/ankh-sphere.webp" alt="" class="dl-symbol is-ankh" />
        <img src="/assets/textures/eye_of_horus.webp" alt="" class="dl-symbol is-eye" />
        <img src="/assets/textures/sun_disk_ra.webp" alt="" class="dl-symbol is-sun" />
      </div>

      <div class="dl-hero-inner">
        <div class="dl-copy">
          <p class="dl-hero-eyebrow">
            <img class="dl-mark" src="/assets/icons/ptah-icon.webp" alt="" width="28" height="28" />
            <span>PtahCode Desktop</span>
          </p>
          <h1 id="download-title">Download PtahCode</h1>
          <p class="dl-lead">
            Download the PtahCode Desktop app for Windows, macOS, or Linux. Auto-updates keep you on
            the latest version.
          </p>
          <div class="dl-actions">
            <a
              class="dl-primary"
              data-testid="download-primary"
              [href]="latestUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              @if (platform(); as p) {
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="p.icon" /></svg>
                Download for {{ p.name }}
              } @else {
                Download PtahCode
              }
              <span class="dl-arrow" aria-hidden="true">↗</span>
            </a>
            <a class="dl-secondary" href="#releases"><span aria-hidden="true">↘</span> Release notes</a>
          </div>
          <p class="dl-meta">
            @if (latest(); as release) {
              <span class="dl-version">Latest {{ release.version }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ formatDate(release.publishedAt) }}</span>
            } @else {
              <span>No account, no license key, no credit card</span>
            }
          </p>
        </div>

        <div class="dl-stage">
          <ptah-lightfall class="dl-light" [options]="light" />
          <figure class="dl-window">
            <img
              src="/assets/live-demo/command-center.jpg"
              alt="PtahCode Command Center: follow work and activity across PtahCode in one place"
              width="1440"
              height="900"
              fetchpriority="high"
            />
          </figure>
        </div>
      </div>
    </section>
  `,
  styleUrls: ['./download-hero.component.css', './download-hero-stage.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadHeroComponent {
  /** The visitor's desktop OS, when the browser reveals one. */
  public readonly os = input<DesktopOs | null>(null);
  /** The newest release, once the release list loads. */
  public readonly latest = input<ParsedRelease | null>(null);

  protected readonly latestUrl = LATEST_RELEASE_URL;
  protected readonly light = LIGHT;
  protected readonly formatDate = formatReleaseDate;
  protected readonly platform = computed(() => {
    const os = this.os();
    return os ? PLATFORMS[os] : null;
  });
}

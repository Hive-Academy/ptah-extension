import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PlatformAsset } from '@ptah-web/core';
import { Download, LucideAngularModule } from 'lucide-angular';
import { MICROSOFT_STORE_URL, PlatformInfo } from '../platforms';

/** One platform column of an expanded release: its direct downloads, or why there are none. */
@Component({
  selector: 'ptah-release-platform',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="rp-head">
      <span class="dl-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="platform().icon" /></svg>
      </span>
      <h3>{{ platform().name }}</h3>
    </div>
    @for (asset of assets(); track asset.fileName) {
      <a [href]="asset.downloadUrl" class="download-link">
        <lucide-angular [img]="DownloadIcon" [size]="16" class="rp-icon" aria-hidden="true" />
        <span class="rp-text">
          <span class="rp-label">{{ asset.label }}</span>
          <span class="rp-size">{{ asset.size }}</span>
        </span>
      </a>
    } @empty {
      @if (platform().id === 'windows') {
        <!-- v2.0.0+ ships Windows only through the Microsoft Store -->
        <a
          [href]="storeUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="download-link"
          data-testid="microsoft-store-link"
        >
          <lucide-angular [img]="DownloadIcon" [size]="16" class="rp-icon" aria-hidden="true" />
          <span class="rp-text">
            <span class="rp-label">Get it from the Microsoft Store</span>
            <span class="rp-size">Installs and updates through the Store</span>
          </span>
        </a>
      } @else {
        <p class="rp-empty">No {{ platform().name }} builds</p>
      }
    }
  `,
  styleUrls: ['../download-section.css', './release-platform.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleasePlatformComponent {
  public readonly platform = input.required<PlatformInfo>();
  public readonly assets = input.required<readonly PlatformAsset[]>();

  protected readonly DownloadIcon = Download;
  protected readonly storeUrl = MICROSOFT_STORE_URL;
}

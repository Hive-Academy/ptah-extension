import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { WebSearchConfigComponent } from './ptah-ai/web-search-config.component';
import { VoiceConfigComponent } from './ptah-ai/voice-config.component';
import { GoVetConsentConfigComponent } from './ptah-ai/go-vet-consent-config.component';

/**
 * Search & Voice tab shell (TASK_2026_555 Advanced / Search & Voice, Batch 39).
 *
 * Hosts the existing web-search, voice and go-vet consent children unchanged.
 * Voice and go-vet remain Electron-only, as today.
 */
@Component({
  selector: 'ptah-search-voice-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WebSearchConfigComponent, VoiceConfigComponent, GoVetConsentConfigComponent],
  template: `
    <div class="space-y-4">
      <ptah-web-search-config />

      @if (isElectron) {
        <ptah-voice-config />
        <ptah-go-vet-consent-config />
      }
    </div>
  `,
})
export class SearchVoiceSettingsComponent {
  private readonly vscodeService = inject(VSCodeService);
  readonly isElectron = this.vscodeService.isElectron;
}

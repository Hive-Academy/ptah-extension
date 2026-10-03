import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import {
  NativeDrawerComponent,
  NativeTabGroupComponent,
  type NativeTab,
} from '@ptah-extension/ui';
import type { VoiceProviderConfigDto } from '@ptah-extension/shared';
import { LocalSttPanelComponent } from './local-stt-panel.component';
import { LocalTtsPanelComponent } from './local-tts-panel.component';
import { ElevenLabsPanelComponent } from './elevenlabs-panel.component';

export type VoiceDirection = 'stt' | 'tts';

const TABS: readonly NativeTab[] = [
  { id: 'stt', label: 'Speech-to-text' },
  { id: 'tts', label: 'Text-to-speech' },
];

/**
 * Drawer D-VOICE (pattern map §3.2, P6): one tab per direction, each rendering exactly the active
 * provider's existing panel. The panels keep their own logic and save themselves (deviation 3), so the
 * footer holds Close only. The parent owns visibility: the drawer is open while `direction` is set and
 * only requests closure; `NativeDrawerComponent` returns focus to the opener (Esc, backdrop, Close).
 */
@Component({
  selector: 'ptah-voice-details-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NativeDrawerComponent,
    NativeTabGroupComponent,
    LocalSttPanelComponent,
    LocalTtsPanelComponent,
    ElevenLabsPanelComponent,
  ],
  template: `
    <ptah-native-drawer [isOpen]="direction() !== null" widthClass="w-full max-w-lg"
      ariaLabel="Voice engine details" (closed)="closed.emit()">
      <!-- One projectable node per @if: a multi-node @if cannot project into the drawer's slots (NG8011). -->
      @if (direction() !== null) {
        <div drawer-header data-testid="voice-details-drawer">
          <h2 class="text-sm font-semibold text-base-content">Voice engines</h2>
          <p class="text-xs text-base-content-muted" data-testid="voice-details-subtitle">{{ subtitle() }}</p>
        </div>
      }
      @if (config(); as cfg) {
        <ptah-native-tab-group class="-mx-2 block" [tabs]="tabs" [activeId]="direction()"
          (activeIdChange)="selectTab($event)" ariaLabel="Voice directions">
          <div class="px-2 pt-4" [attr.data-tab-body]="direction()">
            @if (direction() === 'stt') {
              @switch (sttProvider()) {
                @case ('elevenlabs') {
                  <ptah-elevenlabs-panel direction="stt" [config]="cfg.elevenlabs" (changed)="changed.emit()" />
                }
                @default {
                  <ptah-local-stt-panel [config]="cfg.local" (changed)="changed.emit()" />
                }
              }
            } @else {
              @switch (ttsProvider()) {
                @case ('elevenlabs') {
                  <ptah-elevenlabs-panel direction="tts" [config]="cfg.elevenlabs" (changed)="changed.emit()" />
                }
                @default {
                  <ptah-local-tts-panel [config]="cfg.local" (changed)="changed.emit()" />
                }
              }
            }
          </div>
        </ptah-native-tab-group>
      }
      @if (direction() !== null) {
        <div drawer-footer class="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3">
          <span class="text-xs text-base-content-muted">Each control saves itself. Esc to close</span>
          <button type="button" class="btn btn-ghost btn-sm" (click)="closed.emit()"
            data-testid="voice-details-close">Close</button>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class VoiceDetailsDrawerComponent {
  /** The open tab; `null` closes the drawer. Two-way so a tab switch inside the drawer is kept by the parent. */
  readonly direction = model<VoiceDirection | null>(null);
  readonly config = input<VoiceProviderConfigDto | null>(null);
  readonly closed = output<void>();
  /** A panel saved something; the parent re-reads the provider config. */
  readonly changed = output<void>();

  protected readonly tabs = TABS;
  protected readonly sttProvider = computed(() => this.config()?.sttProvider ?? 'local');
  protected readonly ttsProvider = computed(() => this.config()?.ttsProvider ?? 'local');
  protected readonly subtitle = computed(() => {
    const cfg = this.config();
    if (!cfg) return 'Loading voice configuration…';
    return `Speech-to-text: ${providerName(cfg.sttProvider)} · Text-to-speech: ${providerName(cfg.ttsProvider)}`;
  });

  protected selectTab(id: string | null): void {
    if (id === 'stt' || id === 'tts') this.direction.set(id);
  }
}

function providerName(id: string): string {
  return id === 'elevenlabs' ? 'ElevenLabs' : 'Local';
}

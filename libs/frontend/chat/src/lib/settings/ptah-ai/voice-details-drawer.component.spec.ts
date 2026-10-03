import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { VoiceProviderConfigDto } from '@ptah-extension/shared';
import { VoiceDetailsDrawerComponent, type VoiceDirection } from './voice-details-drawer.component';
import { LocalSttPanelComponent } from './local-stt-panel.component';
import { LocalTtsPanelComponent } from './local-tts-panel.component';
import { ElevenLabsPanelComponent } from './elevenlabs-panel.component';

@Component({ selector: 'ptah-local-stt-panel', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<button type="button" data-testid="stub-local-stt" (click)="changed.emit()">stt</button>' })
class LocalSttStub {
  readonly config = input.required<unknown>();
  readonly changed = output<void>();
}

@Component({ selector: 'ptah-local-tts-panel', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p data-testid="stub-local-tts">tts</p>' })
class LocalTtsStub {
  readonly config = input.required<unknown>();
  readonly changed = output<void>();
}

@Component({ selector: 'ptah-elevenlabs-panel', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p [attr.data-testid]="\'stub-elevenlabs-\' + direction()">el</p>' })
class ElevenLabsStub {
  readonly direction = input.required<'stt' | 'tts'>();
  readonly config = input.required<unknown>();
  readonly changed = output<void>();
}

@Component({
  standalone: true,
  imports: [VoiceDetailsDrawerComponent],
  template: `<ptah-voice-details-drawer [(direction)]="direction" [config]="config()"
    (closed)="closedCount = closedCount + 1; direction.set(null)" (changed)="changedCount = changedCount + 1" />`,
})
class HostComponent {
  readonly direction = signal<VoiceDirection | null>('stt');
  readonly config = signal<VoiceProviderConfigDto | null>(null);
  closedCount = 0;
  changedCount = 0;
}

function config(overrides: Partial<VoiceProviderConfigDto> = {}): VoiceProviderConfigDto {
  return {
    ttsProvider: 'local',
    sttProvider: 'local',
    local: { whisperModel: 'base.en', modelSource: 'curated', sttDownloaded: true, ttsDownloaded: true, ttsVoice: 'af_heart' },
    elevenlabs: { apiKeyConfigured: true, ttsModelId: 'm', outputFormat: 'mp3_44100_128', sttModelId: 'scribe_v1' },
    ...overrides,
  };
}

/** TASK_2026_555 Batch 46 — drawer D-VOICE shell (pattern map §3.2, P6). */
describe('VoiceDetailsDrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] }).overrideComponent(VoiceDetailsDrawerComponent, {
      remove: { imports: [LocalSttPanelComponent, LocalTtsPanelComponent, ElevenLabsPanelComponent] },
      add: { imports: [LocalSttStub, LocalTtsStub, ElevenLabsStub] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.config.set(config());
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const tab = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((el) => el.textContent?.includes(label));

  it('opens as a labelled dialog on the requested tab with the active provider panel', () => {
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Voice engine details');
    expect(q('voice-details-subtitle')?.textContent).toContain('Speech-to-text: Local · Text-to-speech: Local');
    expect(q('stub-local-stt')).not.toBeNull();
    expect(q('stub-local-tts')).toBeNull();
    expect(tab('Speech-to-text')?.getAttribute('aria-selected')).toBe('true');
  });

  it('switches tabs and keeps the parent in sync', () => {
    tab('Text-to-speech')?.click();
    fixture.detectChanges();
    expect(host.direction()).toBe('tts');
    expect(q('stub-local-tts')).not.toBeNull();
    expect(q('stub-local-stt')).toBeNull();
  });

  it('renders the ElevenLabs panel for the direction that uses it', () => {
    host.config.set(config({ ttsProvider: 'elevenlabs' }));
    host.direction.set('tts');
    fixture.detectChanges();
    expect(q('stub-elevenlabs-tts')).not.toBeNull();
    expect(q('stub-local-tts')).toBeNull();
  });

  it('forwards a panel save so the parent re-reads config', () => {
    (q('stub-local-stt') as HTMLButtonElement).click();
    expect(host.changedCount).toBe(1);
  });

  it('has a Close-only footer and requests closure', () => {
    const footerButtons = q('voice-details-close')?.parentElement?.querySelectorAll('button');
    expect(footerButtons?.length).toBe(1);
    (q('voice-details-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(q('voice-details-drawer')).toBeNull();
  });

  it('is closed while no direction is set', () => {
    host.direction.set(null);
    fixture.detectChanges();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

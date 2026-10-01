import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { SearchVoiceSettingsComponent } from './search-voice-settings.component';
import { WebSearchConfigComponent } from './ptah-ai/web-search-config.component';
import { VoiceConfigComponent } from './ptah-ai/voice-config.component';
import { GoVetConsentConfigComponent } from './ptah-ai/go-vet-consent-config.component';

@Component({ selector: 'ptah-web-search-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Web search</p>' })
class WebSearchStub {}

@Component({ selector: 'ptah-voice-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Voice</p>' })
class VoiceStub {}

@Component({ selector: 'ptah-go-vet-consent-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Go vet</p>' })
class GoVetStub {}

describe('SearchVoiceSettingsComponent', () => {
  async function render(isElectron: boolean) {
    await TestBed.configureTestingModule({
      imports: [SearchVoiceSettingsComponent],
      providers: [{ provide: VSCodeService, useValue: { isElectron } }],
    }).overrideComponent(SearchVoiceSettingsComponent, {
      remove: { imports: [WebSearchConfigComponent, VoiceConfigComponent, GoVetConsentConfigComponent] },
      add: { imports: [WebSearchStub, VoiceStub, GoVetStub] },
    }).compileComponents();
    const fixture = TestBed.createComponent(SearchVoiceSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => { TestBed.resetTestingModule(); });

  it('mounts web search in VS Code (voice and go vet hidden)', async () => {
    const { element } = await render(false);
    expect(element.querySelector('ptah-web-search-config')).not.toBeNull();
    expect(element.querySelector('ptah-voice-config')).toBeNull();
    expect(element.querySelector('ptah-go-vet-consent-config')).toBeNull();
  });

  it('mounts web search, voice and go vet in Electron', async () => {
    const { element } = await render(true);
    expect(element.querySelector('ptah-web-search-config')).not.toBeNull();
    expect(element.querySelector('ptah-voice-config')).not.toBeNull();
    expect(element.querySelector('ptah-go-vet-consent-config')).not.toBeNull();
  });
});

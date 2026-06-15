import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';

import { VoiceConfigComponent } from './voice-config.component';
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

function mount(rpc: MockRpcService): {
  fixture: ComponentFixture<VoiceConfigComponent>;
  component: VoiceConfigComponent;
} {
  TestBed.configureTestingModule({
    imports: [VoiceConfigComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(VoiceConfigComponent);
  const component = fixture.componentInstance;
  return { fixture, component };
}

function select(
  fixture: ComponentFixture<VoiceConfigComponent>,
): HTMLSelectElement {
  const el = fixture.nativeElement.querySelector(
    '[data-testid="voice-config-model-select"]',
  ) as HTMLSelectElement | null;
  if (!el) throw new Error('model select not found');
  return el;
}

async function settle(
  fixture: ComponentFixture<VoiceConfigComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('VoiceConfigComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the current whisper model and reflects it in the select', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(
      rpcSuccess({ ok: true, config: { whisperModel: 'small.en' } }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:getConfig', {});
    expect(component.selectedModel()).toBe('small.en');
    expect(select(fixture).value).toBe('small.en');
  });

  it('renders English-only and multilingual optgroups', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(
      rpcSuccess({ ok: true, config: { whisperModel: 'base.en' } }),
    );

    const { fixture } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const groups = fixture.nativeElement.querySelectorAll(
      'optgroup',
    ) as NodeListOf<HTMLOptGroupElement>;
    const labels = Array.from(groups).map((g) => g.label);
    expect(labels).toEqual(['English-only', 'Multilingual']);
    expect(
      fixture.nativeElement.querySelector('option[value="large-v3-turbo"]'),
    ).not.toBeNull();
  });

  it('saves the chosen model via voice:setConfig and shows saved feedback', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ ok: true, config: { whisperModel: 'base.en' } }),
    );
    rpc.call.mockResolvedValueOnce(rpcSuccess({ ok: true }));
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'medium', downloaded: false },
      }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const el = select(fixture);
    el.value = 'medium';
    el.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setConfig', {
      whisperModel: 'medium',
    });
    expect(component.selectedModel()).toBe('medium');
    expect(component.savedRecently()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="voice-config-saved"]'),
    ).not.toBeNull();
  });

  it('reverts the selection and surfaces an error when save fails', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ ok: true, config: { whisperModel: 'base.en' } }),
    );
    rpc.call.mockResolvedValueOnce(rpcError('disk full'));

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const el = select(fixture);
    el.value = 'large-v3-turbo';
    el.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(component.selectedModel()).toBe('base.en');
    expect(component.errorMessage()).toBe('disk full');
    expect(
      fixture.nativeElement.querySelector('[data-testid="voice-config-error"]')
        ?.textContent,
    ).toContain('disk full');
  });

  it('surfaces a backend error from voice:getConfig on load', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: false, error: 'no settings' }));

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    expect(component.errorMessage()).toBe('no settings');
  });

  it('reflects the downloaded status from voice:getConfig', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'base.en', downloaded: true },
      }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    expect(component.downloaded()).toBe(true);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-config-download-status"]',
      )?.textContent,
    ).toContain('Downloaded');
  });

  it('downloads the selected model via voice:downloadModel and marks it ready', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'small.en', downloaded: false },
      }),
    );
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ ok: true, alreadyPresent: false }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="voice-config-download-btn"]',
    ) as HTMLButtonElement;
    btn.click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenLastCalledWith('voice:downloadModel', {
      model: 'small.en',
    });
    expect(component.downloaded()).toBe(true);
  });

  it('maps a download progress push for the selected model to downloadPercent', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'small.en', downloaded: false },
      }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const progressService = TestBed.inject(VoiceDownloadProgressService);
    progressService.handleMessage({
      type: 'voice:modelDownloadProgress',
      payload: { model: 'small.en', percent: 55 },
    });
    expect(component.downloadPercent()).toBe(55);

    // A tick for a different model must not affect this component.
    progressService.handleMessage({
      type: 'voice:modelDownloadProgress',
      payload: { model: 'medium.en', percent: 90 },
    });
    expect(component.downloadPercent()).toBeNull();
  });

  it('renders a live progress bar while a download is in flight', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'small.en', downloaded: false },
      }),
    );
    let resolveDownload!: (value: unknown) => void;
    rpc.call.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
    );

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="voice-config-download-btn"]',
    ) as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.isDownloading()).toBe(true);

    TestBed.inject(VoiceDownloadProgressService).handleMessage({
      type: 'voice:modelDownloadProgress',
      payload: { model: 'small.en', percent: 30 },
    });
    fixture.detectChanges();

    const bar = fixture.nativeElement.querySelector(
      '[data-testid="voice-config-download-progress"]',
    ) as HTMLProgressElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.value).toBe(30);

    resolveDownload(rpcSuccess({ ok: true, alreadyPresent: false }));
    await settle(fixture);
    expect(component.isDownloading()).toBe(false);
  });

  it('surfaces an error when voice:downloadModel fails', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({
        ok: true,
        config: { whisperModel: 'small.en', downloaded: false },
      }),
    );
    rpc.call.mockResolvedValueOnce(rpcError('network down'));

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="voice-config-download-btn"]',
    ) as HTMLButtonElement;
    btn.click();
    await settle(fixture);

    expect(component.downloaded()).toBe(false);
    expect(component.errorMessage()).toBe('network down');
  });
});

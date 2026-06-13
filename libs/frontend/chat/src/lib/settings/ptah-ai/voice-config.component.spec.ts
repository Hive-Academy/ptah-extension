import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';

import { VoiceConfigComponent } from './voice-config.component';

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
      fixture.nativeElement.querySelector('option[value="large-v3"]'),
    ).not.toBeNull();
  });

  it('saves the chosen model via voice:setConfig and shows saved feedback', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ ok: true, config: { whisperModel: 'base.en' } }),
    );
    rpc.call.mockResolvedValueOnce(rpcSuccess({ ok: true }));

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const el = select(fixture);
    el.value = 'medium';
    el.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(rpc.call).toHaveBeenLastCalledWith('voice:setConfig', {
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
    el.value = 'large-v3';
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
});

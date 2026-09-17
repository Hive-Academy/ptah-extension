import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthStateService, ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import { ProviderAccountStateService } from '../../services/provider-account-state.service';
import { ProviderAccountCardComponent } from './provider-account-card.component';

describe('ProviderAccountCardComponent', () => {
  it('renders an int64 account counter without precision loss', () => {
    const state = {
      providerId: signal('openai-codex'),
      isCodex: signal(true),
      loading: signal(false),
      result: signal({
        status: 'available', providerId: 'openai-codex',
        activity: { lifetimeTokens: '9007199254740993', dailyUsage: [] },
      }),
      load: jest.fn(),
      activateProvider: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [{ provide: ProviderAccountStateService, useValue: state }],
    });
    const fixture = TestBed.createComponent(ProviderAccountCardComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('9007199254740993');
  });

  it('loads once when the provider switches to Codex and clears the result when switching away', async () => {
    const providerId = signal('anthropic');
    const rpc = { call: jest.fn().mockResolvedValue(new RpcResult(true, {
      status: 'available', providerId: 'openai-codex', fetchedAt: 1,
      account: { planType: 'plus' },
      activity: { lifetimeTokens: '321', dailyUsage: [] },
    })) };
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        ProviderAccountStateService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AuthStateService, useValue: { persistedProviderId: providerId } },
      ],
    });
    const fixture = TestBed.createComponent(ProviderAccountCardComponent);
    fixture.detectChanges();
    expect(rpc.call).not.toHaveBeenCalled();

    providerId.set('openai-codex');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Lifetime tokens: 321');

    providerId.set('anthropic');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(ProviderAccountStateService).result()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Codex account');
    expect(rpc.call).toHaveBeenCalledTimes(1);

    fixture.destroy();
    providerId.set('openai-codex');
    TestBed.flushEffects();
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthStateService, ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import { ProviderAccountStateService } from './provider-account-state.service';

describe('ProviderAccountStateService', () => {
  it('keeps provider quota/activity separate and forwards manual refresh', async () => {
    const rpc = { call: jest.fn().mockResolvedValue(new RpcResult(true, {
      status: 'available', providerId: 'openai-codex', fetchedAt: 1,
      quota: { primary: { usedPercent: 20 } },
      activity: { lifetimeTokens: '500', dailyUsage: [] },
    })) };
    const auth = { persistedProviderId: signal('openai-codex') };
    TestBed.configureTestingModule({ providers: [
      ProviderAccountStateService,
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: AuthStateService, useValue: auth },
    ] });
    const state = TestBed.inject(ProviderAccountStateService);
    await state.load(true);
    expect(rpc.call).toHaveBeenCalledWith('provider:getAccountUsage', {
      providerId: 'openai-codex', refresh: true,
    });
    expect(state.result()?.quota?.primary?.usedPercent).toBe(20);
    expect(state.result()?.activity?.lifetimeTokens).toBe('500');
  });

  it('ignores a stale response after the active provider changes', async () => {
    let resolveCall!: (result: RpcResult<unknown>) => void;
    const rpc = { call: jest.fn(() => new Promise((resolve) => { resolveCall = resolve; })) };
    const providerId = signal('openai-codex');
    TestBed.configureTestingModule({ providers: [
      ProviderAccountStateService,
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: AuthStateService, useValue: { persistedProviderId: providerId } },
    ] });
    const state = TestBed.inject(ProviderAccountStateService);
    const pending = state.load();
    providerId.set('anthropic');
    resolveCall(new RpcResult(true, {
      status: 'available', providerId: 'openai-codex',
      activity: { lifetimeTokens: '9007199254740993', dailyUsage: [] },
    }));
    await pending;
    expect(state.result()).toBeNull();
    expect(state.loading()).toBe(false);
  });
});

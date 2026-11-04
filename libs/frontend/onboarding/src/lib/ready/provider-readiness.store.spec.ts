import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService, ClaudeAmbientStatusService, CodexReadinessService,
  ProvidersSettingsStateService, VSCodeService,
  type ClaudeAmbientStatusView, type CodexReadinessView,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';
import { ProviderReadinessStore } from './provider-readiness.store';

const row: CliDetectionResult = {
  cli: 'claude', installed: true, path: '/bin/claude', version: '2.1', messagingMode: 'none',
};
const detection: ProvidersSettingsSection<readonly CliDetectionResult[]> = {
  status: 'ready', data: [row], error: null,
};
const connected: ClaudeAmbientStatusView = {
  status: 'ready', result: { state: 'connected', checkedAt: null },
  localFailure: false, transportTimeout: false,
};
const timeout: ClaudeAmbientStatusView = {
  status: 'ready', result: { state: 'unknown', reason: 'timeout', checkedAt: null },
  localFailure: false, transportTimeout: false,
};
const signedIn: CodexReadinessView = {
  status: 'ready', result: {
    binary: { state: 'found', path: '/bin/codex', version: '1', source: 'installed' },
    signIn: { outcome: 'signed-in' }, checkedAt: '2026-01-01T00:00:00.000Z',
  }, localFailure: false, transportTimeout: false,
};
const codexTimeout: CodexReadinessView = {
  ...signedIn, result: { ...signedIn.result!, signIn: { outcome: 'timeout' } },
};

describe('ProviderReadinessStore', () => {
  const ambientView = signal<ClaudeAmbientStatusView>(connected);
  const codexView = signal<CodexReadinessView>(signedIn);
  let redetectClis: jest.Mock;
  let claudeRead: jest.Mock;
  let codexRead: jest.Mock;
  let refreshAuthStatus: jest.Mock;

  function create(isElectron = true): ProviderReadinessStore {
    ambientView.set(connected);
    codexView.set(signedIn);
    redetectClis = jest.fn().mockResolvedValue(true);
    claudeRead = jest.fn().mockResolvedValue(undefined);
    codexRead = jest.fn().mockResolvedValue(undefined);
    refreshAuthStatus = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: { isElectron } },
        { provide: ProvidersSettingsStateService, useValue: {
          cliDetection: signal(detection), redetectClis,
        } },
        { provide: ClaudeAmbientStatusService, useValue: { view: ambientView, read: claudeRead } },
        { provide: CodexReadinessService, useValue: { view: codexView, read: codexRead } },
        { provide: AuthStateService, useValue: {
          isLoading: signal(false), isLoaded: signal(true),
          persistedAuthMethod: signal('thirdParty'), persistedProviderId: signal('openai-codex'),
          availableProviders: signal([]), refreshAuthStatus,
        } },
      ],
    });
    return TestBed.inject(ProviderReadinessStore);
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { TestBed.resetTestingModule(); jest.useRealTimers(); });

  it('joins concurrent mounts and reads again on a later mount (AC 5.9)', async () => {
    const store = create();
    const first = store.refresh('mount');
    const second = store.refresh('mount');
    expect(second).toBe(first);
    await first;
    await store.refresh('mount');
    expect(redetectClis).toHaveBeenCalledTimes(2);
    expect(claudeRead).toHaveBeenCalledTimes(2);
    expect(codexRead).toHaveBeenCalledTimes(2);
    expect(store.rechecking()).toBe(false);
  });

  it('keeps selection unconfirmed when refresh returns false after an earlier load', async () => {
    const store = create();
    store.markSelectionNotConfirmed();
    refreshAuthStatus.mockResolvedValue(false);
    expect(await store.retrySelection()).toBe(false);
    expect(store.selection().kind).toBe('not-confirmed');
  });

  it('keeps slow visible while a Claude follow-up read is pending', async () => {
    const store = create();
    let finishFollowUp!: () => void;
    claudeRead.mockImplementationOnce(async () => { ambientView.set(timeout); })
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFollowUp = resolve; }))
      .mockImplementationOnce(async () => { ambientView.set(timeout); });
    const cycle = store.refresh('mount');
    await Promise.resolve(); await Promise.resolve();
    expect(store.claude().state).toBe('slow');
    ambientView.set({ ...timeout, status: 'checking' });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(store.claude().state).toBe('slow');
    ambientView.set(timeout);
    finishFollowUp();
    await jest.advanceTimersByTimeAsync(5_000);
    await cycle;
    expect(store.claude()).toMatchObject({ state: 'error', errorCause: 'timeout' });
  });

  it('turns a rejected core read into a terminal local error', async () => {
    const store = create();
    codexView.set({ ...signedIn, status: 'checking' });
    codexRead.mockRejectedValue(new Error('read failed'));
    await store.refresh('mount');
    expect(store.codex()).toMatchObject({ state: 'error', errorCause: 'local' });
    expect(store.claude().state).toBe('ready');
  });

  it('runs at most two 5 s fresh Claude follow-ups then settles', async () => {
    const store = create();
    claudeRead.mockImplementationOnce(async () => { ambientView.set(timeout); })
      .mockImplementationOnce(async () => { ambientView.set(timeout); })
      .mockImplementationOnce(async () => { ambientView.set(connected); });
    const cycle = store.refresh('mount');
    await Promise.resolve(); await Promise.resolve();
    expect(store.claude().state).toBe('slow');
    await jest.advanceTimersByTimeAsync(10_000);
    await cycle;
    expect(claudeRead.mock.calls).toEqual([
      [false, 'mount'], [true, 'follow-up'], [true, 'follow-up'],
    ]);
    expect(store.claude().state).toBe('ready');
  });

  it('makes three timeouts terminal with no fourth probe', async () => {
    const store = create();
    claudeRead.mockImplementation(async () => { ambientView.set(timeout); });
    const cycle = store.refresh('mount');
    await Promise.resolve(); await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10_000);
    await cycle;
    expect(store.claude()).toMatchObject({ state: 'error', errorCause: 'timeout' });
    await jest.advanceTimersByTimeAsync(120_000);
    expect(claudeRead).toHaveBeenCalledTimes(3);
  });

  it('recheck timeout is terminal and rechecking only lasts for recheck', async () => {
    const store = create();
    codexRead.mockImplementation(async () => { codexView.set(codexTimeout); });
    const cycle = store.recheckCodex();
    expect(store.rechecking()).toBe(true);
    await cycle;
    expect(store.rechecking()).toBe(false);
    expect(store.codex()).toMatchObject({ state: 'error', errorCause: 'timeout' });
    expect(codexRead.mock.calls).toEqual([[true, 'recheck']]);
  });

  it('keeps Codex readiness when Claude fails (AC 1.7)', async () => {
    const store = create();
    claudeRead.mockImplementation(async () => { ambientView.set({
      ...connected, result: null, localFailure: true,
    }); });
    await store.refresh('mount');
    expect(store.claude().state).toBe('error');
    expect(store.codex().state).toBe('ready');
    expect(store.chosen().readiness?.state).toBe('ready');
  });

  it('makes no calls outside Electron (AC 6.2)', async () => {
    const store = create(false);
    await store.refresh('mount');
    await store.refresh('recheck');
    await store.recheckCodex();
    expect(redetectClis).not.toHaveBeenCalled();
    expect(claudeRead).not.toHaveBeenCalled();
    expect(codexRead).not.toHaveBeenCalled();
  });
});

import 'reflect-metadata';
import { container } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  type ICodexLoginService,
  type ICodexReadinessReader,
} from '@ptah-extension/auth-providers';
import { CODEX_RUNTIME_TOKENS, type CodexSelection, type CodexSelectionSnapshotPort } from '@ptah-extension/codex-runtime';
import { PLATFORM_TOKENS, type IProcessSpawner, type IUserInteraction } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { sanitizeScenario } from '../replay/scenario-sanitizer';
import { codexSignInQuitHandle, registerElectronCodexReadinessAndLogin } from './codex-login-composition';

describe('Electron Codex sign-in composition', () => {
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as Logger;

  it('registers both services without resolving the snapshot and handles shutdown before and after creation', async () => {
    const scope = container.createChildContainer();
    const spawnProcess = jest.fn<ReturnType<IProcessSpawner['spawnProcess']>, Parameters<IProcessSpawner['spawnProcess']>>();
    scope.register(SDK_TOKENS.SDK_PROCESS_SPAWNER, { useValue: { spawnProcess } satisfies IProcessSpawner });
    scope.register(PLATFORM_TOKENS.USER_INTERACTION, { useValue: { openExternal: jest.fn() } as unknown as IUserInteraction });
    scope.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH, { useValue: { getSignInOutcome: jest.fn(), clearCache: jest.fn() } });

    registerElectronCodexReadinessAndLogin(scope, logger);
    expect(scope.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN)).toBe(true);
    expect(scope.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS)).toBe(true);
    expect(codexSignInQuitHandle.isActive()).toBe(false);
    await expect(codexSignInQuitHandle.stop()).resolves.toBeUndefined();

    const login = scope.resolve<ICodexLoginService>(AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN);
    const readiness = scope.resolve<ICodexReadinessReader>(AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS);
    expect(readiness).toBe(scope.resolve(AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS));
    expect(login).toBe(scope.resolve(AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN));
    expect(spawnProcess).not.toHaveBeenCalled();

    let resolveSelection!: (selection: CodexSelection) => void;
    const pending = new Promise<CodexSelection>(resolve => { resolveSelection = resolve; });
    const selectForOpen = jest.fn<Promise<CodexSelection>, []>(() => pending);
    scope.register(CODEX_RUNTIME_TOKENS.SelectionSnapshot, {
      useValue: { selectForOpen } as unknown as CodexSelectionSnapshotPort,
    });
    const started = login.start({}, jest.fn());
    expect(selectForOpen).toHaveBeenCalledTimes(1);
    expect(codexSignInQuitHandle.isActive()).toBe(true);
    await expect(codexSignInQuitHandle.stop()).resolves.toBeUndefined();
    expect(codexSignInQuitHandle.isActive()).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    resolveSelection({ selected: { path: '/synthetic/codex', version: '0.165.0', source: 'installed', reason: 'test' } });
    await started;
  });

  it('drops Codex sign-in payloads even with custom allow lists', () => {
    const secret = 'https://signin.example.invalid/device CODE-1234 cli output';
    const { scenario, report } = sanitizeScenario({
      rpc: { 'auth:codexLogin': { url: secret }, 'auth:codexLoginCancel': { output: secret } },
      rpcCases: { 'auth:codexLogin': [{ match: {}, data: secret }] },
      rpcErrors: { 'auth:codexLogin': { error: secret } },
      timeline: [{ at: 0, message: { type: 'auth:codexLoginStatus', payload: { text: secret } } }],
    }, {
      id: 'codex-sign-in',
      allowedRpcMethods: ['auth:codexLogin', 'auth:codexLoginCancel'],
      allowedPushTypes: ['auth:codexLoginStatus'],
    });
    expect(JSON.stringify(scenario)).not.toContain(secret);
    expect(report.droppedRpcMethods).toEqual(['auth:codexLogin', 'auth:codexLoginCancel']);
    expect(report.droppedPushTypes).toEqual(['auth:codexLoginStatus']);
  });
});

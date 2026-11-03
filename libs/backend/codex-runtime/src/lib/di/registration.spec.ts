import { container } from 'tsyringe';
import {
  CodexAccountUsageClient,
  CodexRuntime,
  CODEX_RUNTIME_TOKENS,
  registerCodexRuntime,
  type CodexRuntimeRegistrationPorts,
  type CodexSelectionSnapshotPort,
} from '../../index';

function ports(): CodexRuntimeRegistrationPorts {
  const selectionSnapshot: CodexSelectionSnapshotPort = {
    selectForOpen: jest.fn(async () => ({ selected: {
      path: process.execPath, version: '0.165.0', source: 'installed' as const,
      reason: 'Using installed Codex 0.165.0.',
    } })),
    current: jest.fn(() => undefined),
    markUnsupported: jest.fn(),
    activateFallback: jest.fn(async () => { throw new Error('No bundled fallback'); }),
  };
  return {
    spawner: { spawnProcess: jest.fn(() => { throw new Error('Unexpected spawn'); }) },
    selectionSnapshot,
    store: { persist: jest.fn(), markInactive: jest.fn(), read: jest.fn() },
    sink: { request: jest.fn() },
    clock: { now: jest.fn(() => 1), setTimeout: jest.fn() },
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    usage: null,
  };
}

describe('registerCodexRuntime composition', () => {
  it('binds the host selection snapshot and runtime in one scope without spawning', async () => {
    const scope = container.createChildContainer();
    const dependencies = ports();
    registerCodexRuntime(scope, dependencies);
    const runtime = scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    expect(runtime).toBeInstanceOf(CodexRuntime);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.Runtime)).toBe(runtime);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.SelectionSnapshot)).toBe(dependencies.selectionSnapshot);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(dependencies.sink);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.ThreadIdentityStore)).toBe(dependencies.store);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.Clock)).toBe(dependencies.clock);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.Logger)).toBe(dependencies.logger);
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.HomeAuthReader)).toBeNull();
    expect(scope.resolve(CodexAccountUsageClient)).toBeNull();
    expect(dependencies.spawner.spawnProcess).not.toHaveBeenCalled();
    await runtime.close();
    await scope.dispose();
  });

  it('rejects re-registration without replacing the owned runtime', async () => {
    const scope = container.createChildContainer();
    registerCodexRuntime(scope, ports());
    const runtime = scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    expect(() => registerCodexRuntime(scope, ports())).toThrow('already registered');
    expect(scope.resolve(CODEX_RUNTIME_TOKENS.Runtime)).toBe(runtime);
    await runtime.close();
    await scope.dispose();
  });

  it('owns independent runtime and usage instances per host and defers usage I/O', async () => {
    const first = container.createChildContainer();
    const second = container.createChildContainer();
    const dependencies: CodexRuntimeRegistrationPorts = {
      ...ports(),
      usage: {
        auth: {
          isAuthenticated: jest.fn(), ensureTokensFresh: jest.fn(),
          getUsageEligibility: jest.fn(), watch: jest.fn(),
        },
        profileForHome: jest.fn(() => { throw new Error('Unexpected profile lookup'); }),
      },
    };
    registerCodexRuntime(first, dependencies);
    registerCodexRuntime(second, dependencies);
    expect(first.resolve(CODEX_RUNTIME_TOKENS.HomeAuthReader)).toBe(dependencies.usage?.auth);
    const usage = first.resolve(CodexAccountUsageClient);
    expect(usage).toBeInstanceOf(CodexAccountUsageClient);
    expect(second.resolve(CodexAccountUsageClient)).not.toBe(usage);
    expect(first.resolve(CODEX_RUNTIME_TOKENS.Runtime)).not.toBe(second.resolve(CODEX_RUNTIME_TOKENS.Runtime));
    expect(dependencies.usage?.auth.watch).not.toHaveBeenCalled();
    expect(dependencies.usage?.profileForHome).not.toHaveBeenCalled();
    expect(dependencies.spawner.spawnProcess).not.toHaveBeenCalled();
    for (const scope of [first, second]) {
      await scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime).close();
      await scope.resolve(CodexAccountUsageClient).close();
      await scope.dispose();
    }
  });
});

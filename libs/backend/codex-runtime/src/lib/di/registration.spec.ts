import { container } from 'tsyringe';
import {
  CodexAccountUsageClient,
  CodexParityGate,
  CodexRuntime,
  CODEX_RUNTIME_TOKENS,
  registerCodexRuntime,
  resolveGatedCodexRuntime,
  type CodexRuntimePort,
  type CodexRuntimeRegistrationPorts,
} from '../../index';

function ports(): CodexRuntimeRegistrationPorts {
  return {
    spawner: {
      spawnProcess: jest.fn(() => {
        throw new Error('Unexpected spawn');
      }),
    },
    executable: {
      resolvedPath: '/bin/codex',
      expectedManifestRow: {
        platform: 'win32',
        arch: 'x64',
        pinnedVersion: '0.165.0',
        version: 'codex-cli 0.165.0',
        binarySha256: 'a'.repeat(64),
        schemaSha256: 'b'.repeat(64),
      },
    },
    binary: {
      executablePath: '/bin/codex',
      platform: 'win32',
      arch: 'x64',
      versionOutput: 'codex-cli 0.165.0',
      sha256: 'a'.repeat(64),
    },
    store: { persist: jest.fn(), markInactive: jest.fn(), read: jest.fn() },
    sink: { request: jest.fn() },
    clock: { now: jest.fn(() => 1), setTimeout: jest.fn() },
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    usage: null,
  };
}

describe('registerCodexRuntime composition', () => {
  it('registers real host-owned services and ports without spawning or enabling routing', async () => {
    const child = container.createChildContainer();
    const dependencies = ports();
    registerCodexRuntime(child, dependencies);
    const runtime = child.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    const runtimePort: CodexRuntimePort = runtime;
    expect(runtimePort.open).toBe(runtime.open);
    expect(runtime).toBeInstanceOf(CodexRuntime);
    expect(child.resolve(CODEX_RUNTIME_TOKENS.Runtime)).toBe(runtime);
    expect(child.resolve(CODEX_RUNTIME_TOKENS.ExecutableSource)).toBe(
      dependencies.executable,
    );
    expect(child.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(
      dependencies.sink,
    );
    expect(child.resolve(CODEX_RUNTIME_TOKENS.ThreadIdentityStore)).toBe(
      dependencies.store,
    );
    expect(child.resolve(CODEX_RUNTIME_TOKENS.Clock)).toBe(dependencies.clock);
    expect(child.resolve(CODEX_RUNTIME_TOKENS.Logger)).toBe(
      dependencies.logger,
    );
    expect(child.resolve(CODEX_RUNTIME_TOKENS.HomeAuthReader)).toBeNull();
    expect(child.resolve(CodexAccountUsageClient)).toBeNull();
    expect(
      child
        .resolve(CodexParityGate)
        .isEnabled('chat', { platform: 'win32', arch: 'x64' }),
    ).toBe(false);
    expect(dependencies.spawner.spawnProcess).not.toHaveBeenCalled();
    await runtime.close();
    await child.dispose();
  });

  it('rejects re-registration without replacing the owned instance', async () => {
    const child = container.createChildContainer();
    registerCodexRuntime(child, ports());
    const runtime = child.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    expect(() => registerCodexRuntime(child, ports())).toThrow(
      'already registered',
    );
    expect(child.resolve(CODEX_RUNTIME_TOKENS.Runtime)).toBe(runtime);
    await runtime.close();
    await child.dispose();
  });

  it('checks the parity decision before resolving a runtime for routing', async () => {
    const child = container.createChildContainer();
    registerCodexRuntime(child, ports());
    const resolve = jest.spyOn(child, 'resolve');
    expect(() =>
      resolveGatedCodexRuntime(child, 'chat', {
        platform: 'win32',
        arch: 'x64',
      }),
    ).toThrow('parity gate');
    expect(resolve).toHaveBeenCalledWith(CODEX_RUNTIME_TOKENS.ParityGate);
    expect(resolve).not.toHaveBeenCalledWith(CODEX_RUNTIME_TOKENS.Runtime);
    resolve.mockRestore();
    await child.dispose();
  });

  it('owns independent runtime and usage instances per host and defers all usage I/O', async () => {
    const first = container.createChildContainer();
    const second = container.createChildContainer();
    const dependencies: CodexRuntimeRegistrationPorts = {
      ...ports(),
      usage: {
        auth: {
          isAuthenticated: jest.fn(),
          ensureTokensFresh: jest.fn(),
          getUsageEligibility: jest.fn(),
          watch: jest.fn(),
        },
        profileForHome: jest.fn(() => {
          throw new Error('Unexpected profile lookup');
        }),
      },
    };
    registerCodexRuntime(first, dependencies);
    registerCodexRuntime(second, dependencies);
    expect(first.resolve(CODEX_RUNTIME_TOKENS.HomeAuthReader)).toBe(
      dependencies.usage?.auth,
    );
    const usage = first.resolve(CodexAccountUsageClient);
    expect(usage).toBeInstanceOf(CodexAccountUsageClient);
    expect(first.resolve(CodexAccountUsageClient)).toBe(usage);
    expect(second.resolve(CodexAccountUsageClient)).not.toBe(usage);
    expect(first.resolve(CODEX_RUNTIME_TOKENS.Runtime)).not.toBe(
      second.resolve(CODEX_RUNTIME_TOKENS.Runtime),
    );
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

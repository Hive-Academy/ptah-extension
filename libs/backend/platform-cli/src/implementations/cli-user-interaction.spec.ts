/**
 * `cli-user-interaction.spec.ts` — runs `runUserInteractionContract` against
 * `CliUserInteraction`, with `child_process.spawn` mocked at the module level
 * so `openExternal` and `writeToClipboard` never launch real browsers or
 * shell utilities during the test run.
 *
 * The impl is a v1 stub: QuickPick returns the first item, InputBox returns
 * '', message dialogs always resolve to `undefined`. We assert those invariants
 * explicitly to lock them in until the TUI-backed upgrade in a later batch.
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Hermetic child_process.spawn mock
// ---------------------------------------------------------------------------
// `openExternal` imports `spawn` via `import { spawn }` at the top of the impl
// file, which CJS-compiles to a destructured `const spawn = require(...)`. To
// intercept both that binding and the `require('child_process').spawn` call
// inside `writeToClipboard`, we replace the whole module via `jest.mock`.
//
// The array and helpers live on `globalThis` so the hoisted mock factory —
// which runs before any ES import — can reach them. Jest's `mock*`-prefix
// allowlist otherwise forbids closure references inside the factory.

interface MockSpawnCall {
  cmd: string;
  args: readonly string[];
}

declare global {
  var __mockSpawnCalls: MockSpawnCall[];
}

globalThis.__mockSpawnCalls = [];

jest.mock('child_process', () => {
  const actual =
    jest.requireActual<typeof import('child_process')>('child_process');
  // Require `events` inside the factory — ES imports at the top of this file
  // have not run yet when this factory executes. We type the local reference
  // via `typeof` so the TS compiler can treat the imported name as both a
  // runtime value and a type.
  const eventsModule = jest.requireActual<typeof import('events')>('events');
  const EventEmitterCtor: typeof eventsModule.EventEmitter =
    eventsModule.EventEmitter;

  function createStubChildProcess(): InstanceType<
    typeof eventsModule.EventEmitter
  > & {
    stdin: { write(data: string): void; end(): void };
  } {
    const emitter = new EventEmitterCtor() as InstanceType<
      typeof eventsModule.EventEmitter
    > & {
      stdin: { write(data: string): void; end(): void };
    };
    emitter.stdin = {
      write: () => undefined,
      end: () => undefined,
    };
    setImmediate(() => emitter.emit('close', 0));
    return emitter;
  }

  return {
    ...actual,
    spawn: jest.fn((cmd: string, ...rest: unknown[]) => {
      const args = Array.isArray(rest[0]) ? (rest[0] as string[]) : [];
      globalThis.__mockSpawnCalls.push({ cmd, args });
      return createStubChildProcess();
    }),
  };
});

// Imports come AFTER `jest.mock` so the mocked `child_process` is what
// the impl receives when it is loaded.
import {
  runUserInteractionContract,
  type UserInteractionSetup,
} from '@ptah-extension/platform-core/testing';
import { CliUserInteraction } from './cli-user-interaction';

beforeEach(() => {
  globalThis.__mockSpawnCalls.length = 0;
});

runUserInteractionContract('CliUserInteraction', () => {
  const provider = new CliUserInteraction();
  const setup: UserInteractionSetup = {
    provider,
    // CLI v1 is unscripted — all interactive surfaces return canned values
    // (first QuickPick item, empty InputBox, undefined for messages). The
    // contract already tolerates an unscripted impl by accepting either the
    // scripted or fallback value.
  };
  return setup;
});

describe('CliUserInteraction — CLI-specific behaviour', () => {
  let provider: CliUserInteraction;

  beforeEach(() => {
    provider = new CliUserInteraction();
  });

  // Jest's CustomConsole swaps `console.log/warn/error` out of band from
  // `jest.spyOn(console, ...)`, so we assert on the observable return value
  // rather than the log side effect. The logging behaviour is obvious from
  // the impl source; the test here locks in the contract-relevant invariant
  // (resolves undefined — no interactive selection in v1).
  it('showErrorMessage resolves undefined (no interactive selection in v1)', async () => {
    const result = await provider.showErrorMessage(
      'something went wrong',
      'Retry',
    );
    expect(result).toBeUndefined();
  });

  it('showWarningMessage resolves undefined', async () => {
    const result = await provider.showWarningMessage('careful');
    expect(result).toBeUndefined();
  });

  it('showInformationMessage resolves undefined', async () => {
    const result = await provider.showInformationMessage('fyi');
    expect(result).toBeUndefined();
  });

  it('showQuickPick returns the first item as the v1 stub contract', async () => {
    const items = [{ label: 'alpha' }, { label: 'beta' }];
    await expect(provider.showQuickPick(items)).resolves.toEqual({
      label: 'alpha',
    });
  });

  it('showQuickPick on an empty list returns undefined', async () => {
    await expect(provider.showQuickPick([])).resolves.toBeUndefined();
  });

  it('showInputBox returns undefined as the v1 stub contract', async () => {
    // v1 returns `undefined` (cancelled) until the TUI wires a real
    // prompt. Returning `''` would masquerade as a valid input and
    // break the shared `runUserInteractionContract` assertion set.
    await expect(
      provider.showInputBox({ prompt: 'name?' }),
    ).resolves.toBeUndefined();
  });

  it('withProgress runs the task directly and returns its resolved value', async () => {
    const result = await provider.withProgress(
      { title: 'work' },
      async (progress, token) => {
        expect(typeof progress.report).toBe('function');
        expect(token.isCancellationRequested).toBe(false);
        progress.report({ message: 'halfway' });
        return 42;
      },
    );
    expect(result).toBe(42);
  });

  it('openExternal validates URL scheme — non-http schemes reject without spawning', async () => {
    expect(await provider.openExternal('javascript:alert(1)')).toBe(false);
    expect(await provider.openExternal('file:///etc/passwd')).toBe(false);
    expect(await provider.openExternal('not-even-a-url')).toBe(false);
    expect(globalThis.__mockSpawnCalls).toEqual([]);
  });

  it('openExternal spawns a platform-specific opener for https and resolves true on exit 0', async () => {
    const ok = await provider.openExternal('https://example.com');
    expect(ok).toBe(true);
    expect(globalThis.__mockSpawnCalls).toHaveLength(1);
    // Different platforms invoke different binaries; assert at least that the
    // URL argument made it through somewhere in the command + arg list.
    const call = globalThis.__mockSpawnCalls[0];
    const argList: string[] = [call.cmd, ...call.args];
    expect(argList.some((a) => a.includes('https://example.com'))).toBe(true);
  });

  it('writeToClipboard spawns a platform-specific clipboard helper and resolves', async () => {
    await expect(provider.writeToClipboard('payload')).resolves.toBeUndefined();
    expect(globalThis.__mockSpawnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('openOAuthUrl with no opener returns { opened: false } and never spawns a browser', async () => {
    const bare = new CliUserInteraction(null);
    const result = await bare.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
      userCode: 'ABCD-1234',
    });
    expect(result).toEqual({ opened: false });
    // Critical: CLI must never spawn a local browser for OAuth.
    expect(globalThis.__mockSpawnCalls).toEqual([]);
  });

  it('openOAuthUrl delegates to the injected opener and returns its response', async () => {
    const opener = {
      openOAuthUrl: jest.fn().mockResolvedValue({
        opened: true,
        code: 'echoed-code',
      }),
    };
    const wired = new CliUserInteraction(opener);
    const params = {
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
      userCode: 'ABCD-1234',
    };
    const result = await wired.openOAuthUrl(params);
    expect(opener.openOAuthUrl).toHaveBeenCalledWith(params);
    expect(result).toEqual({ opened: true, code: 'echoed-code' });
    // Still no spawn — delegation only.
    expect(globalThis.__mockSpawnCalls).toEqual([]);
  });

  it('openExternal returns false when the spawned process emits an error event', async () => {
    // Override spawn to emit 'error' instead of 'close'
    const cp =
      jest.requireMock<typeof import('child_process')>('child_process');
    const eventsModule = jest.requireActual<typeof import('events')>('events');

    (cp.spawn as jest.Mock).mockImplementationOnce(() => {
      const emitter = new eventsModule.EventEmitter() as ReturnType<
        typeof cp.spawn
      >;
      (emitter as unknown as { stdin: { write(): void; end(): void } }).stdin =
        {
          write: () => undefined,
          end: () => undefined,
        };
      setImmediate(() => emitter.emit('error', new Error('spawn ENOENT')));
      return emitter;
    });

    const result = await provider.openExternal('https://example.com');
    expect(result).toBe(false);
  });

  it('writeToClipboard resolves even when the spawned process emits an error event', async () => {
    // Override spawn to emit 'error' so the error handler path is exercised.
    const cp =
      jest.requireMock<typeof import('child_process')>('child_process');
    const eventsModule = jest.requireActual<typeof import('events')>('events');

    (cp.spawn as jest.Mock).mockImplementationOnce(() => {
      const emitter = new eventsModule.EventEmitter() as ReturnType<
        typeof cp.spawn
      >;
      (emitter as unknown as { stdin: { write(): void; end(): void } }).stdin =
        {
          write: () => undefined,
          end: () => undefined,
        };
      setImmediate(() => emitter.emit('error', new Error('clipboard ENOENT')));
      return emitter;
    });

    await expect(provider.writeToClipboard('text')).resolves.toBeUndefined();
  });
});

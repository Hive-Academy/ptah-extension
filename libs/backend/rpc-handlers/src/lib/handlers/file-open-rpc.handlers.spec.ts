import 'reflect-metadata';
import { ElectronFileOpenRpcHandlers } from './file-open-rpc.handlers';

type RpcMethod = (params?: unknown) => unknown;
type ErrorListener = (error: Error) => void;

interface FakeSpawnedHandle {
  on: jest.Mock;
  whenSpawned: Promise<number | null>;
}

interface FakeSpawnRequest {
  command: string;
  args: readonly string[];
  cwd?: string;
  detached?: boolean;
  needsConsole?: boolean;
}

type FakeSpawner = jest.Mock<FakeSpawnedHandle, [FakeSpawnRequest]>;

/** Narrows a plain object to the slice of a port this handler actually reaches. */
const fake = <T>(value: unknown): T => value as T;

describe('ElectronFileOpenRpcHandlers — file:open (TASK_2026_385 Batch 3.2)', () => {
  const WS = 'C:/ws';

  function build(options: {
    spawnProcess: FakeSpawner;
    workspaceFolders?: string[];
  }): {
    method: RpcMethod;
    notifyFileOpened: jest.Mock;
    logger: { warn: jest.Mock; error: jest.Mock };
  } {
    const methods = new Map<string, RpcMethod>();
    const notifyFileOpened = jest.fn();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    };

    const handlers = new ElectronFileOpenRpcHandlers(
      fake(logger),
      fake({
        registerMethod: (name: string, fn: RpcMethod) => methods.set(name, fn),
      }),
      fake({
        getWorkspaceFolders: () => options.workspaceFolders ?? [WS],
        getWorkspaceRoot: () => WS,
      }),
      fake({ notifyFileOpened }),
      fake({ spawnProcess: options.spawnProcess }),
    );

    handlers.register();
    const method = methods.get('file:open');
    if (!method) throw new Error('file:open was not registered');

    return { method, notifyFileOpened, logger };
  }

  /**
   * A handle that resolves `whenSpawned` with `pid` — the shape a real
   * successful spawn takes: the handle returns synchronously, the pid
   * confirmation arrives on a later microtask.
   */
  function fakeHandle(pid: number | null = 1234): FakeSpawnedHandle {
    return {
      on: jest.fn(),
      whenSpawned: Promise.resolve(pid),
    };
  }

  /**
   * A handle that resolves `whenSpawned` to `null` (the port's own contract
   * for "the child never started") and, like the real `OffThreadProcessSpawner`,
   * fires its `'error'` listener SYNCHRONOUSLY-BEFORE-MICROTASK — i.e. before
   * any `await` on `whenSpawned` resumes — so a caller's listener always sees
   * the error ahead of reading the settled pid.
   */
  function fakeFailingHandle(error: Error): FakeSpawnedHandle {
    let listener: ErrorListener | undefined;
    const on = jest.fn((event: string, cb: ErrorListener) => {
      if (event === 'error') listener = cb;
    }) as FakeSpawnedHandle['on'];

    const whenSpawned = new Promise<number | null>((resolve) => {
      // Fire the error listener before the pid promise settles, mirroring
      // WorkerBackedProcess.fail(): settleSpawned() runs, then emit('error').
      queueMicrotask(() => {
        listener?.(error);
        resolve(null);
      });
    });

    return { on, whenSpawned };
  }

  it('spawns `code -g <path>:<line>`, confirms the spawn, and notifies the editor provider on success', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => fakeHandle());
    const { method, notifyFileOpened } = build({ spawnProcess });

    const result = await method({ path: 'C:\\ws\\a.ts', line: 12 });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const request = spawnProcess.mock.calls[0][0];
    expect(request.command).toBe('code');
    expect(request.args).toEqual(['-g', 'C:\\ws\\a.ts:12']);
    expect(request.cwd).toBe(WS);
    expect(request.detached).toBe(process.platform !== 'win32');
    expect(request.needsConsole).toBe(false);

    expect(notifyFileOpened).toHaveBeenCalledWith('C:\\ws\\a.ts');
    expect(result).toEqual({ success: true });
  });

  it('spawns without a line number when none is given', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => fakeHandle());
    const { method } = build({ spawnProcess });

    await method({ path: 'C:\\ws\\a.ts' });

    const request = spawnProcess.mock.calls[0][0];
    expect(request.args).toEqual(['-g', 'C:\\ws\\a.ts']);
  });

  it('refuses a path outside every workspace root without spawning', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => fakeHandle());
    const { method, notifyFileOpened } = build({
      spawnProcess,
      workspaceFolders: [WS],
    });

    const result = await method({ path: 'C:\\other\\a.ts' });

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(notifyFileOpened).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Path is outside the workspace',
    });
  });

  it('returns {success:false} instead of rejecting when spawnProcess throws synchronously', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => {
      throw new Error('ENOENT: code not found');
    });
    const { method, notifyFileOpened, logger } = build({ spawnProcess });

    const result = await method({ path: 'C:\\ws\\a.ts' });

    expect(result).toEqual({
      success: false,
      error: 'ENOENT: code not found',
    });
    expect(notifyFileOpened).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns {success:false} — not an optimistic success — when the handle reports an async spawn failure, and never notifies', async () => {
    // This is the shape the real OffThreadProcessSpawner actually produces:
    // spawnProcess() returns a handle synchronously, and the failure (e.g.
    // `code` not on PATH) surfaces later via the handle's 'error' event, not
    // a thrown exception. A handler that answers right after spawnProcess()
    // returns would report success here even though nothing launched.
    const error = new Error('spawn code ENOENT');
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) =>
      fakeFailingHandle(error),
    );
    const { method, notifyFileOpened, logger } = build({ spawnProcess });

    const result = await method({ path: 'C:\\ws\\a.ts' });

    expect(result).toEqual({ success: false, error: 'spawn code ENOENT' });
    expect(notifyFileOpened).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects malformed params without throwing', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => fakeHandle());
    const { method } = build({ spawnProcess });

    const result = (await method({})) as { success: boolean; error: string };

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  it('reports a line-specific error for an invalid line, not the generic path message', async () => {
    const spawnProcess = jest.fn((_req: FakeSpawnRequest) => fakeHandle());
    const { method } = build({ spawnProcess });

    const result = (await method({ path: 'C:\\ws\\a.ts', line: 0 })) as {
      success: boolean;
      error: string;
    };

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('line');
  });
});

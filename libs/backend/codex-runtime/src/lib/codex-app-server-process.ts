import { posix, win32 } from 'node:path';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type {
  CodexExecutableSource,
  IProcessSpawner,
} from './codex-runtime-ports';
import type { CodexExecutionProfile } from './codex-runtime.types';
import {
  verifyCodexBinary,
  type CodexBinaryIdentity,
} from './codex-protocol-manifest';
import {
  codexRequestSchemas,
  codexServerRequestSchemas,
  validateCodexFrame,
  validateCodexResult,
  type CodexProtocolFrame,
  type CodexRequestParams,
  type CodexRequestResult,
} from './codex-protocol-validator';

const FRAME_BYTES = 1024 * 1024;
const QUEUED_BYTES = 4 * FRAME_BYTES;
const MAX_PENDING = 128;
type RequestMethod = Exclude<keyof typeof codexRequestSchemas, 'initialize'>;
type ServerRequest = Extract<
  CodexProtocolFrame,
  { method: string; id: string | number }
>;
type Notification = Extract<CodexProtocolFrame, { method: string }>;
type Timer = ReturnType<typeof setTimeout>;
interface Pending {
  readonly method: keyof typeof codexRequestSchemas;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: Timer;
}
interface Approval {
  readonly controller: AbortController;
  readonly timer: Timer;
}
export interface CodexAppServerHandlers {
  /** Receives only validated server notifications. Must not retain secret payloads in logs. */
  readonly onNotification: (frame: Notification) => void;
  /** Closing the generation invalidates every outstanding request through this signal. */
  readonly onRequest: (
    frame: ServerRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

/** One child and one handshake. Construct a new instance for a new generation. */
export class CodexHomeMismatchError extends Error {
  readonly code = 'codexHomeMismatch';

  constructor() {
    super('Codex home verification failed');
    this.name = 'CodexHomeMismatchError';
  }
}

export class CodexAppServerProcess {
  private verifiedHome?: string;

  get verifiedCodexHome(): string | undefined {
    return this.verifiedHome;
  }
  private child?: SpawnedProcessHandle;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private finishClose?: () => void;
  private closing = false;
  private closed = false;
  private ready = false;
  private failure?: Error;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly approvals = new Map<string | number, Approval>();
  private frameBuffer = Buffer.alloc(FRAME_BYTES);
  private frameBytes = 0;
  private queuedBytes = 0;
  private killTimer?: Timer;
  private abortSignal?: AbortSignal;

  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly executable: CodexExecutableSource,
    /** Identity measured by composition; the launch guard rechecks the digest at spawn. */
    private readonly binary: CodexBinaryIdentity,
    private readonly profile: CodexExecutionProfile,
    private readonly handlers: CodexAppServerHandlers,
  ) {}

  start(signal?: AbortSignal): Promise<void> {
    this.startPromise ??= this.initialize(signal);
    return this.startPromise;
  }

  private async initialize(signal?: AbortSignal): Promise<void> {
    try {
      this.assertOpen();
      if (signal?.aborted) throw new Error('Codex process aborted');
      if (
        this.binary.executablePath !== this.executable.resolvedPath ||
        verifyCodexBinary(this.binary, this.executable.expectedManifestRow)
          .status !== 'ok'
      )
        throw new Error('Codex executable pin mismatch');
      this.child = this.spawner.spawnProcess({
        command: this.executable.resolvedPath,
        args: ['app-server'],
        cwd: this.profile.cwd,
        env: { ...process.env, CODEX_HOME: this.profile.normalizedHome },
        launchGuard: {
          fileContents: [
            {
              path: this.executable.resolvedPath,
              sha256: this.executable.expectedManifestRow.binarySha256,
            },
          ],
        },
      });
      this.child.on('close', this.onClose);
      this.child.on('exit', this.onExit);
      this.child.on('error', this.onError);
      this.child.stdout?.on('data', this.onData);
      this.child.stdout?.on('error', this.onError);
      this.child.stdin?.on('error', this.onError);
      this.child.stderr?.on('error', this.onError);
      this.child.stderr?.resume();
      this.abortSignal = signal;
      signal?.addEventListener('abort', this.onAbort, { once: true });
      if (signal?.aborted) this.onAbort();
      if (!this.child.stdin || !this.child.stdout)
        throw new Error('Codex process streams unavailable');
      const initialized = validateCodexResult(
        'initialize',
        await this.sendRequest(
          'initialize',
          {
            clientInfo: { name: 'ptah', version: '1' },
            // The pinned schema requires true, including for granular approval policy.
            capabilities: { experimentalApi: true },
          },
          10_000,
        ),
      );
      const paths = this.binary.platform === 'win32' ? win32 : posix;
      const canonical = (home: string): string => {
        const normalized = paths.normalize(home).replace(/[\\/]+$/, '');
        return this.binary.platform === 'win32'
          ? normalized.toLowerCase()
          : normalized;
      };
      if (
        !paths.isAbsolute(initialized.codexHome) ||
        canonical(initialized.codexHome) !==
          canonical(this.profile.normalizedHome)
      )
        throw new CodexHomeMismatchError();
      this.write({ method: 'initialized' });
      this.assertOpen();
      this.verifiedHome = this.profile.normalizedHome;
      this.ready = true;
    } catch (error) {
      if (error instanceof CodexHomeMismatchError) this.failure ??= error;
      this.fail('Codex initialization failed');
      throw this.failure;
    }
  }

  async request<M extends RequestMethod>(
    method: M,
    params: CodexRequestParams<M>,
  ): Promise<CodexRequestResult<M>> {
    this.assertOpen();
    if (!this.ready) throw new Error('Codex process not initialized');
    const result = await this.sendRequest(method, params, 30_000);
    return validateCodexResult(method, result);
  }

  private sendRequest(
    method: keyof typeof codexRequestSchemas,
    params: unknown,
    timeout: number,
  ): Promise<unknown> {
    this.assertOpen();
    if (this.pending.size >= MAX_PENDING)
      return Promise.reject(new Error('Codex request limit reached'));
    const id = ++this.nextId;
    // Reject invalid caller input without putting it on the wire or retaining a timer.
    validateCodexFrame({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail('Codex request timed out'),
        timeout,
      );
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        this.fail('Codex request write failed');
      }
    });
  }

  private readonly onData = (chunk: unknown): void => {
    if (this.closing) return;
    try {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid stream chunk');
      let offset = 0;
      while (offset < chunk.length && !this.closing) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const length = end - offset;
        if (this.frameBytes + length > FRAME_BYTES)
          throw new Error('Frame limit');
        // Fixed storage also bounds allocation overhead for single-byte fragmentation.
        chunk.copy(this.frameBuffer, this.frameBytes, offset, end);
        this.frameBytes += length;
        if (newline < 0) break;
        const bytes = this.frameBuffer.subarray(0, this.frameBytes);
        this.frameBytes = 0;
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
        this.receive(value);
        offset = end + 1;
      }
    } catch {
      this.fail('Codex invalid protocol frame');
    }
  };

  private receive(value: unknown): void {
    // Lookup supplies validation context only; no correlation is settled before validation.
    const id =
      typeof value === 'object' && value !== null && 'id' in value
        ? value.id
        : undefined;
    const pending = typeof id === 'number' ? this.pending.get(id) : undefined;
    const frame = validateCodexFrame(value, pending?.method);
    if ('method' in frame) {
      if ('id' in frame) {
        if (
          !this.ready ||
          !Object.hasOwn(codexServerRequestSchemas, frame.method)
        )
          throw new Error('Unexpected server request');
        this.dispatchApproval(frame);
      } else {
        if (!this.ready || frame.method === 'initialized')
          throw new Error('Unexpected notification');
        this.handlers.onNotification(frame);
      }
      return;
    }
    if (!pending || typeof frame.id !== 'number')
      throw new Error('Unknown response');
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if ('error' in frame) pending.reject(new Error('Codex request rejected'));
    else pending.resolve(frame.result);
  }

  private dispatchApproval(frame: ServerRequest): void {
    if (this.approvals.size >= MAX_PENDING || this.approvals.has(frame.id))
      throw new Error('Approval limit or duplicate');
    const controller = new AbortController();
    const timer = setTimeout(
      () => this.fail('Codex approval timed out'),
      300_000,
    );
    const approval = { controller, timer };
    this.approvals.set(frame.id, approval);
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return undefined;
        return this.handlers.onRequest(frame, controller.signal);
      })
      .then((result) => {
        if (this.closing || this.approvals.get(frame.id) !== approval) return;
        this.write({ id: frame.id, result }, frame.method);
        clearTimeout(timer);
        this.approvals.delete(frame.id);
      })
      .catch(() => this.fail('Codex server request failed'));
  }

  private write(frame: unknown, responseMethod?: string): void {
    this.assertOpen();
    validateCodexFrame(frame, responseMethod);
    const bytes = Buffer.from(JSON.stringify(frame) + '\n');
    if (
      bytes.length - 1 > FRAME_BYTES ||
      this.queuedBytes + bytes.length > QUEUED_BYTES
    )
      throw new Error('Codex outbound queue limit reached');
    if (!this.child?.stdin) throw new Error('Codex stdin unavailable');
    this.queuedBytes += bytes.length;
    this.child.stdin.write(bytes, (error?: Error | null) => {
      this.queuedBytes = Math.max(0, this.queuedBytes - bytes.length);
      if (error) this.fail('Codex stdin failed');
    });
  }

  private assertOpen(): void {
    if (this.closing || this.failure)
      throw this.failure ?? new Error('Codex process closed');
  }
  private readonly onError = (): void => {
    this.fail('Codex process failed');
  };
  private readonly onAbort = (): void => {
    this.fail('Codex process aborted');
  };
  private readonly onExit = (): void => {
    this.fail('Codex process exited');
  };
  private readonly onClose = (): void => {
    this.closed = true;
    this.fail('Codex process closed');
    this.cleanup();
    this.finishClose?.();
  };

  private fail(message: string): void {
    this.failure ??= new Error(message);
    void this.close();
  }

  /** Stops sends immediately; resolution means the child and its stdio have closed. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = new Promise<void>((resolve) => {
      this.finishClose = resolve;
    });
    this.closing = true;
    this.ready = false;
    const error = this.failure ?? new Error('Codex process closed');
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    for (const entry of this.approvals.values()) {
      clearTimeout(entry.timer);
      entry.controller.abort();
    }
    this.approvals.clear();
    this.frameBuffer = Buffer.alloc(0);
    this.frameBytes = 0;
    this.abortSignal?.removeEventListener('abort', this.onAbort);
    if (!this.child || this.closed) {
      this.cleanup();
      this.finishClose?.();
    } else {
      this.killTimer = setTimeout(() => {
        this.killTimer = undefined;
        // A kill request is not proof of exit. Keep waiting for close.
        if (!this.closed) {
          try {
            this.child?.kill('SIGKILL');
          } catch {
            this.failure ??= new Error('Codex process kill failed');
          }
        }
      }, 1000);
      try {
        this.child.stdin?.end();
      } catch {
        this.failure ??= new Error('Codex stdin close failed');
      }
    }
    return this.closePromise;
  }

  dispose(): Promise<void> {
    return this.close();
  }

  private cleanup(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = undefined;
    this.child?.off('close', this.onClose);
    this.child?.off('exit', this.onExit);
    this.child?.off('error', this.onError);
    this.child?.stdout?.off('data', this.onData);
    this.child?.stdout?.off('error', this.onError);
    this.child?.stdin?.off('error', this.onError);
    this.child?.stderr?.off('error', this.onError);
    this.queuedBytes = 0;
  }
}

/**
 * In-app Kimi Code sign-in: runs `kimi login --region <region>` as a child
 * process (fixed argv, no shell), finds the verification URL in its output,
 * opens it in the system browser, and reports each phase as a
 * `KimiCodeLoginState`.
 *
 * Success is exit code 0 AND a readable CLI login afterwards (an already
 * signed-in CLI prints `Logged in to managed:kimi-code.` and exits 0 at once).
 * Non-zero exit, a 10-minute timeout or `cancel()` end the sign-in; the child
 * process tree is killed on timeout and cancel.
 *
 * Not `@injectable()`: the deps object carries test seams (clock, PATH,
 * platform). `register-providers.ts` builds it through a factory.
 *
 * SECURITY: CLI output is parsed in memory and dropped. Only the `https:`
 * verification URL and an upper-case device code leave this file; no line of
 * output is logged or forwarded, because a CLI may print a token.
 */
import { stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  killProcessTree,
  type IProcessSpawner,
  type IUserInteraction,
  type SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type {
  KimiCodeLoginErrorCode,
  KimiCodeLoginState,
} from '@ptah-extension/shared';
import type { KimiCodeCredentialStore } from './kimi-code-credential-store';
import type { KimiCodeHomeResolver } from './kimi-code-home-resolver';
import type {
  IKimiCodeAuthService,
  IKimiCodeLoginService,
} from './kimi-code-provider.types';

/** A sign-in that has not finished after this is stopped. */
export const KIMI_CODE_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LINE_CHARS = 8_192;

const ERROR_COPY: Record<KimiCodeLoginErrorCode, string> = {
  'not-installed':
    'The Kimi Code CLI is not installed. Install it, or add a Kimi Code API key instead.',
  'spawn-failed': 'Kimi Code sign-in could not be started. Try again.',
  exited: 'Kimi Code sign-in did not complete. Try again.',
  timeout: 'Kimi Code sign-in timed out. Try again.',
  'no-credentials':
    'Kimi Code sign-in finished, but no Kimi Code login was found. Try again.',
};
const CANCELLED_COPY = 'Kimi Code sign-in was cancelled.';

export interface KimiCodeLoginServiceDeps {
  readonly logger: Logger;
  readonly spawner: IProcessSpawner;
  readonly userInteraction: Pick<IUserInteraction, 'openExternal'>;
  readonly kimiAuth: Pick<IKimiCodeAuthService, 'clearCache' | 'getStatus'>;
  readonly store: Pick<KimiCodeCredentialStore, 'readRegion'>;
  readonly home: KimiCodeHomeResolver;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
  readonly killTree?: (pid: number) => Promise<void>;
}

interface RunningLogin {
  readonly child: SpawnedProcessHandle;
  readonly onState: (state: KimiCodeLoginState) => void;
  state: KimiCodeLoginState;
  stopReason: 'cancelled' | 'timeout' | null;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

/** A sign-in between `start()` and the spawn; `cancel()` can still stop it. */
interface StartingLogin {
  cancelled: boolean;
}

export class KimiCodeLoginService implements IKimiCodeLoginService {
  private running: RunningLogin | null = null;
  private starting: Promise<KimiCodeLoginState> | null = null;
  private startup: StartingLogin | null = null;
  private disposed = false;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly killTree: (pid: number) => Promise<void>;

  constructor(private readonly deps: KimiCodeLoginServiceDeps) {
    this.environment = deps.environment ?? process.env;
    this.platform = deps.platform ?? process.platform;
    this.timeoutMs = deps.timeoutMs ?? KIMI_CODE_LOGIN_TIMEOUT_MS;
    this.killTree =
      deps.killTree ?? ((pid) => killProcessTree(pid, 'SIGKILL'));
  }

  start(
    onState: (state: KimiCodeLoginState) => void,
  ): Promise<KimiCodeLoginState> {
    // After host shutdown nothing is started.
    if (this.disposed) return Promise.resolve(cancelledState());
    if (this.running && !this.running.settled) {
      return Promise.resolve(this.running.state);
    }
    if (this.starting) return this.starting;
    // The cancellable identity exists before the first await, so cancel()
    // and dispose() can stop a sign-in that is still resolving its
    // executable or region.
    const startup: StartingLogin = { cancelled: false };
    this.startup = startup;
    const starting = this.launch(startup, onState).finally(() => {
      if (this.startup === startup) this.startup = null;
      this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  cancel(): boolean {
    const startup = this.startup;
    if (startup && !startup.cancelled) {
      startup.cancelled = true;
      this.deps.logger.info('[KimiCodeLogin] Sign-in cancelled before kimi login started');
      return true;
    }
    const running = this.running;
    if (!running || running.settled) return false;
    this.stop(running, 'cancelled');
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private async launch(
    startup: StartingLogin,
    onState: (state: KimiCodeLoginState) => void,
  ): Promise<KimiCodeLoginState> {
    const cancelledNow = (): KimiCodeLoginState | undefined => {
      if (!startup.cancelled && !this.disposed) return undefined;
      const state = cancelledState();
      onState(state);
      return state;
    };
    const executable = await this.resolveExecutable();
    const afterResolve = cancelledNow();
    if (afterResolve) return afterResolve;
    if (!executable) {
      this.deps.logger.info('[KimiCodeLogin] Kimi Code CLI not found');
      const state = failed('not-installed');
      onState(state);
      return state;
    }
    const region = await this.deps.store.readRegion();
    // Last check before the spawn: nothing below awaits until the child runs.
    const beforeSpawn = cancelledNow();
    if (beforeSpawn) return beforeSpawn;
    let child: SpawnedProcessHandle;
    try {
      child = this.deps.spawner.spawnProcess({
        command: executable,
        args: ['login', '--region', region],
        env: this.childEnvironment(),
      });
    } catch (error: unknown) {
      this.deps.logger.warn(
        `[KimiCodeLogin] Could not start kimi login (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      const state = failed('spawn-failed');
      onState(state);
      return state;
    }
    const running: RunningLogin = {
      child,
      onState,
      state: { status: 'starting' },
      stopReason: null,
      timer: null,
      settled: false,
    };
    this.running = running;
    // From here cancel() stops the child instead of the startup.
    this.startup = null;
    this.observe(running);
    this.deps.logger.info('[KimiCodeLogin] kimi login started');
    onState(running.state);
    return running.state;
  }

  private observe(running: RunningLogin): void {
    const { child } = running;
    const stdout = new LineSplitter((line) => this.onLine(running, line));
    const stderr = new LineSplitter((line) => this.onLine(running, line));
    const onStdout = (chunk: unknown): void => stdout.push(chunk);
    const onStderr = (chunk: unknown): void => stderr.push(chunk);
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);

    const cleanup = (): void => {
      if (running.timer) clearTimeout(running.timer);
      running.timer = null;
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('close', onClose);
      child.off('error', onError);
    };
    const onClose = (code: number | null): void => {
      cleanup();
      void this.complete(running, code);
    };
    const onError = (error: Error): void => {
      cleanup();
      const notFound = 'code' in error && error.code === 'ENOENT';
      this.deps.logger.warn(
        `[KimiCodeLogin] kimi login failed to run (${notFound ? 'ENOENT' : error.name})`,
      );
      this.settle(running, failed(notFound ? 'not-installed' : 'spawn-failed'));
    };
    child.on('close', onClose);
    child.on('error', onError);
    running.timer = setTimeout(() => this.stop(running, 'timeout'), this.timeoutMs);
    running.timer.unref?.();
  }

  private onLine(running: RunningLogin, rawLine: string): void {
    if (running.settled || running.stopReason) return;
    const line = stripAnsi(rawLine);
    let next = running.state;
    if (!next.verificationUrl) {
      const url = extractHttpsUrl(line);
      if (url) next = { ...next, status: 'awaiting-browser', verificationUrl: url };
    }
    if (!next.userCode) {
      const code = extractUserCode(line);
      if (code) next = { ...next, userCode: code };
    }
    if (next === running.state) return;
    const openNow = !running.state.verificationUrl && next.verificationUrl;
    this.update(running, next);
    if (openNow && next.verificationUrl) {
      void this.openBrowser(running, next.verificationUrl);
    }
  }

  private async openBrowser(running: RunningLogin, url: string): Promise<void> {
    let opened = false;
    // Scheme allowlist right before the OS hands the URL to a handler: only
    // `https:` is ever opened (no `file:`, custom protocols or `javascript:`).
    if (!extractHttpsUrl(url)) return;
    // A cancelled or finished sign-in never opens a browser.
    if (running.settled || running.stopReason) return;
    try {
      opened = await this.deps.userInteraction.openExternal(url);
    } catch (error: unknown) {
      this.deps.logger.warn(
        `[KimiCodeLogin] Could not open the browser (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
    }
    if (running.settled) return;
    this.update(running, { ...running.state, browserOpened: opened });
  }

  private async complete(
    running: RunningLogin,
    code: number | null,
  ): Promise<void> {
    if (running.settled) return;
    if (running.stopReason === 'cancelled') {
      this.settle(running, { ...running.state, status: 'cancelled', error: CANCELLED_COPY });
      return;
    }
    if (running.stopReason === 'timeout') {
      this.settle(running, { ...running.state, ...failed('timeout') });
      return;
    }
    if (code !== 0) {
      this.deps.logger.warn(`[KimiCodeLogin] kimi login exited with ${String(code)}`);
      this.settle(running, { ...running.state, ...failed('exited') });
      return;
    }
    this.deps.kimiAuth.clearCache();
    let loggedIn = false;
    try {
      loggedIn = (await this.deps.kimiAuth.getStatus()).loggedIn;
    } catch (error: unknown) {
      this.deps.logger.warn(
        `[KimiCodeLogin] Could not read the login after sign-in (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
    }
    this.deps.logger.info(
      `[KimiCodeLogin] kimi login finished (${loggedIn ? 'signed in' : 'no login found'})`,
    );
    this.settle(
      running,
      loggedIn
        ? { ...running.state, status: 'succeeded' }
        : { ...running.state, ...failed('no-credentials') },
    );
  }

  /** Kill the child; `complete` reports the outcome once it has closed. */
  private stop(running: RunningLogin, reason: 'cancelled' | 'timeout'): void {
    if (running.settled || running.stopReason) return;
    running.stopReason = reason;
    this.deps.logger.info(`[KimiCodeLogin] Stopping kimi login (${reason})`);
    void running.child.whenSpawned
      .then((pid) => {
        if (pid === null) {
          // Never started: no close will follow.
          void this.complete(running, null);
          return;
        }
        return this.killTree(pid);
      })
      .catch((error: unknown) => {
        this.deps.logger.warn(
          `[KimiCodeLogin] Process tree kill failed (${
            error instanceof Error ? error.name : 'unknown'
          })`,
        );
        running.child.kill('SIGKILL');
      });
  }

  private update(running: RunningLogin, state: KimiCodeLoginState): void {
    running.state = state;
    running.onState(state);
  }

  private settle(running: RunningLogin, state: KimiCodeLoginState): void {
    if (running.settled) return;
    running.settled = true;
    if (running.timer) clearTimeout(running.timer);
    running.timer = null;
    this.update(running, state);
  }

  /** `~/.kimi-code/bin/kimi(.exe)`, else the first `kimi` on PATH. */
  private async resolveExecutable(): Promise<string | undefined> {
    const isWindows = this.platform === 'win32';
    const homeCandidates = isWindows
      ? [join(this.deps.home.binDir, 'kimi.exe'), join(this.deps.home.binDir, 'kimi.cmd')]
      : [join(this.deps.home.binDir, 'kimi')];
    const pathValue =
      this.environment['PATH'] ?? this.environment['Path'] ?? '';
    const extensions = isWindows
      ? (this.environment['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter((ext) => ext.length > 0)
      : [''];
    const pathCandidates = pathValue
      .split(isWindows ? ';' : delimiter)
      .filter((dir) => dir.trim().length > 0)
      .flatMap((dir) => extensions.map((ext) => join(dir.trim(), `kimi${ext.toLowerCase()}`)));
    for (const candidate of [...homeCandidates, ...pathCandidates]) {
      if (await isFile(candidate)) return candidate;
    }
    return undefined;
  }

  /** The host env without Anthropic credentials, colour off for parsing. */
  private childEnvironment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.environment)) {
      if (!key.toUpperCase().startsWith('ANTHROPIC_')) env[key] = value;
    }
    env['NO_COLOR'] = '1';
    return env;
  }
}

function cancelledState(): KimiCodeLoginState {
  return { status: 'cancelled', error: CANCELLED_COPY };
}

function failed(errorCode: KimiCodeLoginErrorCode): KimiCodeLoginState {
  return { status: 'failed', errorCode, error: ERROR_COPY[errorCode] };
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
/** OSC sequences (`ESC ] ... BEL` or `ESC ] ... ESC \`), e.g. hyperlinks. */
const ANSI_OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
/** CSI sequences (`ESC [ ... final`), e.g. colours and cursor moves. */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

/** Strip ANSI CSI/OSC escape sequences. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_OSC, '').replace(ANSI_CSI, '');
}

/** First `https:` URL in `line`, validated, without trailing punctuation. */
export function extractHttpsUrl(line: string): string | undefined {
  const match = /https:\/\/[^\s"'<>`]+/.exec(line);
  if (!match) return undefined;
  const candidate = match[0].replace(/[).,;:!?\]]+$/, '');
  if (candidate.length > 2048) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    // degradation-audit: optional-capability - an unparseable URL is not a
    // verification URL; parsing continues with the next line.
    return undefined;
  }
}

/** Device code from a `code: ABCD-1234` line; upper-case only. */
export function extractUserCode(line: string): string | undefined {
  const match = /code[:\s]+([A-Za-z0-9-]{4,32})\b/i.exec(line);
  const code = match?.[1];
  if (!code || code !== code.toUpperCase() || !/[A-Z0-9]/.test(code)) {
    return undefined;
  }
  return code;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    // degradation-audit: optional-capability - a missing candidate path is
    // the normal case while searching PATH.
    return false;
  }
}

/** Decode a stream into lines without keeping more than one line in memory. */
class LineSplitter {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: unknown): void {
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) return;
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n|\r/);
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > MAX_LINE_CHARS) this.buffer = '';
    for (const line of lines) {
      if (line.length <= MAX_LINE_CHARS) this.onLine(line);
    }
  }
}

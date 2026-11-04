import { stat } from 'node:fs/promises';
import { killProcessTree, type IProcessSpawner, type IUserInteraction, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type { CodexSelection } from '@ptah-extension/codex-runtime';
import type { CodexLoginErrorCode, CodexLoginMode, CodexLoginState } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { httpsUrlCandidates, parseHttpsUrl, stripAnsi, LineSplitter } from '../cli-login-output';
import type { ICodexAuthService, ICodexLoginService } from './codex-provider.types';

export const CODEX_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
export const CODEX_LOGIN_KILL_TIMEOUT_MS = 1_500;
const CODEX_SIGN_IN_URL_MAX = 4096;
const CODE = /\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/;
const ERROR_COPY: Record<CodexLoginErrorCode, string> = {
  unavailable: 'The Codex CLI is unavailable. Try again.',
  'spawn-failed': 'Codex sign-in could not be started. Try again.',
  exited: 'Codex sign-in did not complete. Try again.',
  timeout: 'Codex sign-in timed out. Try again.',
  'no-credentials': 'Codex sign-in finished, but no login was found. Try again.',
};

export function validateSignInUrl(raw: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const parsed = parseHttpsUrl(raw, CODEX_SIGN_IN_URL_MAX);
  if (!parsed || parsed.length > CODEX_SIGN_IN_URL_MAX) return undefined;
  const url = new URL(parsed);
  return url.username || url.password ? undefined : parsed;
}

export function extractSignInUrl(line: string): string | undefined {
  for (const candidate of httpsUrlCandidates(line)) {
    const valid = validateSignInUrl(candidate);
    if (valid) return valid;
  }
  return undefined;
}

export interface CodexLoginServiceDeps {
  readonly selection: () => Promise<CodexSelection>;
  readonly codexAuth: Pick<ICodexAuthService, 'clearCache' | 'getSignInOutcome'>;
  readonly spawner: IProcessSpawner;
  readonly userInteraction: Pick<IUserInteraction, 'openExternal'>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
  readonly fileExists?: (path: string) => Promise<boolean>;
  readonly killTree?: (pid: number) => Promise<void>;
}

interface Attempt {
  state: CodexLoginState;
  readonly onState: (state: CodexLoginState) => void;
  child?: SpawnedProcessHandle;
  settled: boolean;
  stopReason?: 'cancelled' | 'timeout';
  stopPromise?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
  browserAttempted: boolean;
}

export class CodexLoginService implements ICodexLoginService {
  private active: Attempt | null = null;
  private starting: Promise<CodexLoginState> | null = null;
  private sequence = 0;
  private disposed = false;
  private readonly fileExists: (path: string) => Promise<boolean>;
  private readonly killTree: (pid: number) => Promise<void>;

  constructor(private readonly deps: CodexLoginServiceDeps) {
    this.fileExists = deps.fileExists ?? (async path => {
      try { return (await stat(path)).isFile(); } catch { return false; }
    });
    this.killTree = deps.killTree ?? (pid => killProcessTree(pid, 'SIGKILL'));
  }

  async start(options: { mode?: CodexLoginMode; restart?: boolean }, onState: (state: CodexLoginState) => void): Promise<CodexLoginState> {
    const mode = options.mode ?? 'browser';
    if (this.disposed) return this.cancelledState(mode);
    const previous = this.active;
    if (previous?.stopPromise) {
      await previous.stopPromise;
      if (this.active === previous) this.starting = null;
    }
    if (this.active && !this.active.settled) {
      if (!options.restart) return this.active.state;
      this.cancel();
      await this.active.stopPromise;
      this.starting = null;
    }
    if (this.disposed) return this.cancelledState(mode);
    if (this.starting) return this.starting;
    const attempt: Attempt = {
      state: { attemptId: String(++this.sequence), status: 'starting', mode },
      onState, settled: false, browserAttempted: false,
    };
    this.active = attempt;
    this.emit(attempt, attempt.state);
    const launch = this.launch(attempt).finally(() => {
      if (this.starting === launch) this.starting = null;
    });
    this.starting = launch;
    return launch;
  }

  cancel(): boolean {
    const attempt = this.active;
    if (!attempt || attempt.settled) return false;
    void this.stop(attempt, 'cancelled');
    return true;
  }

  isActive(): boolean { return !!this.active && !this.active.settled; }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel();
    try { await this.active?.stopPromise; } catch { /* stop handles kill failures */ }
  }

  private async launch(attempt: Attempt): Promise<CodexLoginState> {
    let selected = false;
    try {
      const selection = await this.deps.selection();
      if (attempt.settled) return attempt.state;
      if (!selection?.selected?.path) return this.fail(attempt, 'unavailable');
      const env = await this.childEnvironment();
      if (attempt.settled) return attempt.state;
      selected = true;
      const child = this.deps.spawner.spawnProcess({
        command: selection.selected.path,
        args: attempt.state.mode === 'device' ? ['login', '--device-auth'] : ['login'],
        env,
      });
      attempt.child = child;
      this.observe(attempt, child);
      child.stdin?.end();
      const pid = await child.whenSpawned;
      if (attempt.settled) return attempt.state;
      if (pid === null) return this.fail(attempt, 'spawn-failed');
      this.emit(attempt, { ...attempt.state,
        status: attempt.state.status === 'starting' ? 'running' : attempt.state.status,
        executableSource: selection.selected.source });
      return attempt.state;
    } catch (error: unknown) {
      if (attempt.settled) return attempt.state;
      this.deps.logger.warn(`[CodexLogin] Start failed (${error instanceof Error ? error.name : 'unknown'})`);
      return this.fail(attempt, selected ? 'spawn-failed' : 'unavailable');
    }
  }

  private async childEnvironment(): Promise<Record<string, string | undefined>> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.deps.environment ?? process.env)) {
      if (!key.toUpperCase().startsWith('ANTHROPIC_')) env[key] = value;
    }
    env['NO_COLOR'] = '1';
    const platform = this.deps.platform ?? process.platform;
    if (platform !== 'darwin' && platform !== 'win32') {
      for (const path of ['/usr/bin/true', '/bin/true']) {
        if (await this.fileExists(path)) { env['BROWSER'] = path; break; }
      }
    }
    return env;
  }

  private observe(attempt: Attempt, child: SpawnedProcessHandle): void {
    const stdout = new LineSplitter(line => this.onLine(attempt, line));
    const stderr = new LineSplitter(line => this.onLine(attempt, line));
    const onStdout = (chunk: unknown): void => stdout.push(chunk);
    const onStderr = (chunk: unknown): void => stderr.push(chunk);
    const onClose = (code: number | null): void => {
      stdout.flush();
      stderr.flush();
      attempt.cleanup?.();
      void this.complete(attempt, code);
    };
    const onError = (error: Error): void => {
      attempt.cleanup?.();
      this.deps.logger.warn(`[CodexLogin] Process failed (${error.name})`);
      this.fail(attempt, 'spawn-failed');
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('close', onClose);
    child.on('error', onError);
    attempt.cleanup = () => {
      if (attempt.timer) clearTimeout(attempt.timer);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('close', onClose);
      child.off('error', onError);
    };
    attempt.timer = setTimeout(() => { void this.stop(attempt, 'timeout'); }, this.deps.timeoutMs ?? CODEX_LOGIN_TIMEOUT_MS);
    attempt.timer.unref?.();
  }

  private onLine(attempt: Attempt, raw: string): void {
    if (attempt.settled || attempt.stopReason) return;
    const line = stripAnsi(raw);
    const url = attempt.state.verificationUrl ? undefined : extractSignInUrl(line);
    const code = attempt.state.userCode ? undefined : CODE.exec(line)?.[0];
    if (!url && !code) return;
    const next: CodexLoginState = { ...attempt.state, status: 'awaiting-user',
      verificationUrl: attempt.state.verificationUrl ?? url,
      userCode: attempt.state.userCode ?? code };
    this.emit(attempt, next);
    if (url && !attempt.browserAttempted) {
      attempt.browserAttempted = true;
      void this.openBrowser(attempt, url);
    }
  }

  private async openBrowser(attempt: Attempt, raw: string): Promise<void> {
    if (attempt.settled || attempt.stopReason) return;
    const url = validateSignInUrl(raw);
    if (!url) return;
    let opened = false;
    try { opened = await this.deps.userInteraction.openExternal(url); }
    catch (error: unknown) {
      this.deps.logger.warn(`[CodexLogin] Browser open failed (${error instanceof Error ? error.name : 'unknown'})`);
    }
    if (!attempt.settled) this.emit(attempt, { ...attempt.state, browserOpened: opened });
  }

  private async complete(attempt: Attempt, code: number | null): Promise<void> {
    if (attempt.settled) return;
    if (attempt.stopReason === 'cancelled') { this.settle(attempt, { ...attempt.state, status: 'cancelled' }); return; }
    if (attempt.stopReason === 'timeout') { this.fail(attempt, 'timeout'); return; }
    if (code !== 0) { this.fail(attempt, 'exited', code); return; }
    try {
      this.deps.codexAuth.clearCache();
      const outcome = await this.deps.codexAuth.getSignInOutcome();
      if (attempt.settled) return;
      if (outcome === 'signed-in') this.settle(attempt, { ...attempt.state, status: 'succeeded' });
      else this.fail(attempt, 'no-credentials');
    } catch (error: unknown) {
      this.deps.logger.warn(`[CodexLogin] Auth read failed (${error instanceof Error ? error.name : 'unknown'})`);
      this.fail(attempt, 'no-credentials');
    }
  }

  private stop(attempt: Attempt, reason: 'cancelled' | 'timeout'): Promise<void> {
    if (attempt.stopPromise) return attempt.stopPromise;
    if (attempt.settled) return Promise.resolve();
    attempt.stopReason = reason;
    this.settle(attempt, reason === 'cancelled'
      ? { ...attempt.state, status: 'cancelled' }
      : { ...attempt.state, status: 'failed', errorCode: 'timeout', error: ERROR_COPY.timeout });
    attempt.stopPromise = (async () => {
      const child = attempt.child;
      if (!child) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const pid = await child.whenSpawned;
            if (pid === null) throw new Error('spawn unavailable');
            await this.killTree(pid);
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('kill timeout')), CODEX_LOGIN_KILL_TIMEOUT_MS);
            timer.unref?.();
          }),
        ]);
      } catch (error: unknown) {
        this.deps.logger.warn(`[CodexLogin] Process tree kill failed (${error instanceof Error ? error.name : 'unknown'})`);
        try { child.kill('SIGKILL'); } catch { /* The attempt is already settled. */ }
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return attempt.stopPromise;
  }

  private emit(attempt: Attempt, state: CodexLoginState): void {
    attempt.state = state;
    try { attempt.onState(state); }
    catch (error: unknown) {
      this.deps.logger.warn(`[CodexLogin] Status callback failed (${error instanceof Error ? error.name : 'unknown'})`);
    }
  }

  private settle(attempt: Attempt, state: CodexLoginState): CodexLoginState {
    if (attempt.settled) return attempt.state;
    attempt.settled = true;
    attempt.cleanup?.();
    this.emit(attempt, state);
    return attempt.state;
  }

  private fail(attempt: Attempt, code: CodexLoginErrorCode, exitCode?: number | null): CodexLoginState {
    return this.settle(attempt, { ...attempt.state, status: 'failed', errorCode: code,
      error: ERROR_COPY[code], ...(exitCode !== undefined ? { exitCode } : {}) });
  }

  private cancelledState(mode: CodexLoginMode): CodexLoginState {
    return { attemptId: String(this.sequence), mode, status: 'cancelled' };
  }
}

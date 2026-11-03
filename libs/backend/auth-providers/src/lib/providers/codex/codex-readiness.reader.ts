import { CodexExecutableUnavailableError, type CodexSelection } from '@ptah-extension/codex-runtime';
import type { AuthGetCodexReadinessParams, AuthGetCodexReadinessResponse, CodexReadinessBinary, CodexReadinessSignIn } from '@ptah-extension/shared';
import type { ICodexAuthService, ICodexReadinessReader } from './codex-provider.types';
import { isCodexHomeExplicitlyEmpty } from './codex-home-auth.service';

export const CODEX_READINESS_DEADLINE_MS = 20_000;
export const CODEX_READINESS_FRESH_MS = 60_000;

interface ReadinessHost {
  env(): Readonly<Record<string, string | undefined>>;
  now(): number;
}

interface ReadinessLogger {
  info(message: string, details: {
    binary: string;
    signIn: string;
    unreadable: CodexReadinessSignIn['unreadable'];
    trigger: AuthGetCodexReadinessParams['trigger'];
  }): void;
}

const NODE_HOST: ReadinessHost = { env: () => process.env, now: () => Date.now() };
const TIMEOUT_BINARY: CodexReadinessBinary = { state: 'unknown', reason: 'timeout' };
const TIMEOUT_SIGN_IN: CodexReadinessSignIn = { outcome: 'timeout' };

type Answer = (result: AuthGetCodexReadinessResponse) => void;

/** A single bounded readiness probe. The selection callback resolves its snapshot only when read. */
export class CodexReadinessReader implements ICodexReadinessReader {
  private active: Set<Answer> | null = null;
  private followUp: Set<Answer> | null = null;
  private last: { result: AuthGetCodexReadinessResponse; completedAt: number } | null = null;

  constructor(
    private readonly selection: () => Promise<CodexSelection>,
    private readonly auth: Pick<ICodexAuthService, 'getSignInOutcome'>,
    private readonly logger: ReadinessLogger,
    private readonly host: ReadinessHost = NODE_HOST,
  ) {}

  read(options: AuthGetCodexReadinessParams = {}): Promise<AuthGetCodexReadinessResponse> {
    return new Promise(resolve => {
      let answered = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const answer: Answer = result => {
        if (answered) return;
        answered = true;
        if (deadline) clearTimeout(deadline);
        try {
          this.logger.info('[readiness] codex', {
            binary: result.binary.state === 'unknown' ? result.binary.reason : result.binary.state,
            signIn: result.signIn.outcome,
            unreadable: result.signIn.unreadable,
            trigger: options.trigger,
          });
        } catch {
          // Logging must not turn a completed readiness read into an RPC failure.
        }
        resolve(result);
      };

      if (this.active) {
        if (options.refresh) (this.followUp ??= new Set()).add(answer);
        else this.active.add(answer);
        deadline = setTimeout(() => answer(this.timeoutResult()), CODEX_READINESS_DEADLINE_MS);
        deadline.unref?.();
        return;
      }
      if (!options.refresh && this.last && this.host.now() - this.last.completedAt < CODEX_READINESS_FRESH_MS) {
        answer(this.last.result);
        return;
      }
      this.start(new Set([answer]));
      deadline = setTimeout(() => answer(this.timeoutResult()), CODEX_READINESS_DEADLINE_MS);
      deadline.unref?.();
    });
  }

  private start(callers: Set<Answer>): void {
    this.active = callers;
    void this.probe().then(result => {
      if (!this.isTimeout(result)) this.last = { result, completedAt: this.host.now() };
      else this.last = null;
      this.active = null;
      callers.forEach(answer => answer(result));
      const queued = this.followUp;
      this.followUp = null;
      if (queued) this.start(queued);
    });
  }

  private async probe(): Promise<AuthGetCodexReadinessResponse> {
    let binary: CodexReadinessBinary = TIMEOUT_BINARY;
    let signIn: CodexReadinessSignIn = TIMEOUT_SIGN_IN;
    let expired = false;
    let release!: () => void;
    const deadline = new Promise<void>(resolve => { release = resolve; });
    const timer = setTimeout(() => { expired = true; release(); }, CODEX_READINESS_DEADLINE_MS);
    timer.unref?.();

    const binaryTask = Promise.resolve().then(() => this.selection()).then(
      selection => { if (!expired) binary = {
        state: 'found', path: selection.selected.path, version: selection.selected.version,
        source: selection.selected.source,
      }; },
      error => { if (!expired) binary = error instanceof CodexExecutableUnavailableError
        ? { state: 'missing' } : { state: 'unknown', reason: 'local' }; },
    );
    const signInTask = Promise.resolve().then<Awaited<ReturnType<ICodexAuthService['getSignInOutcome']>> | CodexReadinessSignIn>(() =>
      isCodexHomeExplicitlyEmpty(this.host.env())
        ? { outcome: 'unreadable', unreadable: 'home' } as const
        : this.auth.getSignInOutcome(),
    ).then(
      outcome => { if (!expired) signIn = typeof outcome === 'string'
        ? outcome === 'unreadable' ? { outcome, unreadable: 'auth-file' } : { outcome }
        : outcome; },
      () => { if (!expired) signIn = { outcome: 'unreadable', unreadable: 'auth-file' }; },
    );

    await Promise.race([Promise.all([binaryTask, signInTask]), deadline]);
    expired = true;
    clearTimeout(timer);
    return { binary, signIn, checkedAt: new Date(this.host.now()).toISOString() };
  }

  private timeoutResult(): AuthGetCodexReadinessResponse {
    return { binary: TIMEOUT_BINARY, signIn: TIMEOUT_SIGN_IN, checkedAt: new Date(this.host.now()).toISOString() };
  }

  private isTimeout(result: AuthGetCodexReadinessResponse): boolean {
    return (result.binary.state === 'unknown' && result.binary.reason === 'timeout') ||
      result.signIn.outcome === 'timeout';
  }
}

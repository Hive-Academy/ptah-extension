import { certifiedEnvDigest, isCertifiedClaudeEnvKey } from '@ptah-extension/agent-sdk';
import type { ProviderAmbientClaudeStatus } from '@ptah-extension/shared';
import type { ClaudeAccountCommand, ClaudeChildCloseReceipt } from './claude-account-command';
import type { ClaudeExecutableProbeResult } from './claude-route-certifier';

/** A completed attempt younger than this answers a read without `refresh`. */
export const AMBIENT_STATUS_FRESH_MS = 60_000;
/** One attempt: `--version` (10 s) plus `auth status` (10 s); the kill grace comes on top. */
export const AMBIENT_STATUS_BUDGET_MS = 20_000;
/** Every read is answered within this, queue included; below the 30 s webview RPC timeout. */
export const AMBIENT_READ_DEADLINE_MS = 25_000;

/** The two Claude directory keys the ambient login may be selected by. */
const AMBIENT_DIRECTORY_KEYS = ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'] as const;
const LINE_BREAK = /[\r\n]/;

/** Host facts the reader reads; injected so specs use a fake env and clock. */
export interface ClaudeAmbientStatusHost {
  env(): Readonly<Record<string, string | undefined>>;
  now(): number;
}

export const NODE_AMBIENT_STATUS_HOST: ClaudeAmbientStatusHost = Object.freeze({
  env: () => process.env,
  now: () => Date.now(),
});

/** Fixed-text diagnostics only; never output, env values, paths or identity. */
export interface ClaudeAmbientStatusLogger {
  warn(message: string): void;
}

export type ClaudeAmbientStatusCommands = Pick<ClaudeAccountCommand, 'certifyExecutable' | 'ambientStatus'>;

/**
 * Child env of the ambient probe: the certified allowlist plus the two Claude
 * directory keys when set. No `ANTHROPIC_*`, API key or cloud selector is
 * copied (an API key is not "the Claude login"). A value with a line break is
 * skipped, so the digest lines stay unambiguous.
 */
export function ambientProbeEnv(hostEnv: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (value === undefined || LINE_BREAK.test(value) || !isCertifiedClaudeEnvKey(key)) continue;
    env[key] = value;
  }
  for (const key of AMBIENT_DIRECTORY_KEYS) {
    const value = hostEnv[key];
    if (value !== undefined && value.trim() !== '' && !LINE_BREAK.test(value)) env[key] = value;
  }
  return Object.freeze(env);
}

/** Answered when no attempt for the current key completed; carries no timestamp. */
const UNKNOWN_TIMEOUT: ProviderAmbientClaudeStatus = Object.freeze({
  state: 'unknown', reason: 'timeout', checkedAt: null,
});

type AmbientOutcome =
  | { readonly state: 'connected' | 'signed-out' }
  | { readonly state: 'unknown'; readonly reason: 'cli-missing' | 'timeout' | 'unreadable' };

/** One pending `read()` caller: answered exactly once, by its attempt or by its deadline. */
class Caller {
  private settled = false;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly resolve: (status: ProviderAmbientClaudeStatus) => void) {
    this.timer = setTimeout(() => this.answer(UNKNOWN_TIMEOUT), AMBIENT_READ_DEADLINE_MS);
  }

  answer(status: ProviderAmbientClaudeStatus): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.resolve(status);
  }
}

interface Attempt {
  readonly key: string;
  readonly generation: number;
  readonly controller: AbortController;
  readonly callers: Set<Caller>;
  /** Set when the environment changed (or the reader was disposed) while it ran. */
  obsolete: boolean;
}

interface CompletedAttempt {
  readonly status: ProviderAmbientClaudeStatus;
  readonly completedAt: number;
}

function certifyFailure(code: Extract<ClaudeExecutableProbeResult, { ok: false }>['code']): AmbientOutcome {
  if (code === 'unsupported-store') return { state: 'unknown', reason: 'cli-missing' };
  if (code === 'timeout' || code === 'cancelled') return { state: 'unknown', reason: 'timeout' };
  return { state: 'unknown', reason: 'unreadable' };
}

/**
 * The host's single, bounded, cached read of the ambient Claude login
 * (implementation-plan-p5.md §4, P5-D14..P5-D16). A serial slot: at most one
 * ambient child exists at any time, either the active attempt's or one
 * retained, unclosed receipt of an earlier attempt. A same-key read joins the
 * active attempt, a refresh queues one follow-up, an environment change aborts
 * and awaits the active attempt. `checkedAt` comes only from a completed
 * attempt for the current key. `read()` never throws.
 */
export class ClaudeAmbientLoginStatusReader {
  private active: Attempt | null = null;
  private followUp: Set<Caller> | null = null;
  private readonly retained = new Set<ClaudeChildCloseReceipt>();
  private readonly unsubscribers = new Map<ClaudeChildCloseReceipt, () => void>();
  /** Only the current key's completed attempt is kept. */
  private readonly lastAttempt = new Map<string, CompletedAttempt>();
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly commands: ClaudeAmbientStatusCommands,
    private readonly host: ClaudeAmbientStatusHost,
    private readonly logger: ClaudeAmbientStatusLogger,
  ) {}

  read(options: { readonly refresh?: boolean } = {}): Promise<ProviderAmbientClaudeStatus> {
    const key = this.currentKey();
    if (this.disposed) return Promise.resolve(this.blocked(key));
    const last = this.lastAttempt.get(key);
    if (!options.refresh && last && this.host.now() - last.completedAt < AMBIENT_STATUS_FRESH_MS) {
      return Promise.resolve(last.status);
    }
    return new Promise(resolve => this.enqueue(key, options.refresh === true, new Caller(resolve)));
  }

  /** Aborts the active attempt, answers queued callers and disposes every retained receipt. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.active.obsolete = true;
      this.active.controller.abort();
    }
    const queued = this.followUp;
    this.followUp = null;
    const blocked = this.blocked(this.currentKey());
    queued?.forEach(caller => caller.answer(blocked));
    for (const receipt of this.retained) receipt.dispose();
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.retained.clear();
    this.unsubscribers.clear();
  }

  private enqueue(key: string, refresh: boolean, caller: Caller): void {
    const active = this.active;
    if (!active) {
      this.start(new Set([caller]));
      return;
    }
    if (!active.obsolete && active.key === key && !refresh) {
      active.callers.add(caller);
      return;
    }
    if (active.key !== key && !active.obsolete) {
      // Environment changed: the active attempt is obsolete; it is awaited (its close or
      // close receipt) before the current key's attempt starts.
      active.obsolete = true;
      active.controller.abort();
    }
    // A refresh (or a read behind an obsolete attempt) waits for the single follow-up.
    (this.followUp ??= new Set()).add(caller);
  }

  private start(callers: Set<Caller>): void {
    const key = this.currentKey();
    if (this.hasUnclosedReceipt()) {
      const blocked = this.blocked(key);
      callers.forEach(caller => caller.answer(blocked));
      return;
    }
    const attempt: Attempt = {
      key, generation: ++this.generation, controller: new AbortController(), callers, obsolete: false,
    };
    this.active = attempt;
    void this.probe(attempt).then(status => this.finish(attempt, status));
  }

  private async probe(attempt: Attempt): Promise<ProviderAmbientClaudeStatus> {
    const { signal } = attempt.controller;
    const budget = setTimeout(() => attempt.controller.abort(), AMBIENT_STATUS_BUDGET_MS);
    let outcome: AmbientOutcome;
    try {
      outcome = await this.attempt(signal);
    } catch {
      // degradation-audit: reported - an unexpected failure inside a started attempt is answered as unreadable and logged with fixed text.
      this.logger.warn('[auth-providers] Ambient Claude status attempt failed unexpectedly.');
      outcome = { state: 'unknown', reason: 'unreadable' };
    } finally {
      clearTimeout(budget);
    }
    // The attempt completed (success or failure): only now is a timestamp taken.
    const checkedAt = new Date(this.host.now()).toISOString();
    return Object.freeze(outcome.state === 'unknown'
      ? { state: outcome.state, reason: outcome.reason, checkedAt }
      : { state: outcome.state, checkedAt });
  }

  private async attempt(signal: AbortSignal): Promise<AmbientOutcome> {
    const certified = await this.commands.certifyExecutable(signal);
    if (!certified.ok) {
      this.retain(certified.closeReceipt);
      return certifyFailure(certified.code);
    }
    if (signal.aborted) return { state: 'unknown', reason: 'timeout' };
    const env = ambientProbeEnv(this.host.env());
    const probe = await this.commands.ambientStatus({ executable: certified.executable, env, signal });
    this.retain(probe.closeReceipt);
    if (probe.timedOut || signal.aborted) return { state: 'unknown', reason: 'timeout' };
    if (probe.status === null) return { state: 'unknown', reason: 'unreadable' };
    return { state: probe.status.loggedIn ? 'connected' : 'signed-out' };
  }

  private finish(attempt: Attempt, status: ProviderAmbientClaudeStatus): void {
    if (this.active === attempt) this.active = null;
    const queued = this.followUp;
    this.followUp = null;
    const current = !this.disposed && !attempt.obsolete && attempt.key === this.currentKey()
      && attempt.generation === this.generation;
    if (current) {
      this.lastAttempt.clear();
      this.lastAttempt.set(attempt.key, { status, completedAt: this.host.now() });
      attempt.callers.forEach(caller => caller.answer(status));
      if (queued) this.start(queued);
      return;
    }
    if (this.disposed) {
      const blocked = this.blocked(attempt.key);
      attempt.callers.forEach(caller => caller.answer(blocked));
      queued?.forEach(caller => caller.answer(blocked));
      return;
    }
    // Obsolete: its result is dropped; its callers get the current key's attempt.
    const next = queued ?? new Set<Caller>();
    attempt.callers.forEach(caller => next.add(caller));
    this.start(next);
  }

  /** Earlier completed attempt for `key`, unchanged, or `unknown/timeout` without a timestamp. */
  private blocked(key: string): ProviderAmbientClaudeStatus {
    return this.lastAttempt.get(key)?.status ?? UNKNOWN_TIMEOUT;
  }

  private currentKey(): string {
    const key = certifiedEnvDigest(ambientProbeEnv(this.host.env()));
    if (!this.lastAttempt.has(key)) this.lastAttempt.clear();
    return key;
  }

  private hasUnclosedReceipt(): boolean {
    for (const receipt of this.retained) if (!receipt.closed) return true;
    return false;
  }

  /** Keeps an unproved child's receipt until its close; it blocks every spawn meanwhile. */
  private retain(receipt: ClaudeChildCloseReceipt | undefined): void {
    if (!receipt || receipt.closed) return;
    if (this.disposed) {
      receipt.dispose();
      return;
    }
    this.retained.add(receipt);
    const unsubscribe = receipt.onClosed(() => {
      this.retained.delete(receipt);
      this.unsubscribers.get(receipt)?.();
      this.unsubscribers.delete(receipt);
    });
    if (this.retained.has(receipt)) this.unsubscribers.set(receipt, unsubscribe);
  }
}

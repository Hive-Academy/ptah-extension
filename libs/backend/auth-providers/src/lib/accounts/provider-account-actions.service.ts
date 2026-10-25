import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import type { ClaudeAccountActionCommand, ClaudeAccountActionTarget, ProviderAccountActionPort } from '@ptah-extension/auth-providers-tokens';
import { killProcessTree, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type { ProviderAccountActionResult, ProviderAccountResultCode, ProviderAccountState } from '@ptah-extension/shared';
import {
  accountActionResult, CLAUDE_ACCOUNT_CHILD_LIMITS, ClaudeAccountCommand, type ClaudeChildCloseReceipt,
} from './claude-account-command';
import { ClaudeLoginConsole } from './claude-login-console';
import {
  ClaudeRouteCertifier, type ClaudeAuthContext, type ClaudeCoverageOutcome, type ClaudeProbeRefusal,
} from './claude-route-certifier';
import { ProviderAccountStore } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

/** Sign-in limits (implementation-plan.md Component 6). */
export const CLAUDE_SIGN_IN_LIMITS = Object.freeze({
  deadlineMs: 300_000,
  pollIntervalMs: 2_000,
  maxUnprovedProbes: 3,
});

/** Read-only text for the user's own terminal when no console window can be opened. */
export interface ProviderAccountSignInFallbackText {
  readonly platform: 'win32' | 'posix';
  readonly script: string;
}

export interface ProviderAccountSignInStart extends ProviderAccountActionResult {
  readonly fallback?: ProviderAccountSignInFallbackText;
}

/** Snapshot sent to `onStateChanged` listeners. Carries no path, identity or CLI text. */
export interface ProviderAccountStateChange {
  readonly profileId: string;
  readonly state: ProviderAccountState;
  readonly revision: number;
}

interface TerminalOutcome {
  readonly code: ProviderAccountResultCode;
  readonly state: ProviderAccountState;
  /** `undefined` keeps the stored reference; `null` clears it. */
  readonly identityRef?: string | null;
}

interface LedgerEntry {
  closed: boolean;
  /** Console entries only: the window the gate kills. Probe children were already killed by the command. */
  readonly console?: SpawnedProcessHandle;
  /** Removes this entry's child listeners. */
  readonly detach: () => void;
}

/**
 * Ptah-owned children of one auth operation (finding 3). One entry per child:
 * the console and each status or logout probe that outlived its limit and kill
 * grace (tracked through the command's close receipt). Listeners stay until
 * release, so a late close still marks its entry closed. A child without a
 * receipt whose close was not seen can never be proved, so it stays unproved.
 * The user's own terminal (fallback mode) is never an entry.
 */
class OwnedChildLedger {
  /** Unclosed children with no way to observe their close (no receipt). */
  private unobservable = 0;
  private readonly entries: LedgerEntry[] = [];
  private waiter: (() => void) | null = null;
  private released = false;

  constructor(private readonly changed: () => void) {}

  /** Probe children whose close is not yet proved. */
  get unprovedProbes(): number {
    return this.unobservable + this.entries.filter(entry => !entry.console && !entry.closed).length;
  }

  /** A closed probe needs nothing; an open one is tracked through its receipt, or stays unproved without one. */
  recordProbe(terminated: boolean, receipt?: ClaudeChildCloseReceipt): void {
    if (terminated) return;
    if (!receipt || this.released) {
      receipt?.dispose();
      this.unobservable += 1;
      return;
    }
    const entry: LedgerEntry = { closed: false, detach: () => receipt.dispose() };
    this.entries.push(entry);
    receipt.onClosed(() => this.markClosed(entry));
  }

  /**
   * A certifier refusal: each `reg.exe` close receipt becomes its own entry;
   * an unterminated refusal without receipts stays unproved.
   */
  recordRefusal(refusal: ClaudeProbeRefusal): void {
    if (!refusal.closeReceipts) {
      this.recordProbe(refusal.terminated);
      return;
    }
    for (const receipt of refusal.closeReceipts) this.recordProbe(false, receipt);
  }

  trackConsole(child: SpawnedProcessHandle): void {
    // An error after start proves nothing; the listener only keeps the event handled.
    const onError = (): undefined => undefined;
    const onClose = (): void => this.markClosed(entry);
    const entry: LedgerEntry = {
      closed: false,
      console: child,
      detach: () => { child.off('close', onClose); child.off('error', onError); },
    };
    this.entries.push(entry);
    child.on('close', onClose);
    child.on('error', onError);
    void child.whenSpawned.then(pid => {
      // No pid: no process was created, so nothing can outlive the operation.
      if (pid === null) this.markClosed(entry);
    });
  }

  allClosed(): boolean {
    return this.unobservable === 0 && this.entries.every(entry => entry.closed);
  }

  /**
   * Kills each unclosed console tree and waits up to the grace for its close.
   * Probe children were already killed, and waited on for the grace, by the command.
   */
  async stop(): Promise<void> {
    const consolesClosed = (): boolean => this.entries.every(entry => !entry.console || entry.closed);
    if (consolesClosed()) return;
    for (const entry of this.entries) {
      if (entry.closed || !entry.console) continue;
      void entry.console.whenSpawned
        .then(pid => (pid === null ? undefined : killProcessTree(pid, 'SIGKILL')))
        .catch(() => {
          // degradation-audit: optional-capability — a failed tree kill leaves the console unproved until its close
        });
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, CLAUDE_ACCOUNT_CHILD_LIMITS.killGraceMs);
      function done(): void { clearTimeout(timer); resolve(); }
      this.waiter = () => {
        if (consolesClosed()) { this.waiter = null; done(); }
      };
      this.waiter();
    });
    this.waiter = null;
  }

  /** Removes every child listener (console and probe receipts); later closes are no longer seen. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.waiter = null;
    for (const entry of this.entries) entry.detach();
  }

  private markClosed(entry: LedgerEntry): void {
    if (entry.closed || this.released) return;
    entry.closed = true;
    this.waiter?.();
    this.changed();
  }
}

interface AuthOperation {
  readonly kind: 'sign-in' | 'sign-out';
  readonly profileId: string;
  readonly operationId: string;
  readonly epoch: number;
  /** Profile revision while the reservation holds it. */
  readonly revision: number;
  readonly priorState: ProviderAccountState;
  readonly route: CanonicalProviderAccountRoute;
  readonly controller: AbortController;
  readonly ledger: OwnedChildLedger;
  context?: ClaudeAuthContext;
  startup?: Promise<unknown>;
  inFlight?: Promise<unknown>;
  pollTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  terminal?: TerminalOutcome;
  result?: Promise<ProviderAccountActionResult>;
  /** Set when the gate found an unproved child; a late console close may still settle it. */
  blocked?: TerminalOutcome;
  settled: boolean;
}

interface StatusOperation {
  readonly kind: 'status';
  readonly controller: AbortController;
  done?: Promise<ProviderAccountActionResult>;
}

type ActiveOperation = AuthOperation | StatusOperation;

/**
 * Sign-in, status and sign-out for named Claude accounts. The store arbitrates
 * across hosts; `active` holds only this process's live operations. Every
 * settings-reading child is preceded by a coverage check; every terminal
 * transition goes through one completion gate that requires every owned
 * child's close before `completeAuth`.
 */
@injectable()
export class ProviderAccountActionsService implements ProviderAccountActionPort {
  private readonly ownerId = randomUUID();
  private readonly active = new Map<string, ActiveOperation>();
  private readonly listeners = new Set<(change: ProviderAccountStateChange) => void>();
  private readonly disposalController = new AbortController();
  /** Close receipts of status-action children that outlived the action; disposed on `dispose`. */
  private readonly statusReceipts = new Set<ClaudeChildCloseReceipt>();
  private disposal?: Promise<void>;

  constructor(
    @inject(ProviderAccountStore) private readonly store: ProviderAccountStore,
    @inject(ClaudeAccountCommand) private readonly commands: ClaudeAccountCommand,
    @inject(ClaudeRouteCertifier) private readonly certifier: ClaudeRouteCertifier,
    @inject(ClaudeLoginConsole) private readonly loginConsole: ClaudeLoginConsole,
  ) {}

  onStateChanged(listener: (change: ProviderAccountStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposalController.abort();
    const pending: Promise<unknown>[] = [];
    for (const operation of this.active.values()) {
      if (operation.kind === 'sign-in') {
        pending.push(this.finishSignIn(operation, { code: 'cancelled', state: 'cancelled' }));
      } else {
        operation.controller.abort();
        if (operation.kind === 'status' && operation.done) pending.push(operation.done);
        if (operation.kind === 'sign-out' && operation.result) pending.push(operation.result);
      }
    }
    // Bounded: probe children end within their limit plus the kill grace, the console within the grace.
    // An unproved operation keeps its reservation; nothing is released during shutdown.
    this.disposal = Promise.all(pending).then(() => {
      for (const operation of this.active.values()) {
        if (operation.kind !== 'status') this.stopTimers(operation);
        if (operation.kind !== 'status') operation.ledger.release();
      }
      for (const receipt of this.statusReceipts) receipt.dispose();
      this.statusReceipts.clear();
      this.active.clear();
      this.listeners.clear();
    });
    return this.disposal;
  }

  async readStatus(target: ClaudeAccountActionTarget): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      if (target.provider !== 'claude') return accountActionResult('wrong-provider');
      const owned = this.active.get(target.profileId);
      if (owned?.kind === 'sign-in' && !owned.terminal) {
        // One poll tick inside the existing sign-in reservation.
        return (await this.poll(owned)) ?? accountActionResult('ok');
      }
      const profile = this.store.get(target.profileId);
      // Restart never turns an unresolved operation into a successful status.
      if (owned || profile.state === 'pending') return accountActionResult('busy');
      const route = resolveProviderAccountRoute(profile.canonical_route);
      const operationId = randomUUID();
      const { authEpoch } = this.store.reserveStatus(target.profileId, profile.revision, route, operationId, this.ownerId);
      const operation: StatusOperation = { kind: 'status', controller: new AbortController() };
      this.active.set(target.profileId, operation);
      operation.done = this.runStatus(target.profileId, operationId, authEpoch, profile.state, route, operation.controller.signal)
        .catch((error: unknown) => this.refusal(error))
        .finally(() => { if (this.active.get(target.profileId) === operation) this.active.delete(target.profileId); });
      return await operation.done;
    } catch (error: unknown) { return this.refusal(error); }
  }

  async startSignIn(command: ClaudeAccountActionCommand): Promise<ProviderAccountSignInStart> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      const operation = this.reserve(command, 'sign-in');
      if (!('ledger' in operation)) return operation;
      operation.deadlineTimer = setTimeout(() => {
        void this.finishSignIn(operation, this.failure(operation, 'timeout'));
      }, CLAUDE_SIGN_IN_LIMITS.deadlineMs);
      // A throwing collaborator leaves its children unknown: fail closed and keep the reservation.
      const startup = this.startUp(operation).catch(() => {
        operation.ledger.recordProbe(false);
        return { ok: false as const, outcome: this.failure(operation, 'identity-unproved') };
      });
      operation.startup = startup;
      const started = await startup;
      if (operation.terminal) return await this.finishSignIn(operation, operation.terminal);
      if (!started.ok) return await this.finishSignIn(operation, started.outcome);
      this.schedulePoll(operation);
      this.emit(operation.profileId);
      return started.fallback
        ? { ...accountActionResult('ok'), fallback: started.fallback }
        : accountActionResult('ok');
    } catch (error: unknown) { return this.refusal(error); }
  }

  async cancelSignIn(command: ClaudeAccountActionCommand): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      if (command.provider !== 'claude') return accountActionResult('wrong-provider');
      const active = this.active.get(command.profileId);
      const profile = this.store.get(command.profileId);
      if (!active) return accountActionResult(profile.state === 'pending' ? 'busy' : 'conflict');
      if (active.kind !== 'sign-in' || active.operationId !== command.operationId ||
        active.revision !== command.expectedRevision || profile.revision !== active.revision || profile.auth_epoch !== active.epoch) {
        return accountActionResult('conflict');
      }
      if (active.blocked) return accountActionResult('busy');
      return await this.finishSignIn(active, { code: 'cancelled', state: 'cancelled' });
    } catch (error: unknown) { return this.refusal(error); }
  }

  async signOut(command: ClaudeAccountActionCommand): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      const operation = this.reserve(command, 'sign-out');
      if (!('ledger' in operation)) return operation;
      const result = this.runSignOut(operation)
        .catch(() => {
          // A throwing collaborator leaves its children unknown: fail closed and keep the reservation.
          operation.ledger.recordProbe(false);
          return this.failure(operation, 'identity-unproved');
        })
        .then(outcome => this.settle(operation, outcome));
      operation.result = result;
      return await result;
    } catch (error: unknown) { return this.refusal(error); }
  }

  private reserve(command: ClaudeAccountActionCommand, kind: 'sign-in' | 'sign-out'): AuthOperation | ProviderAccountActionResult {
    if (command.provider !== 'claude') return accountActionResult('wrong-provider');
    const profile = this.store.get(command.profileId);
    if (profile.revision !== command.expectedRevision) return accountActionResult('conflict');
    if (this.active.has(command.profileId) || profile.state === 'pending') return accountActionResult('busy');
    const route = resolveProviderAccountRoute(profile.canonical_route);
    // reserveAuth compares the persisted path, physical identity and fingerprint; runs make it busy.
    const reservation = this.store.reserveAuth(command.profileId, command.expectedRevision, route,
      command.operationId, this.ownerId, kind);
    const operation: AuthOperation = {
      kind,
      profileId: command.profileId,
      operationId: command.operationId,
      epoch: reservation.authEpoch,
      revision: command.expectedRevision + 1,
      priorState: profile.state,
      route,
      controller: new AbortController(),
      ledger: new OwnedChildLedger(() => this.childClosed(operation)),
      settled: false,
    };
    this.active.set(command.profileId, operation);
    return operation;
  }

  /** Auth context, coverage, then the console (or the fallback script). */
  private async startUp(operation: AuthOperation): Promise<
    | { readonly ok: true; readonly fallback?: ProviderAccountSignInFallbackText }
    | { readonly ok: false; readonly outcome: TerminalOutcome }
  > {
    const signal = operation.controller.signal;
    const prepared = await this.certifier.authContext({ route: operation.route, signal });
    if (!prepared.ok) {
      operation.ledger.recordRefusal(prepared);
      return { ok: false, outcome: this.failure(operation, prepared.code) };
    }
    operation.context = prepared.context;
    if (operation.terminal) return { ok: true };
    const coverage = await this.coverage(operation, prepared.context);
    if (coverage) return { ok: false, outcome: coverage };
    if (operation.terminal) return { ok: true };
    const start = await this.loginConsole.launch(prepared.context, signal);
    // No child started, so the refusal settles at once (release); no fallback names a replaced directory.
    if (start.kind === 'route-changed') return { ok: false, outcome: this.failure(operation, 'route-changed') };
    if (start.kind === 'started') {
      // Tracked even after a terminal transition, so the gate kills and waits for it.
      operation.ledger.trackConsole(start.child);
      return { ok: true };
    }
    const fallback = this.loginConsole.fallbackScript(prepared.context);
    return { ok: true, fallback: { platform: fallback.dialect === 'powershell' ? 'win32' : 'posix', script: fallback.script } };
  }

  private schedulePoll(operation: AuthOperation): void {
    if (operation.terminal || operation.pollTimer) return;
    // At the unproved limit only the deadline (or cancel/disposal) can end the operation.
    if (operation.ledger.unprovedProbes >= CLAUDE_SIGN_IN_LIMITS.maxUnprovedProbes) return;
    operation.pollTimer = setTimeout(() => {
      operation.pollTimer = undefined;
      void this.poll(operation);
    }, CLAUDE_SIGN_IN_LIMITS.pollIntervalMs);
  }

  /** One status poll; returns the gate result when the poll ended the sign-in. */
  private async poll(operation: AuthOperation): Promise<ProviderAccountActionResult | undefined> {
    if (operation.terminal || !operation.context) return operation.result;
    if (operation.inFlight) { await operation.inFlight; return operation.result; }
    if (operation.ledger.unprovedProbes >= CLAUDE_SIGN_IN_LIMITS.maxUnprovedProbes) return undefined;
    if (operation.pollTimer) { clearTimeout(operation.pollTimer); operation.pollTimer = undefined; }
    const tick = this.statusTick(operation, operation.context).catch(() => {
      // A throwing collaborator leaves its child unknown: fail closed and keep the reservation.
      operation.ledger.recordProbe(false);
      return this.failure(operation, 'identity-unproved');
    });
    operation.inFlight = tick;
    const outcome = await tick;
    operation.inFlight = undefined;
    if (operation.terminal) return operation.result;
    if (outcome) return this.finishSignIn(operation, outcome);
    this.schedulePoll(operation);
    return undefined;
  }

  /** Coverage, one status child, then the S9 re-check. `undefined`: still signed out. */
  private async statusTick(operation: AuthOperation, context: ClaudeAuthContext): Promise<TerminalOutcome | undefined> {
    const signal = operation.controller.signal;
    const before = await this.coverage(operation, context);
    if (before) return before;
    if (signal.aborted) return undefined;
    const probed = await this.commands.status(context, signal);
    operation.ledger.recordProbe(probed.terminated, probed.closeReceipt);
    // An unproved child still keeps the reservation: the completion gate waits on the ledger.
    if (probed.routeChanged) return this.failure(operation, 'route-changed');
    if (!probed.terminated || signal.aborted) return undefined;
    const after = await this.coverage(operation, context);
    if (after) return after;
    const status = probed.status;
    if (!status?.loggedIn) return undefined;
    // Class O still signs in (D-S); its named runs refuse later.
    if (!status.configDirectoryMatches) return this.failure(operation, 'identity-mismatch');
    return { code: 'ok', state: 'signed-in', identityRef: status.identityReference };
  }

  private async runSignOut(operation: AuthOperation): Promise<TerminalOutcome> {
    const signal = operation.controller.signal;
    const prepared = await this.certifier.authContext({ route: operation.route, signal });
    if (!prepared.ok) {
      operation.ledger.recordRefusal(prepared);
      return this.failure(operation, prepared.code);
    }
    const context = prepared.context;
    const beforeLogout = await this.coverage(operation, context);
    if (beforeLogout) return beforeLogout;
    if (signal.aborted) return { code: 'cancelled', state: 'cancelled' };
    const logout = await this.commands.logout(context, signal);
    operation.ledger.recordProbe(logout.terminated, logout.closeReceipt);
    if (logout.routeChanged) return this.failure(operation, 'route-changed');
    if (signal.aborted) return { code: 'cancelled', state: 'cancelled' };
    if (!logout.terminated) return this.failure(operation, 'identity-unproved');
    // The S9 re-check after logout is also the coverage check before the status child.
    const beforeStatus = await this.coverage(operation, context);
    if (beforeStatus) return beforeStatus;
    const probed = await this.commands.status(context, signal);
    operation.ledger.recordProbe(probed.terminated, probed.closeReceipt);
    if (probed.routeChanged) return this.failure(operation, 'route-changed');
    if (signal.aborted) return { code: 'cancelled', state: 'cancelled' };
    if (!probed.terminated) return this.failure(operation, 'identity-unproved');
    const afterStatus = await this.coverage(operation, context);
    if (afterStatus) return afterStatus;
    if (probed.status && !probed.status.loggedIn) return { code: 'ok', state: 'signed-out', identityRef: null };
    return this.failure(operation, 'unsupported-source');
  }

  private async runStatus(profileId: string, operationId: string, authEpoch: number, priorState: ProviderAccountState,
    route: CanonicalProviderAccountRoute, signal: AbortSignal): Promise<ProviderAccountActionResult> {
    const complete = (code: ProviderAccountResultCode, state: ProviderAccountState, terminated: boolean,
      identityRef?: string | null): ProviderAccountActionResult => {
      this.store.completeStatus(operationId, this.ownerId, authEpoch, state, terminated, identityRef);
      this.emit(profileId);
      return accountActionResult(code);
    };
    const unobserved = (code: ProviderAccountResultCode, terminated: boolean): ProviderAccountActionResult => {
      if (signal.aborted || !terminated) return complete(signal.aborted ? 'cancelled' : code, priorState, terminated);
      return complete(code, priorState === 'signed-in' ? 'disconnected' : 'failed', true);
    };
    // The status action does not follow registry probe closes: their receipts are
    // disposed (listeners removed) and the unproved refusal keeps the reservation.
    const refused = (refusal: ClaudeProbeRefusal): ProviderAccountActionResult => {
      for (const receipt of refusal.closeReceipts ?? []) receipt.dispose();
      return unobserved(refusal.code, refusal.terminated);
    };
    const prepared = await this.certifier.authContext({ route, signal });
    if (!prepared.ok) return refused(prepared);
    const before = await this.certifier.checkCoverage(prepared.context, signal);
    if (!before.ok) return refused(before);
    if (signal.aborted) return unobserved('cancelled', true);
    const probed = await this.commands.status(prepared.context, signal);
    // An unproved child keeps the reservation until its close is seen (prior state, so nothing else changes).
    const unproved = (code: ProviderAccountResultCode): ProviderAccountActionResult => {
      const receipt = probed.closeReceipt;
      let result: ProviderAccountActionResult;
      try {
        result = unobserved(code, false);
      } catch (error: unknown) {
        receipt?.dispose();
        throw error;
      }
      if (receipt) this.releaseStatusOnClose(receipt, () => complete(code, priorState, true));
      return result;
    };
    // No status is recorded for a changed route.
    if (probed.routeChanged) return probed.terminated ? unobserved('route-changed', true) : unproved('route-changed');
    if (!probed.terminated) return unproved('identity-unproved');
    const after = await this.certifier.checkCoverage(prepared.context, signal);
    if (!after.ok) return refused(after);
    const status = probed.status;
    if (!status) return unobserved('unsupported-source', true);
    if (!status.loggedIn) return complete('ok', 'signed-out', true, null);
    if (!status.configDirectoryMatches) return unobserved('identity-mismatch', true);
    return complete('ok', 'signed-in', true, status.identityReference);
  }

  /**
   * Keeps observing an unproved status-action child after the action returned.
   * Only its close releases the reservation; disposal removes the listeners and
   * leaves the reservation held.
   */
  private releaseStatusOnClose(receipt: ClaudeChildCloseReceipt, release: () => void): void {
    this.statusReceipts.add(receipt);
    receipt.onClosed(() => {
      this.statusReceipts.delete(receipt);
      if (this.disposalController.signal.aborted) return;
      try {
        release();
      } catch {
        // degradation-audit: reported - the store refused the late release (it changed); the reservation stays held for manual recovery.
      }
    });
  }

  /** A coverage refusal starts no child and is a terminal failure of the operation. */
  private async coverage(operation: AuthOperation, context: ClaudeAuthContext): Promise<TerminalOutcome | undefined> {
    const checked: ClaudeCoverageOutcome = await this.certifier.checkCoverage(context, operation.controller.signal);
    if (checked.ok) return undefined;
    operation.ledger.recordRefusal(checked);
    return this.failure(operation, checked.code === 'cancelled' ? 'cancelled' : 'unsupported-source');
  }

  private failure(operation: AuthOperation, code: ProviderAccountResultCode): TerminalOutcome {
    if (code === 'cancelled') return { code, state: 'cancelled' };
    return { code, state: operation.priorState === 'signed-in' ? 'disconnected' : 'failed' };
  }

  /** First terminal transition wins: a late success never overwrites cancel or timeout. */
  private finishSignIn(operation: AuthOperation, outcome: TerminalOutcome): Promise<ProviderAccountActionResult> {
    if (operation.result) return operation.result;
    operation.terminal = outcome;
    this.stopTimers(operation);
    operation.controller.abort();
    operation.result = (async () => {
      await operation.startup;
      await operation.inFlight;
      return this.settle(operation, outcome);
    })();
    return operation.result;
  }

  /** The common completion gate (Component 6). */
  private async settle(operation: AuthOperation, outcome: TerminalOutcome): Promise<ProviderAccountActionResult> {
    this.stopTimers(operation);
    await operation.ledger.stop();
    if (!operation.ledger.allClosed()) {
      // completeAuth is never called: the reservation stays and new auth operations stay busy.
      operation.blocked = outcome;
      this.emit(operation.profileId);
      return accountActionResult('busy');
    }
    return this.complete(operation, outcome);
  }

  private complete(operation: AuthOperation, outcome: TerminalOutcome): ProviderAccountActionResult {
    if (operation.settled) return accountActionResult('conflict');
    operation.settled = true;
    operation.blocked = undefined;
    operation.ledger.release();
    if (this.active.get(operation.profileId) === operation) this.active.delete(operation.profileId);
    try {
      this.store.completeAuth(operation.operationId, this.ownerId, operation.epoch, outcome.state, outcome.identityRef);
    } catch (error: unknown) {
      this.emit(operation.profileId);
      return this.refusal(error);
    }
    this.emit(operation.profileId);
    return accountActionResult(outcome.code);
  }

  /**
   * A late close (console or probe child) may unblock a gated operation, or
   * resume a sign-in poll that stopped at the unproved limit.
   */
  private childClosed(operation: AuthOperation): void {
    if (operation.settled || this.disposalController.signal.aborted) return;
    if (operation.blocked) {
      if (operation.ledger.allClosed()) this.complete(operation, operation.blocked);
      return;
    }
    if (operation.kind === 'sign-in' && operation.context && !operation.inFlight) this.schedulePoll(operation);
  }

  private stopTimers(operation: AuthOperation): void {
    if (operation.pollTimer) clearTimeout(operation.pollTimer);
    if (operation.deadlineTimer) clearTimeout(operation.deadlineTimer);
    operation.pollTimer = undefined;
    operation.deadlineTimer = undefined;
  }

  private emit(profileId: string): void {
    if (this.listeners.size === 0) return;
    let change: ProviderAccountStateChange;
    try {
      const profile = this.store.find(profileId);
      if (!profile) return;
      change = { profileId, state: profile.state, revision: profile.revision };
    } catch {
      // degradation-audit: reported - an unreadable store has no snapshot to send; the next read reports unavailable-storage.
      return;
    }
    for (const listener of [...this.listeners]) listener(change);
  }

  private refusal(error: unknown): ProviderAccountActionResult {
    return accountActionResult(error instanceof ProviderAccountStoreError ? error.code : 'unavailable-storage');
  }
}

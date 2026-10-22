import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import type { ClaudeAccountActionCommand, ClaudeAccountActionTarget, ProviderAccountActionPort } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountActionResult, ProviderAccountState } from '@ptah-extension/shared';
import { accountActionResult, ClaudeAccountCommand, type ClaudeAccountCommandKind } from './claude-account-command';
import { ProviderAccountStore } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';

interface ActiveAction {
  readonly operationId: string;
  readonly epoch: number;
  readonly revision: number;
  readonly controller: AbortController;
  readonly kind: ClaudeAccountCommandKind;
  readonly done: Promise<ProviderAccountActionResult>;
}

/** The store arbitrates across hosts; this map contains only owned live handles. */
@injectable()
export class ProviderAccountActionsService implements ProviderAccountActionPort {
  private readonly ownerId = randomUUID();
  private readonly active = new Map<string, ActiveAction>();
  private readonly disposalController = new AbortController();
  private disposal?: Promise<void>;

  constructor(@inject(ProviderAccountStore) private readonly store: ProviderAccountStore,
    @inject(ClaudeAccountCommand) private readonly commands: ClaudeAccountCommand) {}

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposalController.abort();
    const active = [...this.active.values()];
    for (const action of active) action.controller.abort();
    // Existing bounded command termination decides whether close is proved.
    // Never complete or release an unresolved operation during shutdown.
    this.disposal = Promise.all(active.map(action => action.done)).then(() => undefined);
    return this.disposal;
  }

  async readStatus(target: ClaudeAccountActionTarget): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      if (target.provider !== 'claude') return accountActionResult('wrong-provider');
      const profile = this.store.get(target.profileId);
      // Restart never turns an unresolved operation into a successful status.
      if (profile.state === 'pending') return accountActionResult('busy');
      return await this.run({ ...target, operationId: randomUUID(), expectedRevision: profile.revision }, 'status');
    } catch (error: unknown) { return this.refusal(error); }
  }

  startSignIn(command: ClaudeAccountActionCommand): Promise<ProviderAccountActionResult> {
    return this.run(command, 'login');
  }

  signOut(command: ClaudeAccountActionCommand): Promise<ProviderAccountActionResult> {
    return this.run(command, 'logout');
  }

  async cancelSignIn(command: ClaudeAccountActionCommand): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      if (command.provider !== 'claude') return accountActionResult('wrong-provider');
      const active = this.active.get(command.profileId);
      const profile = this.store.get(command.profileId);
      if (!active) return accountActionResult(profile.state === 'pending' ? 'busy' : 'conflict');
      if (active.kind !== 'login' || active.operationId !== command.operationId ||
        active.revision !== command.expectedRevision || profile.revision !== active.revision || profile.auth_epoch !== active.epoch) {
        return accountActionResult('conflict');
      }
      active.controller.abort();
      return await active.done;
    } catch (error: unknown) { return this.refusal(error); }
  }

  private async run(command: ClaudeAccountActionCommand, kind: ClaudeAccountCommandKind): Promise<ProviderAccountActionResult> {
    if (this.disposalController.signal.aborted) return accountActionResult('unavailable-storage');
    try {
      if (command.provider !== 'claude') return accountActionResult('wrong-provider');
      const profile = this.store.get(command.profileId);
      if (profile.revision !== command.expectedRevision) return accountActionResult('conflict');
      if (this.active.has(command.profileId) || profile.state === 'pending') return accountActionResult('busy');
      const authorization = this.commands.authorization();
      if (authorization !== 'ok') return accountActionResult(authorization);
      const route = resolveProviderAccountRoute(profile.canonical_route);
      // reserveAuth compares the persisted path, physical identity and fingerprint.
      const reservation = kind === 'status'
        ? this.store.reserveStatus(command.profileId, command.expectedRevision, route, command.operationId, this.ownerId)
        : this.store.reserveAuth(command.profileId, command.expectedRevision, route,
          command.operationId, this.ownerId, kind === 'logout' ? 'sign-out' : 'sign-in');
      const controller = new AbortController();
      const done = Promise.resolve().then(async () => {
        let outcome = await this.commands.execute(kind, route, controller.signal);
        const interrupted = outcome.code === 'cancelled' || outcome.code === 'timeout';
        // Recheck within the same reservation. A cancelled browser flow may still succeed,
        // but this operation must remain cancelled; a later explicit status can observe it.
        if (!this.disposalController.signal.aborted && outcome.terminated && ((outcome.code === 'ok' && kind !== 'status') || interrupted)) {
          const checked = await this.commands.execute('status', route,
            interrupted ? this.disposalController.signal : controller.signal);
          outcome = interrupted ? { ...outcome, terminated: checked.terminated } : checked;
        }
        if (controller.signal.aborted) outcome = { ...outcome, code: 'cancelled' };
        if (kind === 'status') {
          const state: ProviderAccountState = outcome.terminated && outcome.code === 'ok' && outcome.authMethod === 'claude.ai'
            ? 'signed-in' : outcome.terminated && outcome.code === 'ok' && outcome.authMethod === 'none'
              ? 'signed-out' : profile.state === 'signed-in' ? 'disconnected' : profile.state;
          this.store.completeStatus(command.operationId, this.ownerId, reservation.authEpoch, state, outcome.terminated);
          return accountActionResult(outcome.code === 'ok' && (!outcome.terminated || !outcome.authMethod)
            ? 'unsupported-source' : outcome.code);
        }
        if (!outcome.terminated) return accountActionResult(outcome.code);
        let state: ProviderAccountState;
        if (outcome.code === 'cancelled') state = 'cancelled';
        else if (outcome.code !== 'ok') state = profile.state === 'signed-in' ? 'disconnected' : 'failed';
        else if (outcome.authMethod === 'claude.ai') state = kind === 'logout' ? 'failed' : 'signed-in';
        else if (outcome.authMethod === 'none') state = kind === 'login' ? 'failed' : kind === 'logout' || profile.state === 'signed-out' ? 'signed-out'
          : profile.state === 'signed-in' ? 'disconnected' : 'not-signed-in';
        else state = 'failed';
        this.store.completeAuth(command.operationId, this.ownerId, reservation.authEpoch, state);
        return accountActionResult(outcome.code === 'ok' && state === 'failed' ? 'unsupported-source' : outcome.code);
      }).catch((error: unknown) => this.refusal(error)).finally(() => {
        this.active.delete(command.profileId);
      });
      this.active.set(command.profileId, { operationId: command.operationId, epoch: reservation.authEpoch,
        revision: command.expectedRevision + (kind === 'status' ? 0 : 1), controller, kind, done });
      return await done;
    } catch (error: unknown) { return this.refusal(error); }
  }

  private refusal(error: unknown): ProviderAccountActionResult {
    return accountActionResult(error instanceof ProviderAccountStoreError ? error.code : 'unavailable-storage');
  }
}

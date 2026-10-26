import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS, type NamedAccountPersistencePort, type SessionMetadata,
  type SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundary, ClaudeLaunchBoundaryOutcome } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding, ProviderAccountIdentityEvidence } from '@ptah-extension/shared';
import { ClaudeRouteCertifier } from './claude-route-certifier';
import { ProviderAccountActionsService } from './provider-account-actions.service';
import { ProviderAccountService } from './provider-account.service';
import { ProviderAccountStore, type AccountBindingLookup, type AccountSdkSessionAttachment,
  type AccountSdkSessionAttachmentResult, type StoredProviderAccount } from './provider-account.store';
import { ProviderAccountStoreError, providerAccountErrorCode, resolveProviderAccountRoute } from './provider-account-route';

/** Path-free lane receipt; structurally the cli-agent-runtime `LaneAccountReference`. */
interface NamedAccountReference {
  readonly accountBinding: ProviderAccountBinding;
  readonly accountBindingId: string;
}

function sameIdentity(left: ProviderAccountIdentityEvidence, right: ProviderAccountIdentityEvidence): boolean {
  return left.kind === 'known' && right.kind === 'known' ? left.ownerKey === right.ownerKey : left.kind === right.kind;
}

function sameBinding(left: ProviderAccountBinding, right: ProviderAccountBinding): boolean {
  return left.version === right.version && left.provider === right.provider && left.profileId === right.profileId &&
    left.routeRevision === right.routeRevision && left.routeFingerprint === right.routeFingerprint &&
    left.authEpoch === right.authEpoch && left.runId === right.runId && sameIdentity(left.identity, right.identity);
}

/** Thrown store refusals keep their code; anything else is a changed route. */
function routeFailure(error: unknown): ProviderAccountStoreError {
  return error instanceof ProviderAccountStoreError && error.code !== 'missing-profile'
    ? error : new ProviderAccountStoreError('route-changed');
}

/**
 * Host adapter for named Claude runs (main chat and lanes). It implements the
 * agent-sdk `NamedAccountPersistencePort` and, structurally, the
 * cli-agent-runtime `ClaudeLaneAccountPersistence`, without importing that lib.
 * It keeps no per-run state: every call checks only the route and launch it is
 * given, so concurrent runs on different routes never share anything here.
 * Not registered by this library; the Electron host binds it.
 */
@injectable()
export class ClaudeNamedAccountPersistence implements NamedAccountPersistencePort {
  readonly available = true;

  constructor(
    @inject(ProviderAccountService)
    private readonly accounts: Pick<ProviderAccountService,
      'commitRunBinding' | 'attachSdkSession' | 'lookupBySdkSession' | 'lookupRunBinding'>,
    @inject(ProviderAccountStore) private readonly store: Pick<ProviderAccountStore, 'get'>,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadata: Pick<SessionMetadataStore, 'saveAccountBound' | 'resolveAccountBinding'>,
    @inject(ProviderAccountActionsService)
    private readonly actions: Pick<ProviderAccountActionsService, 'onStateChanged'>,
    @inject(ClaudeRouteCertifier) private readonly certifier: Pick<ClaudeRouteCertifier, 'checkLaunch'>,
  ) {}

  /** The registry lookup is the authority; metadata must match it. */
  resolveAccountBinding(sdkSessionId: string): Promise<ProviderAccountBinding | null> {
    return this.metadata.resolveAccountBinding(sdkSessionId,
      (id) => this.lookupBySdkSession({ provider: 'claude', sdkSessionId: id }));
  }

  async lookupBySdkSession(request: { readonly provider: 'claude'; readonly sdkSessionId: string }): Promise<AccountBindingLookup> {
    try {
      const found = await this.accounts.lookupBySdkSession({ provider: 'claude', sdkSessionId: request.sdkSessionId });
      return found.status === 'bound' && found.binding.provider !== 'claude' ? { status: 'invalid-bound' } : found;
    } catch {
      // degradation-audit: optional-capability - a failing account store is a typed storage refusal, never ambient absence
      return { status: 'unavailable-storage' };
    }
  }

  /** Checkpoint for the run's own live lease; the lease keys must belong to `route`. */
  async commitRunBinding(route: ClaudeAccountNamedRoute, reservation: ClaudeAccountRunReservation,
    identity: ProviderAccountIdentityEvidence): Promise<ProviderAccountBinding> {
    if (reservation.runId !== route.runId || reservation.routeFingerprint !== route.routeFingerprint ||
      reservation.routeRevision !== route.routeRevision || reservation.authEpoch !== route.authEpoch) {
      throw new ProviderAccountStoreError('conflict');
    }
    return this.accounts.commitRunBinding({ reservationId: reservation.reservationId,
      operationId: reservation.operationId, authEpoch: reservation.authEpoch, runId: route.runId, identity });
  }

  attachSdkSession(request: AccountSdkSessionAttachment): Promise<AccountSdkSessionAttachmentResult> {
    return this.accounts.attachSdkSession(request);
  }

  saveAccountBound(metadata: SessionMetadata, binding: ProviderAccountBinding): Promise<void> {
    return this.metadata.saveAccountBound(metadata, binding);
  }

  /**
   * The stored profile still has this route's fingerprint, revision and epoch,
   * and the directory on disk still has the same physical identity.
   */
  async assertRouteCurrent(route: ClaudeAccountNamedRoute): Promise<void> {
    let profile: StoredProviderAccount;
    try {
      profile = this.store.get(route.profileId);
    } catch (error: unknown) {
      throw routeFailure(error);
    }
    if (profile.route_fingerprint !== route.routeFingerprint || profile.route_revision !== route.routeRevision ||
      profile.auth_epoch !== route.authEpoch) {
      throw new ProviderAccountStoreError('route-changed');
    }
    this.assertPhysicalRoute(route.canonicalConfigDir, route.routeFingerprint, route.canonicalConfigDir);
  }

  /**
   * Checked before each SDK child of a named run starts: route revalidation
   * first (no certifier call on failure), then the certifier's launch check,
   * whose outcome is returned unchanged.
   */
  async checkLaunchBoundary(route: ClaudeAccountNamedRoute, launch: ClaudeCertifiedLaunchContext,
    _boundary: ClaudeLaunchBoundary, signal: AbortSignal): Promise<ClaudeLaunchBoundaryOutcome> {
    try {
      await this.assertRouteCurrent(route);
    } catch {
      // degradation-audit: reported - a changed route refuses the launch; revalidation starts no child, so nothing is left unproved
      return { ok: false, code: 'route-changed', terminated: true };
    }
    try {
      return await this.certifier.checkLaunch(launch, signal);
    } catch {
      // degradation-audit: reported - a thrown check proves no probe close; the launch is refused and the lease retained
      return { ok: false, code: 'identity-unproved', terminated: false };
    }
  }

  /** Announces the profile's current route after every account state change. */
  onAuthEpochChanged(listener: (route: ClaudeAccountNamedRoute) => void): () => void {
    return this.actions.onStateChanged((change) => {
      let profile: StoredProviderAccount;
      try {
        profile = this.store.get(change.profileId);
      } catch {
        // degradation-audit: optional-capability - a removed or unreadable profile has no route to announce; its runs refuse at their next route check
        return;
      }
      // A profile-level notice, not a run route: `runId` is empty and only the
      // provider, fingerprint and epoch are read by listeners.
      listener(Object.freeze({
        kind: 'named', provider: 'claude', profileId: profile.profile_id, canonicalConfigDir: profile.canonical_route,
        routeFingerprint: profile.route_fingerprint, routeRevision: profile.route_revision,
        authEpoch: profile.auth_epoch, runId: '',
      }) as ClaudeAccountNamedRoute);
    });
  }

  /**
   * Lane turn and resume check: the registry still holds exactly this binding,
   * the profile keeps its route, and the epoch has not gone backwards. A newer
   * epoch is allowed because the caller proves the identity freshly.
   */
  async validateResume(reference: NamedAccountReference): Promise<{ readonly code: string }> {
    const binding = reference.accountBinding;
    if (reference.accountBindingId !== binding.runId || binding.provider !== 'claude' || binding.identity.kind !== 'known') {
      return { code: 'invalid-bound' };
    }
    try {
      const stored = await this.accounts.lookupRunBinding(binding.runId);
      if (stored.status !== 'bound') return { code: stored.status === 'absent' ? 'invalid-bound' : stored.status };
      if (!sameBinding(stored.binding, binding)) return { code: 'invalid-bound' };
      const profile = this.store.get(binding.profileId);
      if (profile.route_fingerprint !== binding.routeFingerprint || profile.route_revision !== binding.routeRevision ||
        profile.auth_epoch < binding.authEpoch) {
        return { code: 'route-changed' };
      }
      this.assertPhysicalRoute(profile.canonical_route, binding.routeFingerprint);
      return { code: 'ok' };
    } catch (error: unknown) {
      // degradation-audit: reported - the refusal code is returned to the lane; no dependency message is forwarded
      return { code: routeFailure(error).code };
    }
  }

  /** Both checkpoints must already hold: the registry SDK link and matching metadata. */
  async persistReference(reference: NamedAccountReference, sdkSessionId: string): Promise<void> {
    const binding = reference.accountBinding;
    if (reference.accountBindingId !== binding.runId) throw new ProviderAccountStoreError('invalid-bound');
    const linked = await this.lookupBySdkSession({ provider: 'claude', sdkSessionId });
    if (linked.status === 'unavailable-storage') throw new ProviderAccountStoreError('unavailable-storage');
    if (linked.status !== 'bound' || !sameBinding(linked.binding, binding)) throw new ProviderAccountStoreError('invalid-bound');
    let durable: ProviderAccountBinding | null;
    try {
      durable = await this.metadata.resolveAccountBinding(sdkSessionId, async () => linked);
    } catch (error: unknown) {
      throw new ProviderAccountStoreError(
        providerAccountErrorCode(error) === 'unavailable-storage' ? 'unavailable-storage' : 'invalid-bound');
    }
    if (!durable || !sameBinding(durable, binding)) throw new ProviderAccountStoreError('invalid-bound');
  }

  /** `expectedPath`, when given, must also equal the canonical path on disk. */
  private assertPhysicalRoute(directory: string, fingerprint: string, expectedPath?: string): void {
    let current: ReturnType<typeof resolveProviderAccountRoute>;
    try {
      current = resolveProviderAccountRoute(directory);
    } catch {
      throw new ProviderAccountStoreError('route-changed');
    }
    if (current.fingerprint !== fingerprint || (expectedPath !== undefined && current.canonicalPath !== expectedPath)) {
      throw new ProviderAccountStoreError('route-changed');
    }
  }
}

/**
 * Backend admission contracts for a Claude account route.
 *
 * Token identifiers live in `tokens.ts`. Nothing here registers a service,
 * reads the environment, or certifies a caller-built object. A value matches
 * `ClaudeAccountRoute` only when it carries `claudeAccountRouteCertification`.
 * Attaching that symbol, or asserting the type, is not admission. Only a
 * future `ProviderAccountAdmissionPort` implementation may assert the symbol
 * after lease and directory/source certification.
 *
 * The symbol is exported from this module so declaration emit can name it.
 * The package barrel does not re-export it. These types are not an RPC or UI
 * route: canonical directories stay on this backend carrier.
 */

import type {
  ProviderAccountActionResult,
  ProviderAccountResultCode,
  ProviderAccountScope,
  ProviderAccountSelection,
} from '@ptah-extension/shared';

/**
 * Compile-time marker for a route this port has produced.
 * No runtime binding is emitted. Do not construct a route with it.
 */
export declare const claudeAccountRouteCertification: unique symbol;

/** Certified default route. No caller-supplied directory. */
export interface ClaudeAccountAmbientRoute {
  readonly kind: 'ambient';
  readonly [claudeAccountRouteCertification]: typeof claudeAccountRouteCertification;
}

/**
 * Certified named Claude route. `provider` is the literal `claude`.
 * Closed fields only: no environment bag and no index signature.
 * `canonicalConfigDir` is backend-only and is not a public reference.
 */
export interface ClaudeAccountNamedRoute {
  readonly kind: 'named';
  readonly provider: 'claude';
  readonly profileId: string;
  readonly canonicalConfigDir: string;
  readonly routeFingerprint: string;
  readonly routeRevision: number;
  readonly authEpoch: number;
  readonly runId: string;
  readonly [claudeAccountRouteCertification]: typeof claudeAccountRouteCertification;
}

/** Closed routing carrier. Not permission to release conversation data. */
export type ClaudeAccountRoute =
  | ClaudeAccountAmbientRoute
  | ClaudeAccountNamedRoute;

/** Stable filesystem identity. Opaque ids, not a path. */
export interface ClaudeAccountFilesystemIdentity {
  readonly volumeId: string;
  readonly fileId: string;
}

/** Resolved ambient route. No physical path is accepted from the caller. */
export interface ClaudeAccountAmbientResolvedResourceContext {
  readonly kind: 'ambient';
  readonly route: ClaudeAccountAmbientRoute;
}

/** Setting sources a certified Claude child may read. */
export type ClaudeCertifiedSettingSource = 'user' | 'project' | 'local';

/**
 * Size and modification time of `sdkExecutablePath`, taken together with the
 * version probe. A later mismatch means the executable changed in place.
 */
export interface ClaudeCertifiedExecutableFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
}

/** The certified Claude executable for one named launch. */
export interface ClaudeCertifiedExecutable {
  readonly command: string;
  readonly prefixArgs: readonly string[];
  readonly sdkExecutablePath: string;
  readonly version: string;
  readonly fingerprint: ClaudeCertifiedExecutableFingerprint;
}

/**
 * Policy evidence gathered before the launch was certified.
 * `coverage` is a coverage entry id such as `win32@2.1.310`.
 * `remoteSignals` is only `absent`: any other result refuses certification.
 */
export interface ClaudeCertifiedLaunchPolicy {
  readonly coverage: string;
  readonly managedFile: 'absent' | 'scanned';
  readonly managedDropIn: 'absent' | 'scanned';
  readonly registry: 'absent' | 'not-applicable';
  readonly remoteSignals: 'absent';
}

/**
 * Closed, backend-only launch for a certified named Claude route.
 * Never logged, never sent over RPC, never shown in a renderer.
 * `env` is the complete child environment; `envDigest` is the SHA-256 of its
 * sorted `key=value` lines. `accountClass` is the closed literal `personal`:
 * a launch exists only for class P, so another class needs a type change.
 */
export interface ClaudeCertifiedLaunchContext {
  readonly executable: ClaudeCertifiedExecutable;
  readonly env: Readonly<Record<string, string>>;
  readonly envDigest: string;
  readonly cwd: string;
  readonly settingSources: readonly ClaudeCertifiedSettingSource[];
  readonly policy: ClaudeCertifiedLaunchPolicy;
  readonly accountClass: 'personal';
  readonly identityReference: string;
}

/** The two SDK child starts of a named run that are checked before spawn. */
export type ClaudeLaunchBoundary = 'bootstrap' | 'final';

/**
 * Result of re-checking a certified launch before one SDK child starts.
 * `terminated` reports whether the run was ended as part of the refusal.
 */
export type ClaudeLaunchBoundaryOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'unsupported-source' | 'identity-unproved' | 'route-changed';
      readonly terminated: boolean;
    };

/**
 * Resolved named route. `accountDataDir` is the Ptah metadata directory.
 * `route.canonicalConfigDir` is the certified Claude directory.
 * Unresolvable filesystem identity never appears here; admission refuses.
 * `launch` is optional only for type compatibility with existing fixtures;
 * a named run without it does not start.
 */
export interface ClaudeAccountNamedResolvedResourceContext {
  readonly kind: 'named';
  readonly route: ClaudeAccountNamedRoute;
  readonly accountDataDir: string;
  readonly filesystemIdentity: ClaudeAccountFilesystemIdentity;
  readonly launch?: ClaudeCertifiedLaunchContext;
}

export type ClaudeAccountResolvedResourceContext =
  | ClaudeAccountAmbientResolvedResourceContext
  | ClaudeAccountNamedResolvedResourceContext;

/**
 * `reserved` is held from preflight until established child close.
 * `released` follows child close, startup failure, cancel, abort, timeout
 * or disposal after termination is established.
 * `retained` means termination was not proved. There is no age or PID steal.
 * A stuck reservation blocks only its own canonical route.
 */
export type ClaudeAccountReservationPhase = 'reserved' | 'released' | 'retained';

export interface ClaudeAccountReservationBase {
  readonly reservationId: string;
  readonly phase: ClaudeAccountReservationPhase;
  readonly provider: 'claude';
  readonly routeKind: 'ambient' | 'named';
  readonly routeFingerprint: string;
  readonly routeRevision: number;
  readonly authEpoch: number;
  readonly operationId: string;
}

/** Run lease. Keyed by canonical route, not by scope. */
export interface ClaudeAccountRunReservation extends ClaudeAccountReservationBase {
  readonly kind: 'run';
  readonly runId: string;
}

/**
 * Exclusive auth-action lease for one physical route.
 * Action methods hold it for their own call. No port method takes this
 * record back from a caller, and nothing here reclaims it by age or PID.
 */
export interface ClaudeAccountAuthOperationReservation
  extends ClaudeAccountReservationBase {
  readonly kind: 'auth-operation';
}

export type ClaudeAccountReservation =
  | ClaudeAccountRunReservation
  | ClaudeAccountAuthOperationReservation;

/** Why a proved-dead run lease may be released. Not a steal reason. */
export type ClaudeAccountReservationReleaseReason =
  | 'child-closed'
  | 'startup-failure'
  | 'cancel'
  | 'abort'
  | 'timeout'
  | 'disposal';

/**
 * Lookup keys for one run lease. They do not certify a route.
 * `authEpoch` and `operationId` must still match; a mismatch is `conflict`.
 */
export interface ClaudeAccountReservationRelease {
  readonly reservationId: string;
  readonly operationId: string;
  readonly authEpoch: number;
  readonly reason: ClaudeAccountReservationReleaseReason;
}

/** Keep the same run lease when child termination cannot be proved. */
export interface ClaudeAccountReservationRetain {
  readonly reservationId: string;
  readonly operationId: string;
  readonly authEpoch: number;
}

/**
 * Public selection plus the attempt ids. No directory, environment, owner,
 * epoch or completed route. `provider` is only `claude`.
 */
export interface ClaudeAccountAdmissionRequest {
  readonly provider: 'claude';
  readonly scope: ProviderAccountScope;
  readonly selection: ProviderAccountSelection;
  readonly operationId: string;
  readonly runId: string;
  /** Run working directory; becomes the certified launch `cwd`. */
  readonly workingDirectory?: string;
}

/**
 * Reads the stored account selection for a workspace scope.
 * `profileId: null` means no named account is stored (the default route).
 */
export interface ClaudeAccountSelectionReader {
  readStoredSelection(
    workspaceRoot: string,
    scope: ProviderAccountScope,
  ): Promise<{ readonly profileId: string | null }>;
}

/** Safe refusal. `summary` is not validated in this declaration file. */
export interface ProviderAccountPortRefusal {
  readonly code: Exclude<ProviderAccountResultCode, 'ok'>;
  readonly summary: string;
}

export interface ClaudeAccountAdmissionSuccess {
  readonly code: 'ok';
  readonly resources: ClaudeAccountResolvedResourceContext;
  readonly reservation: ClaudeAccountRunReservation & {
    readonly phase: 'reserved';
  };
}

export type ClaudeAccountAdmissionOutcome =
  | ClaudeAccountAdmissionSuccess
  | ProviderAccountPortRefusal;

export interface ClaudeAccountReservationReleased {
  readonly code: 'ok';
  readonly reservation: ClaudeAccountRunReservation & {
    readonly phase: 'released';
  };
}

export interface ClaudeAccountReservationRetained {
  readonly code: 'ok';
  readonly reservation: ClaudeAccountRunReservation & {
    readonly phase: 'retained';
  };
}

export type ClaudeAccountReservationReleaseOutcome =
  | ClaudeAccountReservationReleased
  | ProviderAccountPortRefusal;

export type ClaudeAccountReservationRetainOutcome =
  | ClaudeAccountReservationRetained
  | ProviderAccountPortRefusal;

/**
 * Routing admission. Implementations certify the route and reserve it.
 * Callers pass a selection, never a `ClaudeAccountRoute`.
 * Removing profile metadata does not release an already reserved run;
 * a later admit for that route refuses without revoking the held lease.
 */
export interface ProviderAccountAdmissionPort {
  admitClaudeRoute(
    request: ClaudeAccountAdmissionRequest,
  ): Promise<ClaudeAccountAdmissionOutcome>;
  releaseReservation(
    command: ClaudeAccountReservationRelease,
  ): Promise<ClaudeAccountReservationReleaseOutcome>;
  retainUnresolvedReservation(
    command: ClaudeAccountReservationRetain,
  ): Promise<ClaudeAccountReservationRetainOutcome>;
  /**
   * Records the pid of the run's current Claude child on its live lease, so a
   * later process reclaims the lease only once both the owning host and that
   * child are proved gone. Checks the same keys as retain; the lease stays.
   * Optional: a host without lease storage has nothing to record.
   */
  recordRunChild?(
    command: ClaudeAccountRunChild,
  ): Promise<ClaudeAccountReservationRetainOutcome>;
}

/** Lease keys plus the OS pid of the child the run just spawned. */
export interface ClaudeAccountRunChild extends ClaudeAccountReservationRetain {
  readonly pid: number;
}

/** Profile target. No path and no environment. */
export interface ClaudeAccountActionTarget {
  readonly provider: 'claude';
  readonly profileId: string;
}

/** Mutating account action. Revision and operation id are compared, not trusted as a route. */
export interface ClaudeAccountActionCommand extends ClaudeAccountActionTarget {
  readonly operationId: string;
  readonly expectedRevision: number;
}

/**
 * Official account actions. Method signatures only.
 * Each mutating call uses one auth-operation reservation for that route
 * and releases it before returning, except when termination is unproved:
 * then the reservation stays retained. A leased run returns `busy`.
 * Results are safe codes and sentences, never a directory or a route.
 */
export interface ProviderAccountActionPort {
  readStatus(
    target: ClaudeAccountActionTarget,
  ): Promise<ProviderAccountActionResult>;
  startSignIn(
    command: ClaudeAccountActionCommand,
  ): Promise<ProviderAccountActionResult>;
  cancelSignIn(
    command: ClaudeAccountActionCommand,
  ): Promise<ProviderAccountActionResult>;
  signOut(
    command: ClaudeAccountActionCommand,
  ): Promise<ProviderAccountActionResult>;
}

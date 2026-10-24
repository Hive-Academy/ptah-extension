/**
 * Provider-account RPC contracts (`provider:*Account*`).
 *
 * The account vocabulary itself (provider, scope, selection, summary, result
 * code) lives in `../provider-account.types`; this module only shapes the
 * request/result/notification envelopes around it.
 *
 * Authority rules every params type below follows:
 * - A caller names an account only by opaque profile ID or by the
 *   `ambient`/`named` selection sentinel, plus provider, scope and the
 *   workspace root it is acting for. No directory, environment bag, token,
 *   owner key, route fingerprint, auth epoch or binding is accepted.
 * - Every write carries a `requestId` (duplicate submissions return the same
 *   outcome instead of acting twice) and the revision it expects to replace.
 * - Sign-in/out operations are addressed by the server-issued `operationId`.
 *
 * This module is zod-free so it can stay in the main `@ptah-extension/shared`
 * barrel. Wire validation of these params happens at the RPC boundary in
 * `@ptah-extension/rpc-handlers` (`provider-account-rpc.schema.ts`).
 *
 * Host capability is not part of these contracts. Which host serves the
 * methods is decided by the host profile; nothing here implies account
 * management on a host that does not register them.
 */

import type {
  ProviderAccountActionResult,
  ProviderAccountProvider,
  ProviderAccountScope,
  ProviderAccountSelection,
  ProviderAccountSummary,
} from '../provider-account.types';

/** Every account method, in registry order. Names stay under `provider:`. */
export const PROVIDER_ACCOUNT_RPC_METHOD_NAMES = [
  'provider:listAccounts',
  'provider:addAccount',
  'provider:renameAccount',
  'provider:removeAccount',
  'provider:getAccountStatus',
  'provider:startAccountSignIn',
  'provider:cancelAccountSignIn',
  'provider:signOutAccount',
  'provider:setAccountSelection',
  'provider:setAccountDefault',
] as const satisfies readonly (keyof ProviderAccountRpcMethodRegistry)[];

export type ProviderAccountRpcMethodName =
  (typeof PROVIDER_ACCOUNT_RPC_METHOD_NAMES)[number];

/**
 * Revision of a scope selection. `-1` means no selection has been stored yet
 * for that workspace and scope; the first stored revision is `0`.
 */
export const PROVIDER_ACCOUNT_ABSENT_SELECTION_REVISION = -1 as const;

// ---------------------------------------------------------------------------
// Shared envelope pieces
// ---------------------------------------------------------------------------

/** Which provider's accounts, for which workspace. */
export interface ProviderAccountWorkspaceTarget {
  readonly provider: ProviderAccountProvider;
  /** Workspace root the caller acts for. The backend checks it is open. */
  readonly workspaceRoot: string;
}

/** Idempotency key for one user action. Opaque ID, 8–64 ASCII characters. */
export interface ProviderAccountWriteRequest {
  readonly requestId: string;
}

/** A write against one profile at the profile revision the caller saw. */
export interface ProviderAccountProfileWrite extends ProviderAccountWriteRequest {
  readonly provider: ProviderAccountProvider;
  readonly profileId: string;
  readonly expectedRevision: number;
}

/**
 * What a selection or default write stores. `ambient` is "Use existing
 * default". A named choice carries the profile revision the caller saw, so a
 * concurrently renamed, removed or re-authenticated profile is refused.
 */
export type ProviderAccountSelectionWrite =
  | { readonly kind: 'ambient' }
  | {
      readonly kind: 'named';
      readonly profileId: string;
      readonly expectedProfileRevision: number;
    };

/** Stored selection for one scope. `omitted` with revision `-1` = never set. */
export interface ProviderAccountScopeSelection {
  readonly scope: ProviderAccountScope;
  readonly selection: ProviderAccountSelection;
  readonly revision: number;
}

/**
 * Authoritative account state for one provider and workspace.
 *
 * `revision` increases with every committed change the host observes; a
 * consumer ignores a snapshot whose revision is not newer than the one it
 * holds, and re-reads with `provider:listAccounts` after a reconnect.
 */
export interface ProviderAccountsSnapshot extends ProviderAccountWorkspaceTarget {
  readonly revision: number;
  readonly accounts: readonly ProviderAccountSummary[];
  readonly selections: {
    readonly main: ProviderAccountScopeSelection;
    readonly lane: ProviderAccountScopeSelection;
  };
}

/**
 * Pushed once per committed snapshot revision. `requestId` echoes the write
 * that caused it when there was one, so the caller can settle its own action.
 */
export interface ProviderAccountsChangedNotification {
  readonly snapshot: ProviderAccountsSnapshot;
  readonly requestId?: string;
}

/**
 * Every account method answers with this union. A refusal carries only the
 * closed result code and its safe sentence. `timeout` means the outcome is
 * unconfirmed: re-read the snapshot, do not assume a rollback.
 */
export type ProviderAccountRpcResult<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly result: ProviderAccountActionResult };

/** A committed write returns the snapshot it produced. */
export interface ProviderAccountCommittedWrite {
  readonly snapshot: ProviderAccountsSnapshot;
}

/** Server-issued handle for one sign-in or sign-out operation. */
export interface ProviderAccountOperation {
  readonly operationId: string;
  readonly kind: 'sign-in' | 'sign-out';
}

// ---------------------------------------------------------------------------
// Per-method params and results
// ---------------------------------------------------------------------------

export type ProviderListAccountsParams = ProviderAccountWorkspaceTarget;
export type ProviderListAccountsResult = ProviderAccountRpcResult<{
  readonly snapshot: ProviderAccountsSnapshot;
}>;

/** Label-only Add. The backend allocates the profile ID and its directory. */
export interface ProviderAddAccountParams
  extends ProviderAccountWorkspaceTarget,
    ProviderAccountWriteRequest {
  readonly label: string;
}
export type ProviderAddAccountResult = ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & { readonly account: ProviderAccountSummary }
>;

/** Changes the local label only; route identity and bindings are unchanged. */
export interface ProviderRenameAccountParams
  extends ProviderAccountProfileWrite {
  readonly workspaceRoot: string;
  readonly label: string;
}
export type ProviderRenameAccountResult = ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & { readonly account: ProviderAccountSummary }
>;

/** Removes local metadata only. Running and bound runs are not moved. */
export interface ProviderRemoveAccountParams
  extends ProviderAccountProfileWrite {
  readonly workspaceRoot: string;
}
export type ProviderRemoveAccountResult =
  ProviderAccountRpcResult<ProviderAccountCommittedWrite>;

export interface ProviderGetAccountStatusParams {
  readonly provider: ProviderAccountProvider;
  readonly profileId: string;
}
export type ProviderGetAccountStatusResult = ProviderAccountRpcResult<{
  readonly account: ProviderAccountSummary;
  /** Present while a sign-in or sign-out holds this profile's route. */
  readonly operation?: ProviderAccountOperation;
}>;

export interface ProviderStartAccountSignInParams
  extends ProviderAccountProfileWrite {
  readonly workspaceRoot: string;
}
export type ProviderStartAccountSignInResult = ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & {
    readonly operation: ProviderAccountOperation;
  }
>;

export interface ProviderCancelAccountSignInParams
  extends ProviderAccountWriteRequest {
  readonly provider: ProviderAccountProvider;
  readonly workspaceRoot: string;
  readonly profileId: string;
  readonly operationId: string;
}
export type ProviderCancelAccountSignInResult =
  ProviderAccountRpcResult<ProviderAccountCommittedWrite>;

export interface ProviderSignOutAccountParams
  extends ProviderAccountProfileWrite {
  readonly workspaceRoot: string;
}
export type ProviderSignOutAccountResult = ProviderAccountRpcResult<
  ProviderAccountCommittedWrite & {
    readonly operation: ProviderAccountOperation;
  }
>;

/** Sets the future-start selection of one scope only. */
export interface ProviderSetAccountSelectionParams
  extends ProviderAccountWorkspaceTarget,
    ProviderAccountWriteRequest {
  readonly scope: ProviderAccountScope;
  readonly selection: ProviderAccountSelectionWrite;
  /** Scope selection revision the caller saw; `-1` when none was stored. */
  readonly expectedSelectionRevision: number;
}
export type ProviderSetAccountSelectionResult =
  ProviderAccountRpcResult<ProviderAccountCommittedWrite>;

/**
 * Sets both scopes in one transaction ("Set as default"). Applies to future
 * unbound starts only; existing and bound runs are unchanged.
 */
export interface ProviderSetAccountDefaultParams
  extends ProviderAccountWorkspaceTarget,
    ProviderAccountWriteRequest {
  readonly selection: ProviderAccountSelectionWrite;
  readonly expectedSelectionRevisions: Readonly<
    Record<ProviderAccountScope, number>
  >;
}
export type ProviderSetAccountDefaultResult =
  ProviderAccountRpcResult<ProviderAccountCommittedWrite>;

// ---------------------------------------------------------------------------
// Registry slice
// ---------------------------------------------------------------------------

/**
 * The account slice of `RpcMethodRegistry`. It is merged into the central
 * registry in the same change that gives these methods an owner in
 * `RPC_HANDLER_MANIFEST`, because the manifest must partition
 * `RPC_METHOD_NAMES` exactly.
 */
export interface ProviderAccountRpcMethodRegistry {
  'provider:listAccounts': {
    params: ProviderListAccountsParams;
    result: ProviderListAccountsResult;
  };
  'provider:addAccount': {
    params: ProviderAddAccountParams;
    result: ProviderAddAccountResult;
  };
  'provider:renameAccount': {
    params: ProviderRenameAccountParams;
    result: ProviderRenameAccountResult;
  };
  'provider:removeAccount': {
    params: ProviderRemoveAccountParams;
    result: ProviderRemoveAccountResult;
  };
  'provider:getAccountStatus': {
    params: ProviderGetAccountStatusParams;
    result: ProviderGetAccountStatusResult;
  };
  'provider:startAccountSignIn': {
    params: ProviderStartAccountSignInParams;
    result: ProviderStartAccountSignInResult;
  };
  'provider:cancelAccountSignIn': {
    params: ProviderCancelAccountSignInParams;
    result: ProviderCancelAccountSignInResult;
  };
  'provider:signOutAccount': {
    params: ProviderSignOutAccountParams;
    result: ProviderSignOutAccountResult;
  };
  'provider:setAccountSelection': {
    params: ProviderSetAccountSelectionParams;
    result: ProviderSetAccountSelectionResult;
  };
  'provider:setAccountDefault': {
    params: ProviderSetAccountDefaultParams;
    result: ProviderSetAccountDefaultResult;
  };
}

/**
 * Compile-time proof that the name tuple and the registry slice list the same
 * methods. Either side drifting turns this into a type error.
 */
type _AccountNamesNotInRegistry = Exclude<
  ProviderAccountRpcMethodName,
  keyof ProviderAccountRpcMethodRegistry
>;
type _AccountRegistryNotInNames = Exclude<
  keyof ProviderAccountRpcMethodRegistry,
  ProviderAccountRpcMethodName
>;
export type ProviderAccountRpcRegistryInSync = [
  _AccountNamesNotInRegistry | _AccountRegistryNotInNames,
] extends [never]
  ? true
  : never;

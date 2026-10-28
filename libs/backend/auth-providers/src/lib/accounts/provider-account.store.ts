import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { PERSISTENCE_TOKENS, type SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  isProviderAccountLabelTaken, isProviderAccountOpaqueId, isProviderAccountOwnerKey, isSafeProviderAccountLabel,
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY, PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY, PROVIDER_ACCOUNT_STATES,
  type ProviderAccountBinding, type ProviderAccountIdentityEvidence, type ProviderAccountScope, type ProviderAccountState,
} from '@ptah-extension/shared';
import type { ClaudeAccountRunReservation, ClaudeAccountAuthOperationReservation,
  ClaudeAccountReservationRelease, ClaudeAccountReservationRetain, ClaudeAccountRunChild } from '@ptah-extension/auth-providers-tokens';
import { ProviderAccountStoreError, revalidateProviderAccountRoute,
  withNewProviderAccountDirectory, providerAccountErrorCode, type CanonicalProviderAccountRoute } from './provider-account-route';
import { CURRENT_LEASE_HOST, leaseOwnerGone } from './provider-account-host';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const opaqueId = z.string().refine(isProviderAccountOpaqueId);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

/** No separator, whitespace, C0 control or DEL character. */
function isSafeSdkSessionId(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || character === '/' || character === '\\' || /\s/.test(character)) return false;
  }
  return true;
}

/** Opaque identity reference from a parsed status: printable ASCII, no space, bounded. */
function isProviderAccountIdentityRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code >= 0x7f) return false;
  }
  return true;
}

const RELEASE_REASONS: readonly ClaudeAccountReservationRelease['reason'][] =
  ['child-closed', 'startup-failure', 'cancel', 'abort', 'timeout', 'disposal'];
const sdkSessionId = z.string().min(1).max(256).refine(isSafeSdkSessionId);
const sdkSessionLookupSchema = z.object({
  provider: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/), sdkSessionId,
}).strict();
const sdkSessionAttachmentSchema = sdkSessionLookupSchema.extend({ runId: opaqueId, attachedAt: revision });
const sessionLinkSchema = z.object({ run_id: opaqueId, sdk_session_id: sdkSessionId, attached_at: revision });
const profileSchema = z.object({
  profile_id: opaqueId, provider: z.literal('claude'), label: z.string().refine(isSafeProviderAccountLabel),
  canonical_route: z.string(), route_fingerprint: fingerprint,
  physical_identity: z.string(), revision, route_revision: revision, auth_epoch: revision,
  state: z.enum(PROVIDER_ACCOUNT_STATES), removed_at: z.number().nullable(),
  identity_ref: z.string().refine(isProviderAccountIdentityRef).nullable(),
});
const leaseSchema = z.object({
  run_id: opaqueId, profile_id: opaqueId.nullable(), route_fingerprint: fingerprint,
  auth_epoch: revision, route_revision: revision, lease_state: z.enum(['live', 'quarantined']),
});
type StoredRunLease = z.infer<typeof leaseSchema>;
const leaseHostSchema = z.object({
  lease_id: z.string(), host_pid: z.number().int().positive(), host_machine: z.string(),
  child_pid: z.number().int().positive().nullable(),
});
export type StoredProviderAccount = z.infer<typeof profileSchema>;
const liveLabelSchema = z.object({ profile_id: z.string(), label: z.string() });
const selectionSchema = z.object({ profile_id: opaqueId.nullable(), revision });
export interface StoredAccountSelection { readonly profileId: string | null; readonly revision: number }
export type AccountBindingLookup =
  | { readonly status: 'absent' }
  | { readonly status: 'bound'; readonly binding: ProviderAccountBinding }
  | { readonly status: 'invalid-bound' | 'unavailable-storage' };

export interface AccountSdkSessionLookup { readonly provider: string; readonly sdkSessionId: string }
export interface AccountSdkSessionAttachment extends AccountSdkSessionLookup {
  readonly runId: string;
  readonly attachedAt: number;
}
export type AccountSdkSessionAttachmentResult = {
  readonly status: 'attached' | 'binding-absent' | 'session-linked-elsewhere' | 'run-linked-elsewhere';
};

export interface AccountRunAdmission {
  readonly profileId: string | null;
  readonly expectedRevision: number;
  readonly route: CanonicalProviderAccountRoute;
  readonly runId: string;
  readonly reservationId: string;
  readonly operationId: string;
  readonly selection?: { readonly workspaceRoot: string; readonly scope: ProviderAccountScope; readonly revision: number };
}

/** A live run lease, plus the binding that already exists for its run (resume) or null. */
export interface AccountRunLease {
  readonly reservation: ClaudeAccountRunReservation & { readonly phase: 'reserved' };
  readonly binding: ProviderAccountBinding | null;
}

/** Lease keys plus the identity proved by the run's own init. */
export interface AccountRunBindingCommit {
  readonly reservationId: string;
  readonly operationId: string;
  readonly authEpoch: number;
  readonly runId: string;
  readonly identity: ProviderAccountIdentityEvidence;
}

/** Lazy shared connection: registration does not open or choose a database.
 * All writes are synchronous. No expiry or in-memory fallback. A run lease is
 * reclaimed only when its host and Claude child are proved gone (`leaseOwnerGone`).
 */
@injectable()
export class ProviderAccountStore {
  constructor(@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: Pick<SqliteConnectionService, 'db'>,
    // Diagnostics only: a container without a logger reclaims and refuses the same way.
    @inject(TOKENS.LOGGER, { isOptional: true }) private readonly logger: Pick<Logger, 'warn'> | null = null) {}

  private atomic<T>(work: (db: SqliteDatabase) => T): T {
    let db: SqliteDatabase | undefined;
    let started = false;
    try {
      db = this.connection.db;
      if (db.inTransaction) throw new ProviderAccountStoreError('conflict');
      db.exec('BEGIN IMMEDIATE');
      started = true;
      const result = work(db);
      db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      if (started && db?.inTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // degradation-audit: optional-capability — SQLite already ended the transaction; the original safe refusal is rethrown
        }
      }
      if (error instanceof ProviderAccountStoreError) throw error;
      const code = providerAccountErrorCode(error);
      if (/SQLITE_(BUSY|LOCKED)/.test(code)) throw new ProviderAccountStoreError('busy');
      if (/SQLITE_CONSTRAINT/.test(code)) throw new ProviderAccountStoreError('conflict');
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }

  private profile(db: SqliteDatabase, id: string, expected?: number): StoredProviderAccount {
    if (!isProviderAccountOpaqueId(id)) throw new ProviderAccountStoreError('conflict');
    const raw = db.prepare('SELECT * FROM provider_account_profiles WHERE profile_id = ?').get(id);
    if (!raw) throw new ProviderAccountStoreError('missing-profile');
    const result = profileSchema.safeParse(raw);
    if (!result.success) throw new ProviderAccountStoreError('unavailable-storage');
    if (expected !== undefined && result.data.revision !== expected) throw new ProviderAccountStoreError('conflict');
    if (result.data.removed_at !== null) throw new ProviderAccountStoreError('missing-profile');
    return result.data;
  }

  get(profileId: string): StoredProviderAccount {
    return this.atomic(db => this.profile(db, profileId));
  }

  /** The row for `profileId` even when removed; `undefined` when it was never added. */
  find(profileId: string): StoredProviderAccount | undefined {
    if (!isProviderAccountOpaqueId(profileId)) throw new ProviderAccountStoreError('conflict');
    return this.atomic(db => {
      const raw = db.prepare('SELECT * FROM provider_account_profiles WHERE profile_id = ?').get(profileId);
      if (!raw) return undefined;
      const result = profileSchema.safeParse(raw);
      if (!result.success) throw new ProviderAccountStoreError('unavailable-storage');
      return result.data;
    });
  }

  list(): readonly StoredProviderAccount[] {
    return this.atomic(db => db.prepare("SELECT * FROM provider_account_profiles WHERE provider = 'claude' AND removed_at IS NULL ORDER BY created_at, profile_id")
      .all().map(row => profileSchema.parse(row)));
  }

  /** Stored identity reference of a live profile; null until a status recorded it. */
  identityRef(profileId: string): string | null {
    return this.atomic(db => this.profile(db, profileId).identity_ref);
  }

  /**
   * Registry commit for a live lease; it never inserts a lease and does not
   * authorize prompt release. The lease must be live and owned, the profile
   * epoch must still equal the lease epoch, the identity must be known, and
   * the run must have no binding yet.
   */
  async commitRunBinding(command: AccountRunBindingCommit): Promise<ProviderAccountBinding> {
    this.validateIds(command.reservationId, command.operationId, command.runId);
    this.validateRevision(command.authEpoch);
    this.validateIdentity(command.identity);
    const identity = command.identity;
    if (identity.kind !== 'known') throw new ProviderAccountStoreError('identity-unproved');
    return this.atomic(db => {
      const lease = this.held(db, command);
      if (lease.run_id !== command.runId || lease.profile_id === null) throw new ProviderAccountStoreError('conflict');
      const profile = this.profile(db, lease.profile_id);
      if (profile.auth_epoch !== command.authEpoch) throw new ProviderAccountStoreError('conflict');
      if (profile.route_fingerprint !== lease.route_fingerprint || profile.route_revision !== lease.route_revision) {
        throw new ProviderAccountStoreError('route-changed');
      }
      if (db.prepare('SELECT 1 FROM provider_account_run_bindings WHERE run_id = ?').get(command.runId)) {
        throw new ProviderAccountStoreError('conflict');
      }
      db.prepare(`INSERT INTO provider_account_run_bindings
        (run_id, provider, profile_id, route_revision, route_fingerprint, auth_epoch, identity_kind, owner_key_hash, created_at)
        VALUES (?, 'claude', ?, ?, ?, ?, 'known', ?, ?)`)
        .run(command.runId, lease.profile_id, lease.route_revision, lease.route_fingerprint, lease.auth_epoch,
          identity.ownerKey, Date.now());
      return Object.freeze({ version: 1, provider: 'claude', profileId: lease.profile_id, routeRevision: lease.route_revision,
        routeFingerprint: lease.route_fingerprint, authEpoch: lease.auth_epoch, runId: command.runId,
        identity: Object.freeze({ kind: 'known', ownerKey: identity.ownerKey }) });
    });
  }

  /** Immutable SDK linkage checkpoint; the caller must still hold prompt release. */
  async attachSdkSession(request: AccountSdkSessionAttachment): Promise<AccountSdkSessionAttachmentResult> {
    const parsed = sdkSessionAttachmentSchema.safeParse(request);
    if (!parsed.success) throw new ProviderAccountStoreError('conflict');
    const input = parsed.data;
    return this.atomic(db => {
      const raw = db.prepare('SELECT * FROM provider_account_run_bindings WHERE run_id = ?').get(input.runId);
      if (!raw) return { status: 'binding-absent' };
      const provider = z.object({ provider: z.string() }).safeParse(raw);
      if (!provider.success) throw new ProviderAccountStoreError('invalid-bound');
      if (provider.data.provider !== input.provider) return { status: 'binding-absent' };
      this.parseBinding(raw);
      const existing = db.prepare('SELECT * FROM provider_account_session_links WHERE provider = ? AND sdk_session_id = ?')
        .get(input.provider, input.sdkSessionId);
      if (existing) {
        const link = sessionLinkSchema.safeParse(existing);
        if (!link.success) throw new ProviderAccountStoreError('invalid-bound');
        return { status: link.data.run_id === input.runId ? 'attached' : 'session-linked-elsewhere' };
      }
      if (db.prepare('SELECT run_id FROM provider_account_session_links WHERE run_id = ?').get(input.runId)) {
        return { status: 'run-linked-elsewhere' };
      }
      db.prepare(`INSERT INTO provider_account_session_links (provider, sdk_session_id, run_id, attached_at)
        VALUES (?, ?, ?, ?)`).run(input.provider, input.sdkSessionId, input.runId, input.attachedAt);
      return { status: 'attached' };
    });
  }

  /** Resolve the authoritative link before considering a session legacy/ambient. */
  async lookupBySdkSession(request: AccountSdkSessionLookup): Promise<AccountBindingLookup> {
    const parsed = sdkSessionLookupSchema.safeParse(request);
    if (!parsed.success) return { status: 'invalid-bound' };
    const input = parsed.data;
    let result: AccountBindingLookup;
    try {
      result = this.atomic(db => {
        const rawLink = db.prepare('SELECT * FROM provider_account_session_links WHERE provider = ? AND sdk_session_id = ?')
          .get(input.provider, input.sdkSessionId);
        if (!rawLink) return { status: 'absent' };
        const link = sessionLinkSchema.safeParse(rawLink);
        if (!link.success) throw new ProviderAccountStoreError('invalid-bound');
        const rawBinding = db.prepare('SELECT * FROM provider_account_run_bindings WHERE run_id = ?').get(link.data.run_id);
        if (!rawBinding) throw new ProviderAccountStoreError('invalid-bound');
        const binding = this.parseBinding(rawBinding);
        if (binding.provider !== input.provider) throw new ProviderAccountStoreError('invalid-bound');
        return { status: 'bound', binding };
      });
    } catch (error: unknown) {
      // degradation-audit: optional-capability - typed refusal preserves storage failure; never treat it as ambient absence
      result = { status: providerAccountErrorCode(error) === 'invalid-bound' ? 'invalid-bound' : 'unavailable-storage' };
    }
    return result;
  }

  /** A run-id lookup is NOT a session-id lookup. Storage failure is never absence. */
  async lookupRunBinding(runId: string): Promise<AccountBindingLookup> {
    let result: AccountBindingLookup;
    try {
      const binding = this.binding(runId);
      result = binding ? { status: 'bound', binding } : { status: 'absent' };
    } catch (error: unknown) {
      result = { status: providerAccountErrorCode(error) === 'invalid-bound' ? 'invalid-bound' : 'unavailable-storage' };
    }
    return result;
  }

  binding(runId: string): ProviderAccountBinding | null {
    this.validateIds(runId);
    return this.atomic(db => {
      const raw = db.prepare('SELECT * FROM provider_account_run_bindings WHERE run_id = ?').get(runId);
      if (!raw) return null;
      return this.parseBinding(raw);
    });
  }

  private parseBinding(raw: unknown): ProviderAccountBinding {
    const row = z.object({ run_id: opaqueId, version: z.literal(1), provider: z.literal('claude'),
      profile_id: opaqueId, route_revision: revision, route_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      auth_epoch: revision, identity_kind: z.enum(['known', 'unknown']), owner_key_hash: z.string().nullable(),
    }).safeParse(raw);
    if (!row.success) throw new ProviderAccountStoreError('invalid-bound');
    const parsed = row.data;
    const identity: ProviderAccountIdentityEvidence = parsed.identity_kind === 'known' && parsed.owner_key_hash !== null
      ? { kind: 'known', ownerKey: parsed.owner_key_hash } : { kind: 'unknown' };
    if (parsed.identity_kind !== identity.kind || (identity.kind === 'unknown' && parsed.owner_key_hash !== null)) {
      throw new ProviderAccountStoreError('invalid-bound');
    }
    if (identity.kind === 'known' && !isProviderAccountOwnerKey(identity.ownerKey)) {
      throw new ProviderAccountStoreError('invalid-bound');
    }
    return Object.freeze({ version: parsed.version, provider: parsed.provider, profileId: parsed.profile_id,
      routeRevision: parsed.route_revision, routeFingerprint: parsed.route_fingerprint, authEpoch: parsed.auth_epoch,
      runId: parsed.run_id, identity: Object.freeze(identity) });
  }

  /** Public Add never imports/adopts an existing credential directory. */
  add(profileId: string, label: string, directory: string): StoredProviderAccount {
    this.validateProfile(profileId, label);
    return withNewProviderAccountDirectory(directory, (route, validateOwned) => this.insert(profileId, label, route, validateOwned));
  }

  private insert(profileId: string, label: string, route: CanonicalProviderAccountRoute, validateOwned: () => void): StoredProviderAccount {
    revalidateProviderAccountRoute(route);
    return this.atomic(db => {
      if (db.prepare('SELECT 1 FROM provider_account_profiles WHERE canonical_route = ? OR route_fingerprint = ?')
        .get(route.canonicalPath, route.fingerprint)) {
        throw new ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY);
      }
      this.assertLabelFree(db, label, null);
      this.unoccupied(db, route.fingerprint, true);
      validateOwned();
      db.prepare(`INSERT INTO provider_account_profiles
        (profile_id, provider, label, canonical_route, route_fingerprint, physical_identity, created_at, updated_at)
        VALUES (?, 'claude', ?, ?, ?, ?, ?, ?)`)
        .run(profileId, label, route.canonicalPath, route.fingerprint, JSON.stringify(route.filesystemIdentity), Date.now(), Date.now());
      return this.profile(db, profileId);
    });
  }

  rename(profileId: string, expectedRevision: number, label: string): StoredProviderAccount {
    this.validateRevision(expectedRevision);
    this.validateProfile(profileId, label);
    return this.atomic(db => {
      const profile = this.profile(db, profileId, expectedRevision);
      this.assertLabelFree(db, label, profileId);
      this.unoccupied(db, profile.route_fingerprint, false);
      db.prepare('UPDATE provider_account_profiles SET label = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
        .run(label, Date.now(), profileId);
      return this.profile(db, profileId);
    });
  }

  /**
   * D40: a new or renamed name must differ (trimmed, case-insensitive) from every
   * live account and from the reserved ambient name. `exceptProfileId` is the
   * renamed row, so a case-only change of its own name passes. Rows that already
   * share a name are left as they are; only this write is checked.
   */
  private assertLabelFree(db: SqliteDatabase, label: string, exceptProfileId: string | null): void {
    const others = db.prepare("SELECT profile_id, label FROM provider_account_profiles WHERE provider = 'claude' AND removed_at IS NULL")
      .all().map(row => liveLabelSchema.parse(row))
      .filter(row => row.profile_id !== exceptProfileId).map(row => row.label);
    if (isProviderAccountLabelTaken(label, others)) {
      throw new ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY);
    }
  }

  remove(profileId: string, expectedRevision: number): void {
    this.validateRevision(expectedRevision);
    this.atomic(db => {
      const profile = this.profile(db, profileId, expectedRevision);
      this.unoccupied(db, profile.route_fingerprint, false);
      db.prepare('UPDATE provider_account_profiles SET removed_at = ?, updated_at = ?, revision = revision + 1 WHERE profile_id = ?')
        .run(Date.now(), Date.now(), profileId);
      db.prepare('UPDATE provider_account_selections SET profile_id = NULL, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
        .run(Date.now(), profileId);
    });
  }

  selection(workspaceRoot: string, scope: ProviderAccountScope): StoredAccountSelection {
    this.validateScope(workspaceRoot, scope);
    return this.atomic(db => this.readSelection(db, workspaceRoot, scope));
  }

  select(workspaceRoot: string, scope: ProviderAccountScope, profileId: string | null,
    expectedRevision: number, expectedProfileRevision?: number): StoredAccountSelection {
    this.validateScope(workspaceRoot, scope);
    this.validateRevision(expectedRevision, -1);
    return this.atomic(db => {
      const current = this.readSelection(db, workspaceRoot, scope);
      if (current.revision !== expectedRevision) throw new ProviderAccountStoreError('conflict');
      if (profileId !== null) {
        if (expectedProfileRevision === undefined) throw new ProviderAccountStoreError('conflict');
        this.validateRevision(expectedProfileRevision);
        const profile = this.profile(db, profileId, expectedProfileRevision);
        this.unoccupied(db, profile.route_fingerprint, false);
      }
      db.prepare(`INSERT INTO provider_account_selections (workspace_root, provider, scope, profile_id, revision, updated_at)
        VALUES (?, 'claude', ?, ?, ?, ?) ON CONFLICT(workspace_root, provider, scope)
        DO UPDATE SET profile_id = excluded.profile_id, revision = excluded.revision, updated_at = excluded.updated_at`)
        .run(workspaceRoot, scope, profileId, current.revision + 1, Date.now());
      return { profileId, revision: current.revision + 1 };
    });
  }

  /**
   * One immediate transaction: selection CAS, route and profile checks, then a
   * live lease carrying the profile's epoch and route revision. A named profile
   * must be `signed-in` with a recorded identity. On resume the existing binding
   * must match the profile, fingerprint and route revision, with an epoch at most
   * the profile epoch. Never inserts a binding.
   */
  acquireRunLease(request: AccountRunAdmission): AccountRunLease {
    this.validateIds(request.runId, request.reservationId, request.operationId);
    this.validateRevision(request.expectedRevision);
    revalidateProviderAccountRoute(request.route);
    return this.atomic(db => {
      if (request.selection) {
        const s = request.selection;
        this.validateRevision(s.revision, -1);
        this.validateScope(s.workspaceRoot, s.scope);
        const selected = this.readSelection(db, s.workspaceRoot, s.scope);
        if (selected.revision !== s.revision || selected.profileId !== request.profileId) throw new ProviderAccountStoreError('conflict');
      }
      const profile = this.routeProfile(db, request.profileId, request.expectedRevision, request.route);
      // An auth operation in progress is `busy` before the profile's sign-in state is judged.
      this.unoccupied(db, request.route.fingerprint, false);
      if (profile && (profile.state !== 'signed-in' || profile.identity_ref === null)) {
        throw new ProviderAccountStoreError('identity-unproved');
      }
      const rawBinding = db.prepare('SELECT * FROM provider_account_run_bindings WHERE run_id = ?').get(request.runId);
      const binding = rawBinding ? this.parseBinding(rawBinding) : null;
      if (binding) {
        if (!profile || binding.profileId !== profile.profile_id || binding.authEpoch > profile.auth_epoch) {
          throw new ProviderAccountStoreError('conflict');
        }
        if (binding.routeFingerprint !== profile.route_fingerprint || binding.routeRevision !== profile.route_revision) {
          throw new ProviderAccountStoreError('route-changed');
        }
      }
      // A resumed run reuses its run id (UNIQUE): free the lease an ended host left for it.
      this.reclaimAbandoned(db, request.route.fingerprint);
      const lease: StoredRunLease = {
        run_id: request.runId, profile_id: request.profileId, route_fingerprint: request.route.fingerprint,
        auth_epoch: profile?.auth_epoch ?? 0, route_revision: profile?.route_revision ?? 0, lease_state: 'live',
      };
      db.prepare(`INSERT INTO provider_account_run_leases
        (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at, auth_epoch, route_revision, lease_state,
          host_pid, host_machine)
        VALUES (?, ?, 'claude', ?, ?, ?, ?, ?, ?, 'live', ?, ?)`)
        .run(request.reservationId, lease.run_id, lease.profile_id, lease.route_fingerprint, request.operationId, Date.now(),
          lease.auth_epoch, lease.route_revision, CURRENT_LEASE_HOST.pid, CURRENT_LEASE_HOST.machine);
      return { binding, reservation: this.runReservation(request, lease, 'reserved') };
    });
  }

  /**
   * Status excludes other operations without starting a new authentication
   * epoch. Live runs do not make it busy: a status child only reads the route,
   * as the status child of every run certification already does beside other
   * live runs, and completion never changes the epoch or route a lease holds.
   */
  reserveStatus(profileId: string, expectedRevision: number, route: CanonicalProviderAccountRoute,
    operationId: string, ownerId: string): { readonly authEpoch: number } {
    this.validateIds(operationId, ownerId);
    this.validateRevision(expectedRevision);
    revalidateProviderAccountRoute(route);
    return this.atomic(db => {
      const profile = this.profile(db, profileId, expectedRevision);
      this.routeProfile(db, profileId, expectedRevision, route);
      this.unoccupied(db, route.fingerprint, false);
      db.prepare(`INSERT INTO provider_account_operations
        (operation_id, route_fingerprint, profile_id, provider, kind, auth_epoch, expected_revision, owner_id, created_at)
        VALUES (?, ?, ?, 'claude', 'status', ?, ?, ?, ?)`)
        .run(operationId, route.fingerprint, profileId, profile.auth_epoch, profile.revision, ownerId, Date.now());
      return { authEpoch: profile.auth_epoch };
    });
  }

  /** Unproved termination retains exclusion, even when the last observation is disconnected. */
  completeStatus(operationId: string, ownerId: string, authEpoch: number, state: ProviderAccountState, terminated: boolean,
    identityRef?: string | null): void {
    this.validateIds(operationId, ownerId);
    this.validateRevision(authEpoch);
    if (!PROVIDER_ACCOUNT_STATES.includes(state)) throw new ProviderAccountStoreError('conflict');
    this.validateIdentityRef(identityRef);
    this.atomic(db => {
      const raw = db.prepare(`SELECT profile_id, expected_revision FROM provider_account_operations
        WHERE operation_id = ? AND owner_id = ? AND auth_epoch = ? AND kind = 'status'`)
        .get(operationId, ownerId, authEpoch);
      if (!raw) throw new ProviderAccountStoreError('conflict');
      const op = z.object({ profile_id: opaqueId, expected_revision: revision }).parse(raw);
      const profile = this.profile(db, op.profile_id, op.expected_revision);
      if (profile.auth_epoch !== authEpoch) throw new ProviderAccountStoreError('conflict');
      const nextRef = identityRef === undefined ? profile.identity_ref : identityRef;
      if (profile.state !== state || profile.identity_ref !== nextRef) {
        db.prepare('UPDATE provider_account_profiles SET state = ?, identity_ref = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
          .run(state, nextRef, Date.now(), op.profile_id);
        if (!terminated) db.prepare('UPDATE provider_account_operations SET expected_revision = expected_revision + 1 WHERE operation_id = ?')
          .run(operationId);
      }
      if (terminated) db.prepare('DELETE FROM provider_account_operations WHERE operation_id = ?').run(operationId);
    });
  }

  reserveAuth(profileId: string | null, expectedRevision: number, route: CanonicalProviderAccountRoute,
    operationId: string, ownerId: string, kind: 'sign-in' | 'sign-out'): ClaudeAccountAuthOperationReservation {
    this.validateIds(operationId, ownerId);
    this.validateRevision(expectedRevision);
    if (kind !== 'sign-in' && kind !== 'sign-out') throw new ProviderAccountStoreError('conflict');
    revalidateProviderAccountRoute(route);
    return this.atomic(db => {
      const profile = this.routeProfile(db, profileId, expectedRevision, route);
      this.unoccupied(db, route.fingerprint, true);
      const epoch = (profile?.auth_epoch ?? 0) + 1;
      if (profile) db.prepare("UPDATE provider_account_profiles SET auth_epoch = ?, revision = revision + 1, state = 'pending', updated_at = ? WHERE profile_id = ?")
        .run(epoch, Date.now(), profileId);
      db.prepare(`INSERT INTO provider_account_operations
        (operation_id, route_fingerprint, profile_id, provider, kind, auth_epoch, expected_revision, owner_id, created_at)
        VALUES (?, ?, ?, 'claude', ?, ?, ?, ?, ?)`)
        .run(operationId, route.fingerprint, profileId, kind, epoch, (profile?.revision ?? 0) + 1, ownerId, Date.now());
      return { kind: 'auth-operation', phase: 'reserved', provider: 'claude', routeKind: profile ? 'named' : 'ambient',
        reservationId: operationId, operationId, routeFingerprint: route.fingerprint,
        routeRevision: profile?.route_revision ?? 0, authEpoch: epoch };
    });
  }

  /** Caller invokes only after child termination is established; otherwise leave held. */
  completeAuth(operationId: string, ownerId: string, authEpoch: number, state: ProviderAccountState,
    identityRef?: string | null): void {
    this.validateIds(operationId, ownerId);
    this.validateRevision(authEpoch);
    if (!PROVIDER_ACCOUNT_STATES.includes(state)) throw new ProviderAccountStoreError('conflict');
    this.validateIdentityRef(identityRef);
    this.atomic(db => {
      const raw = db.prepare('SELECT profile_id, expected_revision FROM provider_account_operations WHERE operation_id = ? AND owner_id = ? AND auth_epoch = ?')
        .get(operationId, ownerId, authEpoch);
      if (!raw) throw new ProviderAccountStoreError('conflict');
      const op = z.object({ profile_id: opaqueId.nullable(), expected_revision: revision }).parse(raw);
      if (op.profile_id) {
        const profile = this.profile(db, op.profile_id, op.expected_revision);
        if (profile.auth_epoch !== authEpoch) throw new ProviderAccountStoreError('conflict');
        const nextRef = identityRef === undefined ? profile.identity_ref : identityRef;
        db.prepare('UPDATE provider_account_profiles SET state = ?, identity_ref = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
          .run(state, nextRef, Date.now(), op.profile_id);
      }
      db.prepare('DELETE FROM provider_account_operations WHERE operation_id = ?').run(operationId);
    });
  }

  /** Termination proof belongs to the admission service, not a clock or PID heuristic. */
  release(command: ClaudeAccountReservationRelease): ClaudeAccountRunReservation & { readonly phase: 'released' } {
    if (!RELEASE_REASONS.includes(command.reason)) throw new ProviderAccountStoreError('conflict');
    return this.atomic(db => {
      const lease = this.held(db, command);
      db.prepare('DELETE FROM provider_account_run_leases WHERE lease_id = ?').run(command.reservationId);
      return this.runReservation(command, lease, 'released');
    });
  }

  /**
   * Records the run's current Claude child on its live lease (ownership and
   * epoch checked as for retain). A later child of the same run replaces it:
   * a run starts its next child only after the previous one's close.
   */
  recordRunChild(command: ClaudeAccountRunChild): ClaudeAccountRunReservation & { readonly phase: 'retained' } {
    if (!Number.isSafeInteger(command.pid) || command.pid <= 0) throw new ProviderAccountStoreError('conflict');
    return this.atomic(db => {
      const lease = this.held(db, command);
      db.prepare('UPDATE provider_account_run_leases SET child_pid = ? WHERE lease_id = ?').run(command.pid, command.reservationId);
      return this.runReservation(command, lease, 'retained');
    });
  }

  /** Checks ownership and epoch only; the lease stays. */
  retain(command: ClaudeAccountReservationRetain): ClaudeAccountRunReservation & { readonly phase: 'retained' } {
    return this.atomic(db => this.runReservation(command, this.held(db, command), 'retained'));
  }

  /**
   * The lease must be live, owned and at the caller's epoch. A quarantined
   * legacy row is never released or retained by a command.
   */
  private held(db: SqliteDatabase, command: ClaudeAccountReservationRetain): StoredRunLease {
    this.validateIds(command.reservationId, command.operationId);
    this.validateRevision(command.authEpoch);
    const raw = db.prepare(`SELECT run_id, profile_id, route_fingerprint, auth_epoch, route_revision, lease_state
      FROM provider_account_run_leases WHERE lease_id = ? AND owner_id = ?`)
      .get(command.reservationId, command.operationId);
    if (!raw) throw new ProviderAccountStoreError('conflict');
    const parsed = leaseSchema.safeParse(raw);
    if (!parsed.success) throw new ProviderAccountStoreError('unavailable-storage');
    if (parsed.data.lease_state !== 'live' || parsed.data.auth_epoch !== command.authEpoch) {
      throw new ProviderAccountStoreError('conflict');
    }
    return parsed.data;
  }

  private runReservation<P extends 'reserved' | 'released' | 'retained'>(
    keys: { readonly reservationId: string; readonly operationId: string }, lease: StoredRunLease, phase: P,
  ): ClaudeAccountRunReservation & { readonly phase: P } {
    return Object.freeze({
      kind: 'run', phase, provider: 'claude', routeKind: lease.profile_id === null ? 'ambient' : 'named',
      reservationId: keys.reservationId, operationId: keys.operationId, runId: lease.run_id,
      routeFingerprint: lease.route_fingerprint, routeRevision: lease.route_revision, authEpoch: lease.auth_epoch,
    } as const);
  }

  private routeProfile(db: SqliteDatabase, id: string | null, expected: number, route: CanonicalProviderAccountRoute): StoredProviderAccount | null {
    if (id === null) {
      if (db.prepare('SELECT 1 FROM provider_account_profiles WHERE route_fingerprint = ? OR canonical_route = ?')
        .get(route.fingerprint, route.canonicalPath)) throw new ProviderAccountStoreError('conflict');
      return null;
    }
    const profile = this.profile(db, id, expected);
    if (profile.route_fingerprint !== route.fingerprint || profile.canonical_route !== route.canonicalPath ||
      profile.physical_identity !== JSON.stringify(route.filesystemIdentity)) throw new ProviderAccountStoreError('route-changed');
    return profile;
  }

  private readSelection(db: SqliteDatabase, workspace: string, scope: ProviderAccountScope): StoredAccountSelection {
    const raw = db.prepare("SELECT profile_id, revision FROM provider_account_selections WHERE workspace_root = ? AND provider = 'claude' AND scope = ?").get(workspace, scope);
    if (!raw) return { profileId: null, revision: -1 };
    const row = selectionSchema.parse(raw);
    return { profileId: row.profile_id, revision: row.revision };
  }

  /** `includeRuns` first reclaims the route's leases whose owning host is proved gone. */
  private unoccupied(db: SqliteDatabase, fingerprint: string, includeRuns: boolean): void {
    if (includeRuns) this.reclaimAbandoned(db, fingerprint);
    if (db.prepare('SELECT 1 FROM provider_account_operations WHERE route_fingerprint = ?').get(fingerprint) ||
      (includeRuns && db.prepare('SELECT 1 FROM provider_account_run_leases WHERE route_fingerprint = ?').get(fingerprint))) {
      throw new ProviderAccountStoreError('busy');
    }
  }

  /**
   * Deletes the route's live leases whose run is proved over: same machine,
   * and neither the host pid nor the recorded Claude child pid exists. A
   * quarantined row, a legacy row without an owner, another machine's row and
   * a row with either process still present stay held. Disposal never proves
   * termination, and neither does the host's exit alone: its child can
   * outlive it.
   */
  private reclaimAbandoned(db: SqliteDatabase, fingerprint: string): void {
    const rows = db.prepare(`SELECT lease_id, host_pid, host_machine, child_pid FROM provider_account_run_leases
      WHERE route_fingerprint = ? AND lease_state = 'live' AND host_pid IS NOT NULL AND host_machine = ?`)
      .all(fingerprint, CURRENT_LEASE_HOST.machine);
    let reclaimed = 0;
    for (const raw of rows) {
      const row = leaseHostSchema.safeParse(raw);
      if (!row.success) throw new ProviderAccountStoreError('unavailable-storage');
      if (!leaseOwnerGone({ pid: row.data.host_pid, machine: row.data.host_machine, childPid: row.data.child_pid })) continue;
      db.prepare('DELETE FROM provider_account_run_leases WHERE lease_id = ?').run(row.data.lease_id);
      reclaimed += 1;
    }
    if (reclaimed > 0) this.logger?.warn('[ProviderAccountStore] Reclaimed run leases left by an ended host', { reclaimed });
  }

  private validateIds(...ids: string[]): void {
    if (!ids.every(id => typeof id === 'string' && isProviderAccountOpaqueId(id))) throw new ProviderAccountStoreError('conflict');
  }
  private validateRevision(value: number, minimum = 0): void {
    if (!Number.isSafeInteger(value) || value < minimum) throw new ProviderAccountStoreError('conflict');
  }
  private validateProfile(id: string, label: string): void {
    this.validateIds(id);
    if (typeof label !== 'string' || !isSafeProviderAccountLabel(label)) throw new ProviderAccountStoreError('conflict');
  }
  private validateIdentityRef(identityRef: string | null | undefined): void {
    if (identityRef !== undefined && identityRef !== null && !isProviderAccountIdentityRef(identityRef)) {
      throw new ProviderAccountStoreError('conflict');
    }
  }
  private validateIdentity(identity: ProviderAccountIdentityEvidence): void {
    const parsed = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('unknown') }).strict(),
      z.object({ kind: z.literal('known'), ownerKey: z.string().refine(isProviderAccountOwnerKey) }).strict(),
    ]).safeParse(identity);
    if (!parsed.success) throw new ProviderAccountStoreError('identity-unproved');
  }

  private validateScope(workspace: string, scope: ProviderAccountScope): void {
    if (!workspace || (scope !== 'main' && scope !== 'lane')) throw new ProviderAccountStoreError('conflict');
  }
}

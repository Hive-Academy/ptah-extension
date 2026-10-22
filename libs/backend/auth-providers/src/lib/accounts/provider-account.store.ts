import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { PERSISTENCE_TOKENS, type SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import {
  isProviderAccountOpaqueId, isProviderAccountOwnerKey, isSafeProviderAccountLabel,
  PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY, PROVIDER_ACCOUNT_STATES,
  type ProviderAccountBinding, type ProviderAccountIdentityEvidence, type ProviderAccountScope, type ProviderAccountState,
} from '@ptah-extension/shared';
import type { ClaudeAccountRunReservation, ClaudeAccountAuthOperationReservation,
  ClaudeAccountReservationRelease, ClaudeAccountReservationRetain } from '@ptah-extension/auth-providers-tokens';
import { ProviderAccountStoreError, revalidateProviderAccountRoute,
  withNewProviderAccountDirectory, providerAccountErrorCode, type CanonicalProviderAccountRoute } from './provider-account-route';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const opaqueId = z.string().refine(isProviderAccountOpaqueId);
const sdkSessionId = z.string().min(1).max(256).regex(/^[^/\\\s\x00-\x1f\x7f]+$/);
const sdkSessionLookupSchema = z.object({
  provider: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/), sdkSessionId,
}).strict();
const sdkSessionAttachmentSchema = sdkSessionLookupSchema.extend({ runId: opaqueId, attachedAt: revision });
const sessionLinkSchema = z.object({ run_id: opaqueId, sdk_session_id: sdkSessionId, attached_at: revision });
const profileSchema = z.object({
  profile_id: opaqueId, provider: z.literal('claude'), label: z.string().refine(isSafeProviderAccountLabel),
  canonical_route: z.string(), route_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  physical_identity: z.string(), revision, route_revision: revision, auth_epoch: revision,
  state: z.enum(PROVIDER_ACCOUNT_STATES), removed_at: z.number().nullable(),
});
export type StoredProviderAccount = z.infer<typeof profileSchema>;
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
  readonly identity?: ProviderAccountIdentityEvidence;
  readonly selection?: { readonly workspaceRoot: string; readonly scope: ProviderAccountScope; readonly revision: number };
}

/** Lazy shared connection: registration does not open or choose a database.
 * All writes are synchronous. No expiry, PID recovery or in-memory fallback.
 */
@injectable()
export class ProviderAccountStore {
  constructor(@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: Pick<SqliteConnectionService, 'db'>) {}

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

  list(): readonly StoredProviderAccount[] {
    return this.atomic(db => db.prepare("SELECT * FROM provider_account_profiles WHERE provider = 'claude' AND removed_at IS NULL ORDER BY created_at, profile_id")
      .all().map(row => profileSchema.parse(row)));
  }

  /** Awaitable registry commit only; this does not authorize prompt release. */
  async commitRunBinding(request: AccountRunAdmission): Promise<ReturnType<ProviderAccountStore['admit']>> {
    return this.admit(request);
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
      this.unoccupied(db, profile.route_fingerprint, false);
      db.prepare('UPDATE provider_account_profiles SET label = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
        .run(label, Date.now(), profileId);
      return this.profile(db, profileId);
    });
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

  admit(request: AccountRunAdmission): { reservation: ClaudeAccountRunReservation; binding: ProviderAccountBinding | null } {
    this.validateIds(request.runId, request.reservationId, request.operationId);
    this.validateRevision(request.expectedRevision);
    const identity = request.identity ?? { kind: 'unknown' };
    this.validateIdentity(identity);
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
      this.unoccupied(db, request.route.fingerprint, false);
      const binding: ProviderAccountBinding | null = profile ? {
        version: 1, provider: 'claude', profileId: profile.profile_id, routeRevision: profile.route_revision,
        routeFingerprint: profile.route_fingerprint, authEpoch: profile.auth_epoch, runId: request.runId, identity: Object.freeze({ ...identity }),
      } : null;
      if (binding) db.prepare(`INSERT INTO provider_account_run_bindings
        (run_id, provider, profile_id, route_revision, route_fingerprint, auth_epoch, identity_kind, owner_key_hash, created_at)
        VALUES (?, 'claude', ?, ?, ?, ?, ?, ?, ?)`)
        .run(binding.runId, binding.profileId, binding.routeRevision, binding.routeFingerprint, binding.authEpoch,
          identity.kind, identity.kind === 'known' ? identity.ownerKey : null, Date.now());
      db.prepare(`INSERT INTO provider_account_run_leases
        (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at) VALUES (?, ?, 'claude', ?, ?, ?, ?)`)
        .run(request.reservationId, request.runId, request.profileId, request.route.fingerprint, request.operationId, Date.now());
      return { binding: binding ? Object.freeze(binding) : null, reservation: {
        kind: 'run', phase: 'reserved', provider: 'claude', routeKind: profile ? 'named' : 'ambient',
        reservationId: request.reservationId, operationId: request.operationId, runId: request.runId,
        routeFingerprint: request.route.fingerprint, routeRevision: profile?.route_revision ?? 0, authEpoch: profile?.auth_epoch ?? 0,
      } };
    });
  }

  /** Status excludes other operations without starting a new authentication epoch. */
  reserveStatus(profileId: string, expectedRevision: number, route: CanonicalProviderAccountRoute,
    operationId: string, ownerId: string): { readonly authEpoch: number } {
    this.validateIds(operationId, ownerId);
    this.validateRevision(expectedRevision);
    revalidateProviderAccountRoute(route);
    return this.atomic(db => {
      const profile = this.profile(db, profileId, expectedRevision);
      this.routeProfile(db, profileId, expectedRevision, route);
      this.unoccupied(db, route.fingerprint, true);
      db.prepare(`INSERT INTO provider_account_operations
        (operation_id, route_fingerprint, profile_id, provider, kind, auth_epoch, expected_revision, owner_id, created_at)
        VALUES (?, ?, ?, 'claude', 'status', ?, ?, ?, ?)`)
        .run(operationId, route.fingerprint, profileId, profile.auth_epoch, profile.revision, ownerId, Date.now());
      return { authEpoch: profile.auth_epoch };
    });
  }

  /** Unproved termination retains exclusion, even when the last observation is disconnected. */
  completeStatus(operationId: string, ownerId: string, authEpoch: number, state: ProviderAccountState, terminated: boolean): void {
    this.validateIds(operationId, ownerId);
    this.validateRevision(authEpoch);
    if (!PROVIDER_ACCOUNT_STATES.includes(state)) throw new ProviderAccountStoreError('conflict');
    this.atomic(db => {
      const raw = db.prepare(`SELECT profile_id, expected_revision FROM provider_account_operations
        WHERE operation_id = ? AND owner_id = ? AND auth_epoch = ? AND kind = 'status'`)
        .get(operationId, ownerId, authEpoch);
      if (!raw) throw new ProviderAccountStoreError('conflict');
      const op = z.object({ profile_id: opaqueId, expected_revision: revision }).parse(raw);
      const profile = this.profile(db, op.profile_id, op.expected_revision);
      if (profile.auth_epoch !== authEpoch) throw new ProviderAccountStoreError('conflict');
      if (profile.state !== state) {
        db.prepare('UPDATE provider_account_profiles SET state = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
          .run(state, Date.now(), op.profile_id);
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
  completeAuth(operationId: string, ownerId: string, authEpoch: number, state: ProviderAccountState): void {
    this.validateIds(operationId, ownerId);
    this.validateRevision(authEpoch);
    if (!PROVIDER_ACCOUNT_STATES.includes(state)) throw new ProviderAccountStoreError('conflict');
    this.atomic(db => {
      const raw = db.prepare('SELECT profile_id, expected_revision FROM provider_account_operations WHERE operation_id = ? AND owner_id = ? AND auth_epoch = ?')
        .get(operationId, ownerId, authEpoch);
      if (!raw) throw new ProviderAccountStoreError('conflict');
      const op = z.object({ profile_id: opaqueId.nullable(), expected_revision: revision }).parse(raw);
      if (op.profile_id) {
        const profile = this.profile(db, op.profile_id, op.expected_revision);
        if (profile.auth_epoch !== authEpoch) throw new ProviderAccountStoreError('conflict');
        db.prepare('UPDATE provider_account_profiles SET state = ?, revision = revision + 1, updated_at = ? WHERE profile_id = ?')
          .run(state, Date.now(), op.profile_id);
      }
      db.prepare('DELETE FROM provider_account_operations WHERE operation_id = ?').run(operationId);
    });
  }

  /** Termination proof belongs to the admission service, not a clock or PID heuristic. */
  release(command: ClaudeAccountReservationRelease): void {
    this.atomic(db => {
      this.held(db, command);
      db.prepare('DELETE FROM provider_account_run_leases WHERE lease_id = ?').run(command.reservationId);
    });
  }

  retain(command: ClaudeAccountReservationRetain): void { this.atomic(db => this.held(db, command)); }

  private held(db: SqliteDatabase, command: ClaudeAccountReservationRetain): void {
    this.validateIds(command.reservationId, command.operationId);
    this.validateRevision(command.authEpoch);
    const raw = db.prepare(`SELECT COALESCE(b.auth_epoch, 0) AS auth_epoch FROM provider_account_run_leases l
      LEFT JOIN provider_account_run_bindings b ON b.run_id = l.run_id WHERE l.lease_id = ? AND l.owner_id = ?`)
      .get(command.reservationId, command.operationId);
    if (!raw || z.object({ auth_epoch: revision }).parse(raw).auth_epoch !== command.authEpoch) {
      throw new ProviderAccountStoreError('conflict');
    }
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

  private unoccupied(db: SqliteDatabase, fingerprint: string, includeRuns: boolean): void {
    if (db.prepare('SELECT 1 FROM provider_account_operations WHERE route_fingerprint = ?').get(fingerprint) ||
      (includeRuns && db.prepare('SELECT 1 FROM provider_account_run_leases WHERE route_fingerprint = ?').get(fingerprint))) {
      throw new ProviderAccountStoreError('busy');
    }
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

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { inject, injectable } from 'tsyringe';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { ProviderAccountAdmissionPort, ClaudeAccountAdmissionRequest, ClaudeAccountAdmissionOutcome,
  ClaudeAccountNamedRoute, ClaudeAccountSelectionReader,
  ClaudeAccountReservationRelease, ClaudeAccountReservationReleaseOutcome,
  ClaudeAccountReservationRetain, ClaudeAccountReservationRetainOutcome, ProviderAccountPortRefusal } from '@ptah-extension/auth-providers-tokens';
import { accountActionResult } from './claude-account-command';
import { ClaudeRouteCertifier, type ClaudeRouteCertification } from './claude-route-certifier';
import type { SqliteConnectionService, SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { isProviderAccountOpaqueId, isSafeProviderAccountLabel, type ProviderAccountBinding,
  type ProviderAccountScope, type ProviderAccountSummary } from '@ptah-extension/shared';
import { ProviderAccountStore, type StoredProviderAccount, type StoredAccountSelection, type AccountBindingLookup,
  type AccountRunBindingCommit, type AccountRunLease, type AccountSdkSessionAttachment, type AccountSdkSessionAttachmentResult,
  type AccountSdkSessionLookup } from './provider-account.store';
import { ProviderAccountStoreError, providerAccountErrorCode, resolveProviderAccountRoute,
  type CanonicalProviderAccountRoute } from './provider-account-route';

/** Run working directory: absolute, bounded, no NUL. */
function isRunWorkingDirectory(value: string): boolean {
  return value.length <= 4096 && !value.includes('\0') && isAbsolute(value);
}

/** Every named run certifies with the CLI's default setting sources (Component 7). */
const RUN_SETTING_SOURCES = ['user', 'project', 'local'] as const;

function storeCode(error: unknown): ProviderAccountPortRefusal['code'] {
  return error instanceof ProviderAccountStoreError ? error.code : 'unavailable-storage';
}

const admissionRequestSchema = z.object({
  provider: z.literal('claude'), scope: z.enum(['main', 'lane']),
  operationId: z.string().refine(isProviderAccountOpaqueId),
  runId: z.string().refine(isProviderAccountOpaqueId),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('omitted') }).strict(),
    z.object({ kind: z.literal('ambient') }).strict(),
    z.object({ kind: z.literal('named'), profileId: z.string().refine(isProviderAccountOpaqueId) }).strict(),
  ]),
  workingDirectory: z.string().min(1).refine(isRunWorkingDirectory).optional(),
}).strict();

/**
 * Stable UUID-shaped profile ID for one Add request (SHA-256, RFC 4122
 * version/variant bits). The same request always maps to the same row.
 */
function profileIdForRequest(requestId: string): string {
  const hex = createHash('sha256').update(`ptah.provider-account.add\0${requestId}`).digest('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Metadata, admission and stored selection. Construction never reads the database. */
@injectable()
export class ProviderAccountService implements ProviderAccountAdmissionPort, ClaudeAccountSelectionReader {
  private disposed = false;
  /** Aborts in-flight certification children on disposal; disposal is not termination proof. */
  private readonly disposal = new AbortController();

  constructor(@inject(ProviderAccountStore) private readonly store: ProviderAccountStore,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: Pick<SqliteConnectionService, 'db' | 'dbPath'>,
    @inject(ClaudeRouteCertifier) private readonly certifier: ClaudeRouteCertifier) {}

  /** Persistence checkpoint for a live lease; prompt release still waits for the SDK gate. */
  async commitRunBinding(command: AccountRunBindingCommit): Promise<ProviderAccountBinding> {
    if (this.disposed) throw new ProviderAccountStoreError('unavailable-storage');
    return this.store.commitRunBinding(command);
  }

  /**
   * Fails closed: a storage error throws `unavailable-storage` (or `busy`)
   * instead of returning null, which would silently pick the default account.
   */
  async readStoredSelection(workspaceRoot: string, scope: ProviderAccountScope): Promise<{ readonly profileId: string | null }> {
    if (this.disposed) throw new ProviderAccountStoreError('unavailable-storage');
    try {
      return { profileId: this.store.selection(workspaceRoot, scope).profileId };
    } catch (error: unknown) {
      throw new ProviderAccountStoreError(storeCode(error));
    }
  }

  async lookupRunBinding(runId: string): Promise<AccountBindingLookup> {
    if (this.disposed) return { status: 'unavailable-storage' };
    return this.store.lookupRunBinding(runId);
  }

  async attachSdkSession(request: AccountSdkSessionAttachment): Promise<AccountSdkSessionAttachmentResult> {
    if (this.disposed) throw new ProviderAccountStoreError('unavailable-storage');
    return this.store.attachSdkSession(request);
  }

  async lookupBySdkSession(request: AccountSdkSessionLookup): Promise<AccountBindingLookup> {
    if (this.disposed) return { status: 'unavailable-storage' };
    return this.store.lookupBySdkSession(request);
  }

  /**
   * Lease, certify, then hand out a named route. A certification refusal
   * releases the lease only when every probe child's close was observed;
   * otherwise the lease is retained (no age or PID reclaim).
   */
  async admitClaudeRoute(request: ClaudeAccountAdmissionRequest): Promise<ClaudeAccountAdmissionOutcome> {
    if (this.disposed) return this.refusal('unavailable-storage');
    if (request.provider !== 'claude') return this.refusal('wrong-provider');
    const parsed = admissionRequestSchema.safeParse(request);
    if (!parsed.success) return this.refusal('conflict');
    const { selection, runId, operationId, workingDirectory } = parsed.data;
    // The default route is never admitted through this port.
    if (selection.kind !== 'named') return this.refusal('conflict');
    let route: CanonicalProviderAccountRoute;
    let lease: AccountRunLease;
    let identityRef: string | null;
    try {
      const profile = this.store.get(selection.profileId);
      route = resolveProviderAccountRoute(profile.canonical_route);
      lease = this.store.acquireRunLease({ profileId: profile.profile_id, expectedRevision: profile.revision, route,
        runId, reservationId: randomUUID(), operationId });
      identityRef = profile.identity_ref;
    } catch (error: unknown) {
      return this.refusal(storeCode(error));
    }
    const { reservation } = lease;
    const settle = { reservationId: reservation.reservationId, operationId, authEpoch: reservation.authEpoch };
    let certification: ClaudeRouteCertification;
    try {
      certification = await this.certifier.certify({ route, profile: { identityRef }, signal: this.disposal.signal,
        cwd: workingDirectory ?? route.canonicalPath, settingSources: RUN_SETTING_SOURCES });
    } catch {
      // degradation-audit: reported - a thrown certification proves no child close; the lease is retained and the run refused.
      certification = { ok: false, code: 'identity-unproved', terminated: false };
    }
    if (!certification.ok) {
      try {
        if (certification.terminated) this.store.release({ ...settle, reason: 'startup-failure' });
        else this.store.retain(settle);
      } catch (error: unknown) {
        return this.refusal(storeCode(error));
      }
      return this.refusal(certification.code);
    }
    // The only place the certification marker is asserted: after the lease and a passed certification.
    const namedRoute = Object.freeze({
      kind: 'named', provider: 'claude', profileId: selection.profileId, canonicalConfigDir: route.canonicalPath,
      routeFingerprint: reservation.routeFingerprint, routeRevision: reservation.routeRevision,
      authEpoch: reservation.authEpoch, runId,
    }) as ClaudeAccountNamedRoute;
    return { code: 'ok', reservation, resources: Object.freeze({
      kind: 'named', route: namedRoute, accountDataDir: route.canonicalPath,
      filesystemIdentity: route.filesystemIdentity, launch: certification.launch,
    } as const) };
  }

  async releaseReservation(command: ClaudeAccountReservationRelease): Promise<ClaudeAccountReservationReleaseOutcome> {
    if (this.disposed) return this.refusal('unavailable-storage');
    try {
      return { code: 'ok', reservation: this.store.release(command) };
    } catch (error: unknown) {
      return this.refusal(storeCode(error));
    }
  }

  async retainUnresolvedReservation(command: ClaudeAccountReservationRetain): Promise<ClaudeAccountReservationRetainOutcome> {
    if (this.disposed) return this.refusal('unavailable-storage');
    try {
      return { code: 'ok', reservation: this.store.retain(command) };
    } catch (error: unknown) {
      return this.refusal(storeCode(error));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disposal.abort();
    // Disposal is not termination proof. Never sweep persisted reservations.
  }

  private refusal(code: ProviderAccountPortRefusal['code']): ProviderAccountPortRefusal {
    return { code, summary: accountActionResult(code).summary };
  }

  /**
   * Adds a profile. With a `requestId` the profile ID is derived from it, so
   * the primary key makes the request durable: a replay after a restart
   * returns the stored account, a replay with another label or after removal
   * is `conflict`, and nothing is created twice.
   */
  add(label: string, requestId?: string): ProviderAccountSummary {
    if (!isSafeProviderAccountLabel(label)) throw new ProviderAccountStoreError('conflict');
    if (requestId !== undefined && !isProviderAccountOpaqueId(requestId)) {
      throw new ProviderAccountStoreError('conflict');
    }
    const profileId = requestId === undefined ? randomUUID() : profileIdForRequest(requestId);
    const dbPath = this.connection.dbPath;
    if (!isAbsolute(dbPath)) throw new ProviderAccountStoreError('unavailable-storage');
    try {
      const prior = requestId === undefined ? undefined : this.store.find(profileId);
      if (prior) {
        if (prior.removed_at !== null || prior.label !== label) throw new ProviderAccountStoreError('conflict');
        return this.summary(prior);
      }
      // Check each owned parent; do not follow a substituted symlink or junction.
      let parent = dirname(dbPath);
      for (const segment of ['provider-accounts', 'claude']) {
        parent = join(parent, segment);
        try { mkdirSync(parent, { mode: 0o700 }); }
        catch (error: unknown) {
          if (providerAccountErrorCode(error) !== 'EEXIST') throw error;
        }
        const stat = lstatSync(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProviderAccountStoreError('unsupported-store');
      }
      return this.summary(this.store.add(profileId, label, join(parent, profileId)));
    } catch (error: unknown) {
      if (error instanceof ProviderAccountStoreError) throw error;
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }

  list(): readonly ProviderAccountSummary[] { return this.store.list().map(profile => this.summary(profile)); }
  rename(profileId: string, expectedRevision: number, label: string): ProviderAccountSummary {
    return this.summary(this.store.rename(profileId, expectedRevision, label));
  }
  remove(profileId: string, expectedRevision: number): void { this.store.remove(profileId, expectedRevision); }
  selection(workspaceRoot: string, scope: ProviderAccountScope): StoredAccountSelection {
    return this.store.selection(workspaceRoot, scope);
  }
  select(workspaceRoot: string, scope: ProviderAccountScope, profileId: string | null,
    expectedRevision: number, expectedProfileRevision?: number): StoredAccountSelection {
    return this.store.select(workspaceRoot, scope, profileId, expectedRevision, expectedProfileRevision);
  }

  /** Both scope CAS checks and both writes share one immediate transaction. */
  setDefault(workspaceRoot: string, profileId: string | null,
    expected: Readonly<Record<ProviderAccountScope, number>>, expectedProfileRevision?: number):
    Readonly<Record<ProviderAccountScope, StoredAccountSelection>> {
    if (!workspaceRoot || (profileId !== null && !isProviderAccountOpaqueId(profileId)) ||
      ![expected.main, expected.lane].every(value => Number.isSafeInteger(value) && value >= -1) ||
      (profileId !== null && (!Number.isSafeInteger(expectedProfileRevision) || (expectedProfileRevision ?? -1) < 0))) {
      throw new ProviderAccountStoreError('conflict');
    }
    let db: SqliteDatabase | undefined;
    let started = false;
    try {
      db = this.connection.db;
      if (db.inTransaction) throw new ProviderAccountStoreError('conflict');
      db.exec('BEGIN IMMEDIATE');
      started = true;
      if (profileId !== null) {
        const raw = db.prepare("SELECT revision, route_fingerprint FROM provider_account_profiles WHERE profile_id = ? AND provider = 'claude' AND removed_at IS NULL").get(profileId);
        if (!raw) throw new ProviderAccountStoreError('missing-profile');
        const profile = z.object({ revision: z.number().int().nonnegative(), route_fingerprint: z.string() }).parse(raw);
        if (profile.revision !== expectedProfileRevision) throw new ProviderAccountStoreError('conflict');
        if (db.prepare('SELECT 1 FROM provider_account_operations WHERE route_fingerprint = ?').get(profile.route_fingerprint)) {
          throw new ProviderAccountStoreError('busy');
        }
      }
      for (const scope of ['main', 'lane'] as const) {
        const raw = db.prepare("SELECT revision FROM provider_account_selections WHERE workspace_root = ? AND provider = 'claude' AND scope = ?").get(workspaceRoot, scope);
        const revision = raw ? z.object({ revision: z.number().int().nonnegative() }).parse(raw).revision : -1;
        if (revision !== expected[scope]) throw new ProviderAccountStoreError('conflict');
        db.prepare(`INSERT INTO provider_account_selections (workspace_root, provider, scope, profile_id, revision, updated_at)
          VALUES (?, 'claude', ?, ?, ?, ?) ON CONFLICT(workspace_root, provider, scope)
          DO UPDATE SET profile_id = excluded.profile_id, revision = excluded.revision, updated_at = excluded.updated_at`)
          .run(workspaceRoot, scope, profileId, revision + 1, Date.now());
      }
      db.exec('COMMIT');
      return { main: { profileId, revision: expected.main + 1 }, lane: { profileId, revision: expected.lane + 1 } };
    } catch (error: unknown) {
      if (started && db?.inTransaction) {
        try { db.exec('ROLLBACK'); }
        catch (rollbackError: unknown) {
          // degradation-audit: optional-capability — preserve the original safe refusal if SQLite ended the transaction
        }
      }
      if (error instanceof ProviderAccountStoreError) throw error;
      if (/SQLITE_(BUSY|LOCKED)/.test(providerAccountErrorCode(error))) {
        throw new ProviderAccountStoreError('busy');
      }
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }

  private summary(profile: StoredProviderAccount): ProviderAccountSummary {
    try {
      const row = this.connection.db.prepare('SELECT COUNT(*) AS count FROM provider_account_run_leases WHERE route_fingerprint = ?').get(profile.route_fingerprint);
      const activeRunCount = z.object({ count: z.number().int().nonnegative() }).parse(row).count;
      return { profileId: profile.profile_id, provider: 'claude', label: profile.label, state: profile.state,
        revision: profile.revision, owner: 'unknown', activeRunCount };
    } catch (error: unknown) {
      if (error instanceof ProviderAccountStoreError) throw error;
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }
}

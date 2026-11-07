/**
 * MCP caller token registry.
 *
 * Lane and session tokens live in memory and die on `revokeSubject` or
 * `revokeEphemeral` (`stop`). Persistent slot tokens are remembered as a
 * sha256 digest plus the binding in host `IStateStorage`, so a restart can
 * recognise the token already written in a config file and leave that file
 * byte-identical (M1). The raw token is never stored and never logged.
 *
 * The registry decides keep-versus-issue and replaces an unknown file token
 * rather than treating it as one of ours (M2: a persistent slot is read-only
 * unless the setting is `full`, and a home slot is always read-only).
 */

import * as crypto from 'node:crypto';
import { z } from 'zod';
import type {
  IStateStorage,
  McpCallerBinding,
  McpCallerCapability,
} from '@ptah-extension/platform-core';
import { MCP_LEGACY_UNTOKENED_READ_ONLY } from '../mcp-core/mcp-caller-policy';
import {
  authRequiredFailure,
  bindingMatchesUrl,
  callerForbiddenFailure,
  legacyReadOnlyBinding,
  type McpExternalAccess,
  type McpHttpAuthInput,
  type McpRequestAuth,
} from '../mcp-core/mcp-caller-auth.types';

const STORE_KEY = 'ptah.mcp.callerCredentialHashes';
const LEGACY_UNMAPPED_KEY = 'unmapped';
const HASH_LENGTH = 32;
const TOKEN_LENGTH = 43;

const LEGACY_NOTICE =
  'External MCP callers are read-only until the config rewrite is picked up. Full access is the MCP setting.';

export interface McpCredentialLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(
    message: string | Error,
    errorOrContext?: Error | Record<string, unknown>,
  ): void;
}

export interface McpLegacyNotice {
  showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined>;
}

export interface PersistentSlotInput {
  readonly configPath: string;
  readonly kind: 'workspace' | 'home';
  readonly workspaceRoot?: string;
  readonly setting: McpExternalAccess;
  readonly fileToken?: string;
}

export interface PersistentReconcileResult {
  /** Existing credential was verified against host-local state. */
  readonly preserveFile: boolean;
  /** Credential to keep or write. Never persist or log this value. */
  readonly token: string;
}

export interface PreparedPersistentCredential
  extends PersistentReconcileResult {
  /** Commit only after the config writer accepts the credential. */
  readonly commit: () => Promise<void>;
}

interface LaneRecord {
  readonly tokenHash: Buffer;
  readonly binding: McpCallerBinding;
  readonly expiresAt: number;
  readonly subject: string;
}

interface PersistentRecord {
  readonly configPath: string;
  readonly tokenHash: Buffer;
  readonly kind: 'workspace' | 'home';
  readonly workspaceRoot?: string;
  readonly capability: McpCallerCapability;
}

const storedRecordSchema = z.object({
  configPath: z.string().min(1),
  tokenHashB64: z.string().min(1),
  kind: z.enum(['workspace', 'home']),
  workspaceRoot: z.string().min(1).optional(),
  capability: z.enum(['read-only', 'privileged']),
});

const storedEnvelopeSchema = z.object({
  records: z.array(z.unknown()),
});

export class McpCallerTokenRegistry {
  private readonly laneRecords: LaneRecord[] = [];
  private persistent: PersistentRecord[] = [];
  private currentAccess: McpExternalAccess | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly warnedLegacy = new Set<string>();
  private legacyNoticed = false;

  constructor(
    private readonly options: {
      readonly state?: IStateStorage;
      readonly logger: McpCredentialLogger;
      readonly notice?: McpLegacyNotice;
      /** Current setting is authoritative when a stored record is loaded. */
      readonly externalCallerAccess?: McpExternalAccess;
      readonly now?: () => number;
    },
  ) {
    this.currentAccess = options.externalCallerAccess;
    this.persistent = this.readPersistent();
  }

  /** In-memory token. Not written to state. Home is forced read-only. */
  issue(binding: McpCallerBinding, subject: string, ttlMs: number): string {
    const token = mintToken();
    this.laneRecords.push({
      tokenHash: digestToken(token),
      binding: clampHome(binding),
      expiresAt: this.now() + ttlMs,
      subject,
    });
    return token;
  }

  /** Drop in-memory tokens for `subject`. Persistent hashes are kept (M1). */
  revokeSubject(subject: string): void {
    for (let index = this.laneRecords.length - 1; index >= 0; index -= 1) {
      if (this.laneRecords[index]?.subject === subject) {
        this.laneRecords.splice(index, 1);
      }
    }
  }

  /** `stop()`: lane and session tokens die. Persistent hashes stay on disk. */
  revokeEphemeral(): void {
    this.laneRecords.length = 0;
  }

  /**
   * Mint a persistent slot token and store its hash. Returns the raw token
   * once. Throws when this config path already has a record, so a restart
   * cannot rotate it. Does not write a config file.
   */
  async issuePersistent(
    input: Omit<PersistentSlotInput, 'fileToken'>,
  ): Promise<string> {
    if (this.findPersistent(input.configPath) !== undefined) {
      throw new Error(
        `Persistent MCP credential already exists for ${input.configPath}`,
      );
    }
    const token = mintToken();
    const next = [
      ...this.persistent,
      this.toPersistent(input, digestToken(token)),
    ];
    await this.persist(next);
    this.persistent = next.map((record) => this.clampRecord(record));
    return token;
  }

  /**
   * Prepare a persistent credential without replacing the live record.
   * `commit` runs only after the config file write succeeds.
   */
  async preparePersistent(
    input: PersistentSlotInput,
  ): Promise<PreparedPersistentCredential> {
    const capability = this.allowedCapability(input.kind, input.setting);
    const records = this.persistent.filter(
      (record) => record.configPath === input.configPath,
    );
    const fileToken = input.fileToken;
    const fileDigest =
      fileToken === undefined ? undefined : digestToken(fileToken);
    const existing =
      fileDigest === undefined
        ? undefined
        : records.find((record) =>
            digestsEqual(fileDigest, record.tokenHash),
          );

    if (existing !== undefined && fileToken !== undefined) {
      await this.writeCapability(existing, capability);
      const current = this.persistent.filter(
        (record) => record.configPath === input.configPath,
      );
      const retained =
        current.find((record) =>
          digestsEqual(record.tokenHash, existing.tokenHash),
        ) ?? existing;
      return {
        preserveFile: true,
        token: fileToken,
        commit:
          current.length <= 1
            ? () => Promise.resolve()
            : async () => {
                // A failed replacement can leave the old and file hashes live.
                // Retry keeps the file hash and removes the stale hash.
                const latest =
                  this.persistent.find(
                    (record) =>
                      record.configPath === input.configPath &&
                      digestsEqual(record.tokenHash, retained.tokenHash),
                  ) ?? retained;
                const next = [
                  ...this.persistent.filter(
                    (record) => record.configPath !== input.configPath,
                  ),
                  latest,
                ];
                await this.persist(next.map((record) => this.clampRecord(record)));
                this.persistent = next.map((record) => this.clampRecord(record));
              },
      };
    }

    // A replacement must not leave an old privileged token live after the
    // setting becomes read-only. Clamp in memory before any config or state
    // write. A restart also derives capability from the current setting.
    if (capability === 'read-only') {
      this.persistent = this.persistent.map((record) =>
        record.configPath === input.configPath &&
        record.capability !== 'read-only'
          ? { ...record, capability: 'read-only' }
          : record,
      );
    }

    // Missing or unknown file credentials cannot be recovered from a hash.
    // Do not expose the candidate until the caller commits it after the config
    // write. If durable state then fails, keep both hashes live and clamped so
    // the published file token works and a retry can finish the transition.
    const token = mintToken();
    const candidate = this.toPersistent(input, digestToken(token));
    // Durably stage the hash before the token can be published to a config file.
    const pending = [...this.persistent, candidate];
    await this.persist(pending.map((record) => this.clampRecord(record)));
    this.persistent = pending.map((record) => this.clampRecord(record));
    return {
      preserveFile: false,
      token,
      commit: async () => {
        const next = [
          ...this.persistent.filter(
            (record) => record.configPath !== input.configPath,
          ),
          this.clampRecord(candidate),
        ];
        try {
          await this.persist(next);
        } catch (error: unknown) {
          const current = this.persistent.filter(
            (record) => record.configPath === input.configPath,
          );
          const retained = current.some((record) =>
            digestsEqual(record.tokenHash, candidate.tokenHash),
          )
            ? current
            : [...current, candidate];
          this.persistent = [
            ...this.persistent.filter(
              (record) => record.configPath !== input.configPath,
            ),
            ...retained,
          ];
          throw error;
        }
        this.persistent = next.map((record) => this.clampRecord(record));
      },
    };
  }

  /**
   * Apply the setting to every live persistent binding without rotating tokens.
   * A downgrade clamps memory before the state write. An upgrade changes memory
   * only after the state write succeeds.
   */
  async applyExternalCallerAccess(access: McpExternalAccess): Promise<void> {
    this.clampExternalCallerAccess(access);
    const next = this.persistent.map((record) => ({
      ...record,
      capability: this.allowedCapability(record.kind, access),
    }));
    await this.persist(next);
    this.persistent = next.map((record) => this.clampRecord(record));
  }

  /** Clamp synchronously even when registration is awaiting a config write. */
  clampExternalCallerAccess(access: McpExternalAccess): void {
    this.currentAccess = access;
    if (access === 'read-only') {
      this.persistent = this.persistent.map((record) => this.clampRecord(record));
    }
  }

  private allowedCapability(kind: 'workspace' | 'home', requested: McpExternalAccess): McpCallerCapability {
    return capabilityFor(kind, requested === 'full' && this.currentAccess !== 'read-only' ? 'full' : 'read-only');
  }

  private clampRecord(record: PersistentRecord): PersistentRecord {
    return this.currentAccess === 'read-only' && record.capability !== 'read-only'
      ? { ...record, capability: 'read-only' }
      : record;
  }

  /** Direct registry users prepare and commit in one operation. */
  async reconcilePersistent(
    input: PersistentSlotInput,
  ): Promise<PersistentReconcileResult> {
    const prepared = await this.preparePersistent(input);
    await prepared.commit();
    return { preserveFile: prepared.preserveFile, token: prepared.token };
  }

  /** Headers and URL only. Does not read a body. */
  authorize(input: McpHttpAuthInput): McpRequestAuth {
    if (input.token === undefined) {
      if (!MCP_LEGACY_UNTOKENED_READ_ONLY) {
        return { ok: false, failure: authRequiredFailure() };
      }
      this.noteLegacy(input);
      return { ok: true, legacy: true, binding: legacyReadOnlyBinding(input) };
    }
    if (input.token.length !== TOKEN_LENGTH) {
      return { ok: false, failure: authRequiredFailure() };
    }

    const digest = digestToken(input.token);
    const binding = this.lookup(digest);
    if (binding === undefined) {
      return { ok: false, failure: authRequiredFailure() };
    }
    if (!bindingMatchesUrl(binding, input)) {
      return { ok: false, failure: callerForbiddenFailure() };
    }
    return { ok: true, legacy: false, binding };
  }

  private lookup(digest: Buffer): McpCallerBinding | undefined {
    const now = this.now();
    let compared = false;
    for (const record of this.laneRecords) {
      compared = true;
      if (!digestsEqual(digest, record.tokenHash)) continue;
      if (record.expiresAt <= now) return undefined;
      return record.binding;
    }
    for (const record of this.persistent) {
      compared = true;
      if (!digestsEqual(digest, record.tokenHash)) continue;
      return bindingFromPersistent(record);
    }
    if (!compared) {
      digestsEqual(digest, DUMMY_HASH);
    }
    return undefined;
  }

  private noteLegacy(input: McpHttpAuthInput): void {
    const workspaceRoot = input.workspaceRoot?.trim();
    const matched =
      workspaceRoot !== undefined && workspaceRoot !== ''
        ? this.persistent.filter(
            (record) =>
              record.kind === 'workspace' &&
              record.workspaceRoot === workspaceRoot,
          )
        : this.persistent.filter((record) => record.kind === 'home');
    const keys =
      matched.length > 0
        ? [...new Set(matched.map((record) => record.configPath))]
        : [LEGACY_UNMAPPED_KEY];
    for (const key of keys) {
      if (this.warnedLegacy.has(key)) continue;
      this.warnedLegacy.add(key);
      this.options.logger.warn(
        `MCP legacy caller accepted as read-only for config ${key}. External callers stay read-only until client config picks up credentials.`,
      );
    }
    if (this.legacyNoticed) return;
    this.legacyNoticed = true;
    const pending = this.options.notice?.showInformationMessage(LEGACY_NOTICE);
    void pending?.then(
      () => undefined,
      () => undefined,
    );
  }

  private findPersistent(configPath: string): PersistentRecord | undefined {
    return this.persistent.find((record) => record.configPath === configPath);
  }

  private toPersistent(
    input: Omit<PersistentSlotInput, 'fileToken'>,
    tokenHash: Buffer,
  ): PersistentRecord {
    const capability = this.allowedCapability(input.kind, input.setting);
    const workspaceRoot =
      input.kind === 'workspace' ? input.workspaceRoot : undefined;
    return {
      configPath: input.configPath,
      tokenHash,
      kind: input.kind,
      capability,
      ...(workspaceRoot === undefined || workspaceRoot === ''
        ? {}
        : { workspaceRoot }),
    };
  }

  private async writeCapability(
    existing: PersistentRecord,
    capability: McpCallerCapability,
  ): Promise<void> {
    const nextCapability = this.allowedCapability(existing.kind, capability === 'privileged' ? 'full' : 'read-only');
    if (existing.capability === nextCapability) return;
    const next = this.persistent.map((record) =>
      record.configPath === existing.configPath
        ? { ...record, capability: nextCapability }
        : record,
    );
    // A downgrade must fail closed in memory even when durable storage fails.
    if (nextCapability === 'read-only') this.persistent = next;
    await this.persist(next);
    this.persistent = next.map((record) => this.clampRecord(record));
  }

  private readPersistent(): PersistentRecord[] {
    const raw: unknown = this.options.state?.get(STORE_KEY);
    const envelope = storedEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      if (raw !== undefined) {
        this.options.logger.warn(
          'Ignored an invalid MCP caller credential store',
        );
      }
      return [];
    }
    const records: PersistentRecord[] = [];
    for (const entry of envelope.data.records) {
      const parsed = storedRecordSchema.safeParse(entry);
      if (!parsed.success) continue;
      const tokenHash = Buffer.from(parsed.data.tokenHashB64, 'base64');
      if (tokenHash.length !== HASH_LENGTH) continue;
      const kind = parsed.data.kind;
      records.push({
        configPath: parsed.data.configPath,
        tokenHash,
        kind,
        capability: capabilityFor(
          kind,
          this.options.externalCallerAccess ?? 'read-only',
        ),
        ...(parsed.data.workspaceRoot === undefined
          ? {}
          : { workspaceRoot: parsed.data.workspaceRoot }),
      });
    }
    return records;
  }

  private async persist(records: readonly PersistentRecord[]): Promise<void> {
    if (this.options.state === undefined) return;
    const run = this.persistQueue.then(() => this.persistNow(records));
    this.persistQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async persistNow(records: readonly PersistentRecord[]): Promise<void> {
    const payload = {
      records: records.map((entry) => this.clampRecord(entry)).map((record) => ({
        configPath: record.configPath,
        tokenHashB64: record.tokenHash.toString('base64'),
        kind: record.kind,
        capability: record.capability,
        ...(record.workspaceRoot === undefined
          ? {}
          : { workspaceRoot: record.workspaceRoot }),
      })),
    };
    try {
      await this.options.state?.update(STORE_KEY, payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn(
        `MCP caller credential store update failed: ${message}`,
      );
      throw error;
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

const DUMMY_HASH = Buffer.alloc(HASH_LENGTH, 0);

function capabilityFor(
  kind: 'workspace' | 'home',
  setting: McpExternalAccess,
): McpCallerCapability {
  if (kind === 'home') return 'read-only';
  return setting === 'full' ? 'privileged' : 'read-only';
}

function clampHome(binding: McpCallerBinding): McpCallerBinding {
  if (binding.kind !== 'home' || binding.capability === 'read-only') {
    return binding;
  }
  return { ...binding, capability: 'read-only' };
}

function bindingFromPersistent(record: PersistentRecord): McpCallerBinding {
  return {
    kind: record.kind,
    capability: record.kind === 'home' ? 'read-only' : record.capability,
    ...(record.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: record.workspaceRoot }),
  };
}

function mintToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function digestToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function digestsEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

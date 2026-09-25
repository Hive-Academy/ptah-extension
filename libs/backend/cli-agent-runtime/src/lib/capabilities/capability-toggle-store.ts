/**
 * `~/.ptah/capabilities/**` — the lock-free, one-file-per-toggle store behind
 * the capability toggles (TASK_2026_560, C2).
 *
 * ## Layout
 *
 * - `global/<kind>__<enc>.json` — explicit global items;
 * - `workspaces/<wsKey>/items/<kind>__<enc>.json` — explicit workspace items;
 * - `workspaces/<wsKey>/imported.json` — the IMPORTED layer (D1). One file per
 *   workspace, and its existence is the import marker;
 * - `workspaces/<wsKey>/root.json` — diagnostics only, never read for policy.
 *
 * ## Why there is no lock
 *
 * Every write is ONE {@link atomicWriteWithRetry} of ONE file: a unique temp
 * next to the target, then a rename. A reader therefore sees either the old
 * file or the new one, never a mix, and two writers to different items never
 * touch the same file — including the D2 pair, which the codec keeps in the
 * disjoint `l_`/`h_` namespaces. There is no read-modify-write anywhere, so
 * there is nothing a lock would protect. Same-item concurrent writes are
 * last-writer-wins by rename, and each of them is a value a user chose.
 *
 * Ptah never deletes an item. Clearing a workspace override writes the
 * `inherit` tombstone, because a deleted file would let the imported layer
 * show through again; a file a user deletes by hand simply means "no explicit
 * decision".
 *
 * ## Why reads fail closed
 *
 * Every read is a fresh `readdir` and fresh file reads, with no cache. A
 * missing directory (ENOENT) is an empty layer. Anything else that cannot be
 * trusted — an unreadable directory, a 0-byte or unparseable file, content
 * that fails the schema, or content whose canonical file name differs from
 * the name it sits under — is `status: 'error'` naming the path, and the
 * resolver turns that into an `unverified` policy. A corrupt `imported.json`
 * is never treated as absent: absent would re-run the import and could widen
 * the set. Names outside the item pattern (a sync tool's conflict copy, a
 * stranded `.tmp`) are ignored and logged.
 */

import { createHash } from 'crypto';
import { promises as fsPromises } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteWithRetry } from '@ptah-extension/harness-sync';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  canonicalFilename,
  parseCapabilityFilename,
  type CapabilityExplicitItem,
  type CapabilityFingerprintEntry,
  type CapabilityGlobalLayerSnapshot,
  type CapabilityImportDocument,
  type CapabilityItemSource,
  type CapabilityItemValue,
  type CapabilityKind,
  type CapabilityPolicyReason,
  type ICapabilityGlobalLayer,
} from '@ptah-extension/shared';

const LOG_PREFIX = '[CapabilityToggleStore]';

const GLOBAL_DIR = 'global';
const WORKSPACES_DIR = 'workspaces';
const ITEMS_DIR = 'items';
const IMPORTED_FILE = 'imported.json';
const ROOT_FILE = 'root.json';

/** `sha256(policyKey)` hex, first 32 — the directory name of one workspace. */
const WORKSPACE_KEY_LENGTH = 32;
const WORKSPACE_KEY_PATTERN = /^[0-9a-f]{32}$/;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const kindSchema = z.enum(['mcp', 'skill', 'plugin']);

const explicitItemSchema = z.object({
  v: z.literal(1),
  kind: kindSchema,
  id: z.string().min(1),
  value: z.enum(['on', 'off', 'inherit']),
  source: z.enum(['user', 'install']),
  at: z.iso.datetime({ offset: true }),
});

const importDocumentSchema = z.object({
  v: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  sources: z.array(
    z.object({
      path: z.string().min(1),
      kind: z.enum(['claude-project', 'settings-local']),
    }),
  ),
  // The IMPORTED layer holds MCP approvals only (C2); any other key is a file
  // this store did not write.
  entries: z.record(z.string().regex(/^mcp:.+$/), z.enum(['on', 'off'])),
});

// ---------------------------------------------------------------------------
// Public types and helpers
// ---------------------------------------------------------------------------

/**
 * A read of one explicit-item layer (global, or one workspace's items), taken
 * once and used whole. Same shape as the global snapshot the plugin loader
 * consumes.
 */
export type CapabilityItemLayerSnapshot = CapabilityGlobalLayerSnapshot;

/** A read of one workspace's IMPORTED layer. */
export type CapabilityImportedLayerRead =
  | { status: 'absent' }
  | { status: 'ok'; document: CapabilityImportDocument }
  | { status: 'error'; reasons: CapabilityPolicyReason[] };

/** A store write failed; the RPC layer turns it into a UI revert (AC-1.4). */
export class CapabilityToggleStoreError extends Error {
  constructor(
    message: string,
    /** The file or directory the failed operation targeted. */
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CapabilityToggleStoreError';
  }
}

/** `~/.ptah/capabilities` for the given home directory. */
export function defaultCapabilityStoreDir(homeDir: string = homedir()): string {
  return join(homeDir, '.ptah', 'capabilities');
}

/**
 * The store and comparison key for a workspace: its physical root, lower-cased
 * on win32 only (N7). NTFS folds case, so `D:\Repo` and `d:\repo` are one
 * workspace; ext4 does not, so `/a/Repo` and `/a/repo` are two.
 */
export function capabilityPolicyKey(
  physicalRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? physicalRoot.toLowerCase() : physicalRoot;
}

/** `sha256(policyKey).hex.slice(0, 32)` — the workspace's directory name. */
export function capabilityWorkspaceKey(policyKey: string): string {
  return createHash('sha256')
    .update(policyKey, 'utf8')
    .digest('hex')
    .slice(0, WORKSPACE_KEY_LENGTH);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * Persists explicit capability toggles and the IMPORTED layer.
 *
 * Not decorated for tsyringe: the base directory is a constructor argument so
 * a spec can point the store at a temp directory, and a `string` parameter
 * cannot be resolved by type. Register it with a factory that passes the
 * `PLATFORM_TOKENS.OUTPUT_CHANNEL` instance.
 */
export class CapabilityToggleStore implements ICapabilityGlobalLayer {
  /** Ignored names already reported, so a stray file is logged once, not per read. */
  private readonly reportedIgnoredNames = new Set<string>();

  constructor(
    private readonly output: IOutputChannel,
    private readonly baseDir: string = defaultCapabilityStoreDir(),
  ) {}

  // ---- Reads --------------------------------------------------------------

  /** The explicit global items. Never throws. */
  async readGlobalLayer(): Promise<CapabilityGlobalLayerSnapshot> {
    return this.readItemLayer(this.globalDir());
  }

  /** One workspace's explicit items. Never throws. */
  async readWorkspaceItems(
    wsKey: string,
  ): Promise<CapabilityItemLayerSnapshot> {
    const dir = this.tryWorkspaceDir(wsKey);
    if (typeof dir !== 'string') return { status: 'error', reasons: [dir] };
    return this.readItemLayer(join(dir, ITEMS_DIR));
  }

  /**
   * One workspace's IMPORTED layer. Never throws.
   *
   * `absent` only for ENOENT. A 0-byte, unparseable or schema-failing file is
   * `error`: treating it as absent would re-run the import over it.
   */
  async readImported(wsKey: string): Promise<CapabilityImportedLayerRead> {
    const dir = this.tryWorkspaceDir(wsKey);
    if (typeof dir !== 'string') return { status: 'error', reasons: [dir] };
    const path = join(dir, IMPORTED_FILE);

    let content: string;
    try {
      content = await fsPromises.readFile(path, 'utf-8');
    } catch (error: unknown) {
      if (fsErrorCode(error) === 'ENOENT') return { status: 'absent' };
      return this.importedError(path, reasonFor(error));
    }

    const parsed = parseJson(content);
    if (!parsed.ok) return this.importedError(path, parsed.error);
    const document = importDocumentSchema.safeParse(parsed.value);
    if (!document.success) {
      return this.importedError(path, 'not a valid import document');
    }
    return { status: 'ok', document: document.data };
  }

  // ---- Writes -------------------------------------------------------------

  /** Write one explicit global item. Touches only `global/`. */
  async writeGlobal(
    kind: CapabilityKind,
    id: string,
    value: CapabilityItemValue,
  ): Promise<CapabilityExplicitItem> {
    return this.writeItem(this.globalDir(), kind, id, value, 'user');
  }

  /** Write one explicit workspace item, as an ordinary user toggle or clear. */
  async writeWorkspace(
    wsKey: string,
    kind: CapabilityKind,
    id: string,
    value: CapabilityItemValue,
  ): Promise<CapabilityExplicitItem> {
    const dir = join(this.workspaceDir(wsKey), ITEMS_DIR);
    return this.writeItem(dir, kind, id, value, 'user');
  }

  /**
   * The install path (N6): a workspace `on` written as a concrete value even
   * when it equals the inherited one, so a later global change cannot undo
   * the install.
   */
  async setExplicit(
    wsKey: string,
    kind: CapabilityKind,
    id: string,
  ): Promise<CapabilityExplicitItem> {
    const dir = join(this.workspaceDir(wsKey), ITEMS_DIR);
    return this.writeItem(dir, kind, id, 'on', 'install');
  }

  /**
   * Publish the IMPORTED layer once (D1).
   *
   * Does nothing when `imported.json` already exists — whatever it holds,
   * including a corrupt file, which reads as `error` until the user fixes or
   * removes it. Otherwise one atomic write, so a reader sees no file or a
   * complete one; a crash mid-write leaves only a `.tmp`, which readers
   * ignore, and the next resolve imports again. Two concurrent publishes both
   * rename a complete document into place and the last rename wins.
   *
   * @returns whether this call published the document.
   * @throws CapabilityToggleStoreError when the marker cannot be checked or
   *   the document cannot be written.
   */
  async publishImport(
    wsKey: string,
    document: CapabilityImportDocument,
  ): Promise<boolean> {
    const path = join(this.workspaceDir(wsKey), IMPORTED_FILE);
    const valid = importDocumentSchema.safeParse(document);
    if (!valid.success) {
      throw new CapabilityToggleStoreError(
        `Refusing to publish an invalid import document to ${path}`,
        path,
      );
    }

    if (await this.exists(path)) return false;

    this.atomicWrite(path, `${JSON.stringify(valid.data, null, 2)}\n`);
    this.output.appendLine(
      `${LOG_PREFIX} Published the imported layer ${path} (${
        Object.keys(valid.data.entries).length
      } entries)`,
    );
    return true;
  }

  /**
   * Record which physical root a workspace key belongs to, for a human reading
   * the store. Written once; never read for policy.
   */
  async recordWorkspaceRoot(
    wsKey: string,
    physicalRoot: string,
    policyKey: string,
  ): Promise<void> {
    const path = join(this.workspaceDir(wsKey), ROOT_FILE);
    if (await this.exists(path)) return;
    const content = {
      v: 1,
      physicalRoot,
      policyKey,
      at: new Date().toISOString(),
    };
    this.atomicWrite(path, `${JSON.stringify(content, null, 2)}\n`);
  }

  // ---- Internals ----------------------------------------------------------

  private globalDir(): string {
    return join(this.baseDir, GLOBAL_DIR);
  }

  /** @throws CapabilityToggleStoreError for anything but a 32-hex key. */
  private workspaceDir(wsKey: string): string {
    if (!WORKSPACE_KEY_PATTERN.test(wsKey)) {
      // A key is always `capabilityWorkspaceKey` output; anything else could
      // name a path outside the store.
      throw new CapabilityToggleStoreError(
        'Invalid capability workspace key',
        join(this.baseDir, WORKSPACES_DIR),
      );
    }
    return join(this.baseDir, WORKSPACES_DIR, wsKey);
  }

  /** {@link workspaceDir} for the never-throw read paths. */
  private tryWorkspaceDir(wsKey: string): string | CapabilityPolicyReason {
    try {
      return this.workspaceDir(wsKey);
    } catch (error: unknown) {
      if (error instanceof CapabilityToggleStoreError) {
        return { path: error.path, error: 'invalid workspace key' };
      }
      throw error;
    }
  }

  private async readItemLayer(
    dir: string,
  ): Promise<CapabilityItemLayerSnapshot> {
    let names: string[];
    try {
      names = await fsPromises.readdir(dir);
    } catch (error: unknown) {
      if (fsErrorCode(error) === 'ENOENT') {
        return { status: 'ok', items: [], fingerprintEntries: [] };
      }
      return this.layerError([{ path: dir, error: reasonFor(error) }]);
    }

    const items: CapabilityExplicitItem[] = [];
    const fingerprintEntries: CapabilityFingerprintEntry[] = [];
    const reasons: CapabilityPolicyReason[] = [];

    for (const name of [...names].sort(compareCodeUnits)) {
      const path = join(dir, name);
      if (parseCapabilityFilename(name) === null) {
        this.reportIgnoredName(path);
        continue;
      }
      const read = await readItemFile(path, name);
      if (read.status === 'deleted') continue;
      if (read.status === 'error') {
        reasons.push({ path, error: read.error });
        continue;
      }
      items.push(read.item);
      if (read.item.kind === 'skill' || read.item.kind === 'plugin') {
        fingerprintEntries.push({ name, content: read.content });
      }
    }

    if (reasons.length > 0) return this.layerError(reasons);
    return { status: 'ok', items, fingerprintEntries };
  }

  private async writeItem(
    dir: string,
    kind: CapabilityKind,
    id: string,
    value: CapabilityItemValue,
    source: CapabilityItemSource,
  ): Promise<CapabilityExplicitItem> {
    const candidate = {
      v: 1 as const,
      kind,
      id,
      value,
      source,
      at: new Date().toISOString(),
    };
    const valid = explicitItemSchema.safeParse(candidate);
    if (!valid.success) {
      throw new CapabilityToggleStoreError(
        `Refusing to write an invalid ${kind} item`,
        dir,
      );
    }

    let fileName: string;
    try {
      fileName = canonicalFilename(kind, id);
    } catch (error: unknown) {
      // A lone surrogate has no UTF-8 form and so no file name.
      throw new CapabilityToggleStoreError(
        `The ${kind} id cannot be stored`,
        dir,
        { cause: error },
      );
    }

    const item: CapabilityExplicitItem = valid.data;
    this.atomicWrite(join(dir, fileName), `${JSON.stringify(item, null, 2)}\n`);
    return item;
  }

  /** One atomic write; a failure is logged and rethrown as the store error. */
  private atomicWrite(path: string, content: string): void {
    try {
      atomicWriteWithRetry(path, content);
    } catch (error: unknown) {
      const reason = reasonFor(error);
      this.output.appendLine(`${LOG_PREFIX} Could not write ${path}: ${reason}`);
      throw new CapabilityToggleStoreError(
        `Could not write ${path} (${reason})`,
        path,
        { cause: error },
      );
    }
  }

  /**
   * Whether `path` exists. ENOENT is `false`; any other failure throws,
   * because "cannot tell" must not be read as "absent" by a marker check.
   */
  private async exists(path: string): Promise<boolean> {
    try {
      await fsPromises.lstat(path);
      return true;
    } catch (error: unknown) {
      if (fsErrorCode(error) === 'ENOENT') return false;
      const reason = reasonFor(error);
      this.output.appendLine(`${LOG_PREFIX} Could not check ${path}: ${reason}`);
      throw new CapabilityToggleStoreError(
        `Could not check ${path} (${reason})`,
        path,
        { cause: error },
      );
    }
  }

  private layerError(
    reasons: CapabilityPolicyReason[],
  ): CapabilityItemLayerSnapshot {
    for (const { path, error } of reasons) {
      this.output.appendLine(`${LOG_PREFIX} Unreadable item ${path}: ${error}`);
    }
    return { status: 'error', reasons };
  }

  private importedError(
    path: string,
    error: string,
  ): CapabilityImportedLayerRead {
    this.output.appendLine(
      `${LOG_PREFIX} Unreadable imported layer ${path}: ${error}`,
    );
    return { status: 'error', reasons: [{ path, error }] };
  }

  private reportIgnoredName(path: string): void {
    if (this.reportedIgnoredNames.has(path)) return;
    this.reportedIgnoredNames.add(path);
    this.output.appendLine(
      `${LOG_PREFIX} Ignoring ${path}: not a capability item file name`,
    );
  }
}

// ---------------------------------------------------------------------------
// File-level helpers
// ---------------------------------------------------------------------------

type ItemFileRead =
  | { status: 'ok'; item: CapabilityExplicitItem; content: string }
  | { status: 'deleted' }
  | { status: 'error'; error: string };

/**
 * Read and validate one item file. The file name must be exactly what the
 * codec produces from the content's kind and id (D2), so a renamed or
 * hand-copied file can never speak for another item.
 */
async function readItemFile(path: string, name: string): Promise<ItemFileRead> {
  let content: string;
  try {
    content = await fsPromises.readFile(path, 'utf-8');
  } catch (error: unknown) {
    // Removed between the readdir and the read: no explicit decision.
    if (fsErrorCode(error) === 'ENOENT') return { status: 'deleted' };
    return { status: 'error', error: reasonFor(error) };
  }

  const parsed = parseJson(content);
  if (!parsed.ok) return { status: 'error', error: parsed.error };
  const item = explicitItemSchema.safeParse(parsed.value);
  if (!item.success) return { status: 'error', error: 'not a valid item' };

  let expected: string;
  try {
    expected = canonicalFilename(item.data.kind, item.data.id);
  } catch {
    // An id with no UTF-8 form has no canonical name, so the file is an
    // error, never trusted.
    return { status: 'error', error: 'id has no canonical file name' };
  }
  if (expected !== name) {
    return { status: 'error', error: 'file name does not match its content' };
  }
  return { status: 'ok', item: item.data, content };
}

function parseJson(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (content.length === 0) return { ok: false, error: 'empty file' };
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    // The caller reports the file as an error, which makes the policy
    // unverified.
    return { ok: false, error: 'invalid JSON' };
  }
}

/** Code-unit order, independent of locale, so a snapshot's order is stable. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function fsErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** A narrowed, user-facing reason: the errno code when there is one. */
function reasonFor(error: unknown): string {
  return fsErrorCode(error) ?? 'unreadable';
}

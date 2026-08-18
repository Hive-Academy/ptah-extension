/**
 * The persisted record of everything the user has authorized: which
 * marketplaces are registered, and which external plugins were installed
 * through the consent flow.
 *
 * ONE file, `~/.ptah/plugins/external/.ptah-external.json`, because the two
 * lists are one aggregate — "what external content this machine has said yes
 * to". Splitting them buys nothing and introduces a state where an install is
 * recorded but the marketplace it came from is not.
 *
 * SECURITY: `installed` is the allowlist. `PluginLoaderService` asks this store
 * whether an external id is resolvable, and a `true` here is the ONLY thing
 * that makes one resolvable. Directories are never consulted — see
 * `isInstalled` for why that distinction is the whole point.
 *
 * Reads are synchronous and uncached. `PluginLoaderService` is synchronous, and
 * a second Ptah window is a real writer, so a cache would trade a correctness
 * property (a plugin uninstalled in one window stays resolvable in another) for
 * a few hundred microseconds on a path that already does `readdirSync` per
 * plugin directory. Writes go through the atomic temp-then-rename used
 * everywhere else in `~/.ptah/`.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { injectable } from 'tsyringe';
import { z } from 'zod';
import type { ExternalPluginMcpServer } from '@ptah-extension/shared';
import { externalRootDir, parseExternalPluginId } from './external-plugin-id';

/** File name inside `~/.ptah/plugins/external/`. */
const STATE_FILE_NAME = '.ptah-external.json';

const McpServerRecordSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
  commandLine: z.string(),
});

const StoredMarketplaceSchema = z.object({
  source: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  pluginCount: z.number(),
  addedAt: z.string(),
  lastFetchedAt: z.string().optional(),
});

const InstalledPluginSchema = z.object({
  pluginId: z.string(),
  source: z.string(),
  plugin: z.string(),
  displayName: z.string(),
  version: z.string(),
  installedAt: z.string(),
  /** Token the user's confirmation echoed back. Kept for audit. */
  consentToken: z.string(),
  /** Plugin-relative paths this install wrote, so uninstall removes only them. */
  files: z.array(z.string()),
  skippedBinaryFiles: z.array(z.string()),
  mcpServers: z.array(McpServerRecordSchema),
});

const StateDocSchema = z.object({
  version: z.literal(1),
  marketplaces: z.array(StoredMarketplaceSchema),
  installed: z.array(InstalledPluginSchema),
});

export type StoredMarketplace = z.infer<typeof StoredMarketplaceSchema>;
export type InstalledExternalPlugin = z.infer<typeof InstalledPluginSchema>;
type StateDoc = z.infer<typeof StateDocSchema>;

const EMPTY_STATE: StateDoc = { version: 1, marketplaces: [], installed: [] };

@injectable()
export class ExternalPluginStateStore {
  private pluginsBasePath: string | null = null;

  /** Serializes writes so two concurrent installs cannot clobber each other. */
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * Bind the store to `~/.ptah/plugins`. Until this is called every read
   * returns empty and every write is a no-op, which is what an uninitialized
   * host should see — an empty allowlist, not a permissive one.
   */
  initialize(pluginsBasePath: string): void {
    this.pluginsBasePath = pluginsBasePath;
  }

  /** True once {@link initialize} has been called. */
  get isInitialized(): boolean {
    return this.pluginsBasePath !== null;
  }

  /** Absolute path of the state file, or null when uninitialized. */
  get stateFilePath(): string | null {
    if (!this.pluginsBasePath) return null;
    return path.join(externalRootDir(this.pluginsBasePath), STATE_FILE_NAME);
  }

  /** Registered marketplaces, in registration order. */
  listMarketplaces(): StoredMarketplace[] {
    return this.read().marketplaces;
  }

  /** A registered marketplace by `owner/repo`, or null. */
  findMarketplace(source: string): StoredMarketplace | null {
    return this.read().marketplaces.find((m) => m.source === source) ?? null;
  }

  /** Add or replace a marketplace entry. */
  async upsertMarketplace(entry: StoredMarketplace): Promise<void> {
    await this.mutate((doc) => ({
      ...doc,
      marketplaces: [
        ...doc.marketplaces.filter((m) => m.source !== entry.source),
        entry,
      ],
    }));
  }

  /**
   * Deregister a marketplace. Installed plugins from it keep their consent
   * records: the user authorized those downloads individually, and silently
   * revoking them would make removing a marketplace a destructive act.
   */
  async removeMarketplace(source: string): Promise<boolean> {
    let removed = false;
    await this.mutate((doc) => {
      const next = doc.marketplaces.filter((m) => m.source !== source);
      removed = next.length !== doc.marketplaces.length;
      return { ...doc, marketplaces: next };
    });
    return removed;
  }

  /** Every recorded install. */
  listInstalled(): InstalledExternalPlugin[] {
    return this.read().installed;
  }

  /** The install record for `pluginId`, or null. */
  findInstalled(pluginId: string): InstalledExternalPlugin | null {
    return this.read().installed.find((p) => p.pluginId === pluginId) ?? null;
  }

  /**
   * THE ALLOWLIST CHECK.
   *
   * `PluginLoaderService` calls this to decide whether an external plugin id
   * may be turned into a filesystem path. It answers from the consent record
   * ONLY — it never checks whether the directory exists.
   *
   * That asymmetry is the security property of this feature. If existence on
   * disk were sufficient, then anything that can drop a directory under
   * `~/.ptah/plugins/external/` (a half-finished install, a stray archive
   * extraction, another tool writing to the same home directory) would become
   * loadable plugin code with no user decision behind it. Requiring a record
   * means the only way in is the two-call consent flow in
   * `ExternalPluginInstallerService`.
   *
   * The id is also structurally re-validated, so a malformed or traversing id
   * is rejected even in the impossible case that one was persisted.
   */
  isInstalled(pluginId: string): boolean {
    if (parseExternalPluginId(pluginId) === null) return false;
    return this.read().installed.some((p) => p.pluginId === pluginId);
  }

  /** Record an install, replacing any previous record for the same id. */
  async recordInstall(record: InstalledExternalPlugin): Promise<void> {
    await this.mutate((doc) => ({
      ...doc,
      installed: [
        ...doc.installed.filter((p) => p.pluginId !== record.pluginId),
        record,
      ],
    }));
  }

  /** Drop an install record. Returns false when there was nothing to drop. */
  async removeInstall(pluginId: string): Promise<boolean> {
    let removed = false;
    await this.mutate((doc) => {
      const next = doc.installed.filter((p) => p.pluginId !== pluginId);
      removed = next.length !== doc.installed.length;
      return { ...doc, installed: next };
    });
    return removed;
  }

  /**
   * Read the document from disk.
   *
   * Any failure — missing file, unreadable file, malformed JSON, schema
   * mismatch — yields the EMPTY document. Failing closed is deliberate: a
   * corrupt allowlist must deny everything, never allow everything.
   */
  private read(): StateDoc {
    const filePath = this.stateFilePath;
    if (!filePath) return EMPTY_STATE;

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return EMPTY_STATE;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return EMPTY_STATE;
    }

    const result = StateDocSchema.safeParse(parsedJson);
    return result.success ? result.data : EMPTY_STATE;
  }

  /** Apply `change` to the document and persist it atomically. */
  private async mutate(change: (doc: StateDoc) => StateDoc): Promise<void> {
    const filePath = this.stateFilePath;
    if (!filePath) return;

    const run = async (): Promise<void> => {
      const next = change(this.read());
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await fsPromises.writeFile(
        tmpPath,
        JSON.stringify(next, null, 2),
        'utf-8',
      );
      await fsPromises.rename(tmpPath, filePath);
    };

    // Chain through both settle paths so one failed write does not wedge the
    // queue — the same pattern ContentDownloadService uses for its cache file.
    this.writeChain = this.writeChain.then(run, run);
    await this.writeChain;
  }
}

/** Re-exported for the installer's record construction. */
export type { ExternalPluginMcpServer };

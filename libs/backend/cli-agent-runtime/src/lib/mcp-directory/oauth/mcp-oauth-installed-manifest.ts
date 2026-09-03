/**
 * OAuth-connected MCP server manifest store.
 *
 * Mirrors `SmitheryInstalledManifestStore`: the plaintext manifest
 * (`~/.ptah/mcp-oauth-installed.json`) holds ONLY non-secret metadata
 * (serverKey, name, serverUrl, timestamp). The OAuth tokens live in the
 * encrypted token store (`McpOAuthTokenStore`) under a per-server slot and are
 * never written here.
 *
 * FRESHNESS (TASK_2026_375 B1.1): more than one store instance is alive at a
 * time (the Marketplace RPC handler writes through one, the chat session path
 * reads through another). Every read and every mutation calls `refresh()`
 * first, which re-parses the file when its mtime/size signature changed.
 * Without it a new connection only took effect after an app restart.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  McpOAuthConnectedRecord,
  McpOAuthInstalledManifest,
} from '@ptah-extension/shared';

const MANIFEST_PATH = path.join(
  os.homedir(),
  '.ptah',
  'mcp-oauth-installed.json',
);

function createEmpty(): McpOAuthInstalledManifest {
  return { version: 1, servers: {} };
}

export class McpOAuthInstalledManifestStore {
  private manifest: McpOAuthInstalledManifest;

  /**
   * Signature of the file contents currently held in `manifest`, or null when
   * the file was absent at the last check. Size is part of it because two
   * writes can land inside the same millisecond and mtime alone would miss the
   * second one.
   */
  private loadedSignature: string | null = null;

  constructor(private readonly manifestPath: string = MANIFEST_PATH) {
    this.manifest = createEmpty();
    this.refresh();
  }

  /** Record (or update) a connection. Non-secret metadata only. */
  record(input: { serverKey: string; name: string; serverUrl: string }): void {
    this.refresh();
    const record: McpOAuthConnectedRecord = {
      serverKey: input.serverKey,
      name: input.name,
      serverUrl: input.serverUrl,
      connectedAt: new Date().toISOString(),
    };
    this.manifest.servers[input.serverKey] = record;
    this.save();
  }

  /** Remove a record. No-op if not present. */
  remove(serverKey: string): void {
    this.refresh();
    if (!(serverKey in this.manifest.servers)) return;
    delete this.manifest.servers[serverKey];
    this.save();
  }

  /** True when a record exists for the given key. */
  has(serverKey: string): boolean {
    this.refresh();
    return serverKey in this.manifest.servers;
  }

  /** Read one record, or undefined. */
  get(serverKey: string): McpOAuthConnectedRecord | undefined {
    this.refresh();
    return this.manifest.servers[serverKey];
  }

  /** List all connection records (non-secret metadata only). */
  list(): McpOAuthConnectedRecord[] {
    this.refresh();
    return Object.values(this.manifest.servers);
  }

  /**
   * Re-parse the manifest when the file changed since the copy in memory.
   * Cheap when nothing changed: one `statSync` and a string compare. A missing,
   * unreadable or corrupt file yields an empty manifest and never throws.
   */
  private refresh(): void {
    const signature = statSignature(this.manifestPath);
    if (signature === this.loadedSignature) return;
    this.manifest = this.load();
    this.loadedSignature = signature;
  }

  private load(): McpOAuthInstalledManifest {
    try {
      if (!fs.existsSync(this.manifestPath)) return createEmpty();
      const content = fs.readFileSync(this.manifestPath, 'utf-8');
      const parsed = JSON.parse(content) as McpOAuthInstalledManifest;
      if (parsed.version !== 1 || typeof parsed.servers !== 'object') {
        return createEmpty();
      }
      return parsed;
    } catch {
      return createEmpty();
    }
  }

  private save(): void {
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2) + '\n',
      'utf-8',
    );
    // The in-memory copy IS the file now — adopt the new signature so the next
    // read does not re-parse what this instance just wrote.
    this.loadedSignature = statSignature(this.manifestPath);
  }
}

/**
 * Identity of the manifest file on disk, or null when it is absent or cannot
 * be stat-ed. Used only to decide whether a re-parse is needed.
 */
function statSignature(manifestPath: string): string | null {
  try {
    const stat = fs.statSync(manifestPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * OAuth-connected MCP server manifest store.
 *
 * Mirrors `SmitheryInstalledManifestStore`: the plaintext manifest
 * (`~/.ptah/mcp-oauth-installed.json`) holds ONLY non-secret metadata
 * (serverKey, name, serverUrl, timestamp). The OAuth tokens live in the
 * encrypted token store (`McpOAuthTokenStore`) under a per-server slot and are
 * never written here.
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

  constructor(private readonly manifestPath: string = MANIFEST_PATH) {
    this.manifest = this.load();
  }

  /** Record (or update) a connection. Non-secret metadata only. */
  record(input: { serverKey: string; name: string; serverUrl: string }): void {
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
    if (!(serverKey in this.manifest.servers)) return;
    delete this.manifest.servers[serverKey];
    this.save();
  }

  /** True when a record exists for the given key. */
  has(serverKey: string): boolean {
    return serverKey in this.manifest.servers;
  }

  /** Read one record, or undefined. */
  get(serverKey: string): McpOAuthConnectedRecord | undefined {
    return this.manifest.servers[serverKey];
  }

  /** List all connection records (non-secret metadata only). */
  list(): McpOAuthConnectedRecord[] {
    return Object.values(this.manifest.servers);
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
  }
}

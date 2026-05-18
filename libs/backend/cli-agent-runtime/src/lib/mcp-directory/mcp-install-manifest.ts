/**
 * MCP Install Manifest Tracker
 *
 * Tracks which MCP servers were installed by Ptah for clean uninstall.
 * Persisted to ~/.ptah/mcp-installed.json
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  McpInstallManifest,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';

const MANIFEST_PATH = path.join(os.homedir(), '.ptah', 'mcp-installed.json');

function createEmpty(): McpInstallManifest {
  return { version: 1, servers: {} };
}

export class McpInstallManifestTracker {
  private manifest: McpInstallManifest;

  constructor() {
    this.manifest = this.load();
  }

  /** Record that a server was installed to the given targets */
  recordInstall(
    serverKey: string,
    registryName: string,
    targets: McpInstallTarget[],
    config: McpServerConfig,
  ): void {
    const existing = this.manifest.servers[serverKey];

    if (existing) {
      // Merge targets (avoid duplicates)
      const merged = new Set([...existing.targets, ...targets]);
      this.manifest.servers[serverKey] = {
        ...existing,
        targets: [...merged],
        config,
        installedAt: new Date().toISOString(),
      };
    } else {
      this.manifest.servers[serverKey] = {
        registryName,
        targets: [...targets],
        installedAt: new Date().toISOString(),
        config,
      };
    }

    this.save();
  }

  /** Remove targets from a server entry. If no targets remain, delete the entry. */
  recordUninstall(serverKey: string, targets?: McpInstallTarget[]): void {
    const existing = this.manifest.servers[serverKey];
    if (!existing) return;

    if (!targets || targets.length === 0) {
      delete this.manifest.servers[serverKey];
    } else {
      const remaining = existing.targets.filter((t) => !targets.includes(t));
      if (remaining.length === 0) {
        delete this.manifest.servers[serverKey];
      } else {
        this.manifest.servers[serverKey] = { ...existing, targets: remaining };
      }
    }

    this.save();
  }

  /** Check if a server key was installed by Ptah */
  isManagedByPtah(serverKey: string): boolean {
    return serverKey in this.manifest.servers;
  }

  /** Get all targets a server was installed to */
  getTargetsForServer(serverKey: string): McpInstallTarget[] {
    return this.manifest.servers[serverKey]?.targets ?? [];
  }

  /** Get the full manifest (for listing) */
  getManifest(): McpInstallManifest {
    return this.manifest;
  }

  private load(): McpInstallManifest {
    try {
      if (!fs.existsSync(MANIFEST_PATH)) return createEmpty();
      const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
      const parsed = JSON.parse(content) as McpInstallManifest;
      if (parsed.version !== 1) return createEmpty();
      return parsed;
    } catch {
      return createEmpty();
    }
  }

  private save(): void {
    const dir = path.dirname(MANIFEST_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(this.manifest, null, 2) + '\n',
      'utf-8',
    );
  }
}

/**
 * Smithery Installed Manifest Store
 *
 * Tracks which Smithery MCP servers were installed by Ptah so the chat query
 * path can rebuild a fresh, secret-bearing connection URL at session time
 * (see `SmitheryOverrideResolver`).
 *
 * SECURITY (the crux of TASK_2026_131 §1.7):
 * - The plaintext manifest (`~/.ptah/smithery-installed.json`) holds ONLY
 *   non-secret metadata: source, qualifiedName, serverKey, profile, timestamps.
 * - The per-server `config` (which may carry credentials) is NEVER written to
 *   this file. It is JSON-serialized and stored in the encrypted secret store
 *   under a per-record slot via the injected `SmitheryConfigSecretStore`.
 * - No resolved secret-bearing URL is ever persisted to any disk config file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  SmitheryInstalledManifest,
  SmitheryInstalledRecord,
} from '@ptah-extension/shared';

const MANIFEST_PATH = path.join(
  os.homedir(),
  '.ptah',
  'smithery-installed.json',
);

/** Prefix for the per-record encrypted config slot id. */
export const SMITHERY_CONFIG_SECRET_PREFIX = 'smithery.config.';

/**
 * Minimal encrypted-store surface for per-server Smithery config blobs. Backed
 * by `IAuthSecretsService` provider-key slots in production (each slot is an
 * isolated, encrypted entry). Kept as a narrow port so the manifest store is
 * unit-testable without the full secrets service.
 */
export interface SmitheryConfigSecretStore {
  /** Persist the JSON-serialized config under a per-server slot. */
  setConfig(serverKey: string, configJson: string): Promise<void>;
  /** Read the JSON-serialized config, or null when absent. */
  getConfig(serverKey: string): Promise<string | null>;
  /** Remove the per-server config slot. */
  deleteConfig(serverKey: string): Promise<void>;
}

export interface SmitheryInstallInput {
  qualifiedName: string;
  serverKey: string;
  config: Record<string, unknown>;
  profile?: string;
}

function createEmpty(): SmitheryInstalledManifest {
  return { version: 1, servers: {} };
}

/** Default config-secret store backed by `IAuthSecretsService`-style slots. */
export function createSmitheryConfigSecretStore(secrets: {
  getProviderKey(id: string): Promise<string | undefined>;
  setProviderKey(id: string, value: string): Promise<void>;
  deleteProviderKey(id: string): Promise<void>;
}): SmitheryConfigSecretStore {
  const slot = (serverKey: string) =>
    `${SMITHERY_CONFIG_SECRET_PREFIX}${serverKey}`;
  return {
    async setConfig(serverKey, configJson) {
      await secrets.setProviderKey(slot(serverKey), configJson);
    },
    async getConfig(serverKey) {
      return (await secrets.getProviderKey(slot(serverKey))) ?? null;
    },
    async deleteConfig(serverKey) {
      await secrets.deleteProviderKey(slot(serverKey));
    },
  };
}

export class SmitheryInstalledManifestStore {
  private manifest: SmitheryInstalledManifest;

  constructor(
    private readonly secretStore: SmitheryConfigSecretStore,
    private readonly manifestPath: string = MANIFEST_PATH,
  ) {
    this.manifest = this.load();
  }

  /**
   * Record (or update) a Smithery install. Writes the secret-bearing config to
   * the encrypted store and only non-secret metadata to the plaintext manifest.
   */
  async install(input: SmitheryInstallInput): Promise<void> {
    const hasConfig = Object.keys(input.config).length > 0;

    if (hasConfig) {
      await this.secretStore.setConfig(
        input.serverKey,
        JSON.stringify(input.config),
      );
    } else {
      await this.secretStore.deleteConfig(input.serverKey);
    }

    const record: SmitheryInstalledRecord = {
      source: 'smithery',
      qualifiedName: input.qualifiedName,
      serverKey: input.serverKey,
      profile: input.profile,
      hasEncryptedConfig: hasConfig,
      installedAt: new Date().toISOString(),
    };

    this.manifest.servers[input.serverKey] = record;
    this.save();
  }

  /** Remove a record and its encrypted config slot. No-op if not present. */
  async uninstall(serverKey: string): Promise<void> {
    if (!(serverKey in this.manifest.servers)) return;
    delete this.manifest.servers[serverKey];
    this.save();
    await this.secretStore.deleteConfig(serverKey);
  }

  /** List all installed records (non-secret metadata only). */
  list(): SmitheryInstalledRecord[] {
    return Object.values(this.manifest.servers);
  }

  /**
   * Read the decrypted per-server config for a record. Returns an empty object
   * when the record has no encrypted config. Used by `SmitheryOverrideResolver`
   * at query time.
   */
  async getConfig(serverKey: string): Promise<Record<string, unknown>> {
    const record = this.manifest.servers[serverKey];
    if (!record || !record.hasEncryptedConfig) return {};
    const raw = await this.secretStore.getConfig(serverKey);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private load(): SmitheryInstalledManifest {
    try {
      if (!fs.existsSync(this.manifestPath)) return createEmpty();
      const content = fs.readFileSync(this.manifestPath, 'utf-8');
      const parsed = JSON.parse(content) as SmitheryInstalledManifest;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

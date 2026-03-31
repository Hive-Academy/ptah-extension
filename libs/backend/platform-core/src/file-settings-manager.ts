/**
 * PtahFileSettingsManager — File-based settings storage for ~/.ptah/settings.json.
 *
 * Manages settings that cannot live in VS Code's package.json contributes.configuration
 * because the marketplace scanner flags trademarked terms ("copilot", "codex", "claude", "gpt")
 * as "suspicious content".
 *
 * Internal storage uses FLAT dot-notation keys (e.g., "provider.github-copilot.clientId")
 * matching the existing getConfiguration('ptah', 'provider.github-copilot.clientId') call pattern.
 * The on-disk JSON format uses nested objects for human readability; flatten/unflatten
 * conversion happens only during file serialization/deserialization.
 *
 * Pattern: Modeled after ElectronWorkspaceProvider's loadConfigSync + persistConfig pattern.
 * Platform-agnostic: NO vscode imports. Usable from both VS Code and Electron contexts.
 *
 * TASK_2025_247 Batch 2, Task 2.1
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface FileSettingsDefaults {
  [key: string]: unknown;
}

export class PtahFileSettingsManager {
  /** In-memory cache using flat dot-notation keys */
  private settings: Record<string, unknown> = {};
  private readonly filePath: string;
  private readonly dirPath: string;
  private readonly defaults: FileSettingsDefaults;

  constructor(defaults: FileSettingsDefaults) {
    this.dirPath = path.join(homedir(), '.ptah');
    this.filePath = path.join(this.dirPath, 'settings.json');
    this.defaults = defaults;
    this.loadSync();
  }

  /**
   * Get a setting value.
   *
   * Lookup order:
   * 1. In-memory cache (user-set values)
   * 2. Caller-provided defaultValue
   * 3. Constructor-provided defaults (from FILE_BASED_SETTINGS_DEFAULTS)
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.settings[key];
    if (value !== undefined) return value as T;
    if (defaultValue !== undefined) return defaultValue;
    const registeredDefault = this.defaults[key];
    return registeredDefault !== undefined
      ? (registeredDefault as T)
      : undefined;
  }

  /**
   * Set a setting value. Updates in-memory cache and persists to disk atomically.
   */
  async set(key: string, value: unknown): Promise<void> {
    this.settings[key] = value;
    await this.persist();
  }

  /**
   * Get the file path for external access (e.g., migration logic).
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Synchronously load settings from disk on construction.
   * Handles first-run gracefully (file/directory don't exist).
   * Handles corrupted JSON gracefully (logs warning, starts with empty settings).
   */
  loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Flatten the nested JSON structure to dot-notation keys
      this.settings = flattenObject(parsed);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        // File doesn't exist on first launch — start with empty settings
        this.settings = {};
        return;
      }
      // JSON parse error or other read error — log warning, start fresh
      console.warn(
        `[PtahFileSettingsManager] Failed to load settings from ${this.filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      this.settings = {};
    }
  }

  /**
   * Persist settings to disk using atomic write (temp file + rename).
   * Creates ~/.ptah/ directory if it doesn't exist.
   * Unflattens dot-notation keys to nested JSON for human readability.
   */
  private async persist(): Promise<void> {
    // Ensure directory exists
    await fsPromises.mkdir(this.dirPath, { recursive: true });

    // Build the nested object from flat keys, including schema and version metadata
    const nested = unflattenObject(this.settings);
    const output = {
      $schema: 'https://ptah.live/schemas/settings.json',
      version: 1,
      ...nested,
    };

    const json = JSON.stringify(output, null, 2);
    const tmpPath = this.filePath + '.tmp';

    // Atomic write: write to temp file, then rename
    await fsPromises.writeFile(tmpPath, json, 'utf-8');
    await fsPromises.rename(tmpPath, this.filePath);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers: flatten / unflatten
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into dot-notation keys.
 *
 * Example:
 *   { provider: { "github-copilot": { clientId: "abc" } } }
 *   => { "provider.github-copilot.clientId": "abc" }
 *
 * Skips metadata keys ($schema, version) that are not settings.
 * Leaf values (primitives, arrays, null) are kept as-is; only plain objects are recursed.
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip file metadata keys — not actual settings
    if (prefix === '' && (key === '$schema' || key === 'version')) {
      continue;
    }

    const flatKey = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, flatKey),
      );
    } else {
      // Leaf value: primitive, array, or null
      result[flatKey] = value;
    }
  }

  return result;
}

/**
 * Unflatten dot-notation keys back into a nested object.
 *
 * Example:
 *   { "provider.github-copilot.clientId": "abc" }
 *   => { provider: { "github-copilot": { clientId: "abc" } } }
 */
function unflattenObject(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [flatKey, value] of Object.entries(flat)) {
    const parts = splitDotKey(flatKey);
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || !isPlainObject(current[part])) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return result;
}

/**
 * Split a dot-notation key into path segments.
 *
 * This is straightforward: split on '.' characters. Keys like
 * "provider.github-copilot.modelTier.opus" split into
 * ["provider", "github-copilot", "modelTier", "opus"].
 *
 * Hyphens within segments (like "github-copilot") are NOT split points.
 */
function splitDotKey(key: string): string[] {
  return key.split('.');
}

/**
 * Check if a value is a plain object (not array, not null, not Date, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Type guard for Node.js error with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

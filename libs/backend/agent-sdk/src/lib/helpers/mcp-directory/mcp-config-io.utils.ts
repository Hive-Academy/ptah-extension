/**
 * MCP Config File I/O Utilities
 *
 * Shared helpers for reading, merging, and writing MCP server configs.
 * Handles atomic writes with .bak backup, JSON parsing, and key merging.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  McpServerConfig,
  InstalledMcpServer,
  McpInstallTarget,
  McpInstallResult,
} from '@ptah-extension/shared';

/**
 * Safely read and parse a JSON config file.
 * Returns an empty object if file doesn't exist or is invalid JSON.
 */
export function readJsonConfig(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Write a JSON config file atomically with backup.
 * Creates parent directories if needed. Creates a .bak backup of the existing file.
 */
export function writeJsonConfig(
  filePath: string,
  config: Record<string, unknown>,
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Backup existing file
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + '.bak');
  }

  // Write atomically via temp file + rename
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Get or create the servers object from a config, using the correct root key.
 */
export function getServersObject(
  config: Record<string, unknown>,
  rootKey: string,
): Record<string, unknown> {
  const existing = config[rootKey];
  if (typeof existing === 'object' && existing !== null) {
    return existing as Record<string, unknown>;
  }
  return {};
}

/**
 * Convert an McpServerConfig to the JSON shape expected by a config file.
 * Strips the discriminant `type` field for targets that don't use it,
 * and reshapes based on transport type.
 */
export function configToJson(
  config: McpServerConfig,
  includeType: boolean,
): Record<string, unknown> {
  const json: Record<string, unknown> = {};

  if (includeType) {
    json['type'] = config.type;
  }

  switch (config.type) {
    case 'stdio':
      json['command'] = config.command;
      if (config.args?.length) json['args'] = config.args;
      break;
    case 'http':
      json['url'] = config.url;
      if (config.headers && Object.keys(config.headers).length > 0) {
        json['headers'] = config.headers;
      }
      break;
    case 'sse':
      json['url'] = config.url;
      if (config.headers && Object.keys(config.headers).length > 0) {
        json['headers'] = config.headers;
      }
      break;
  }

  if (config.env && Object.keys(config.env).length > 0) {
    json['env'] = config.env;
  }

  return json;
}

/**
 * Parse a raw JSON server entry back to McpServerConfig.
 */
export function jsonToConfig(raw: Record<string, unknown>): McpServerConfig {
  const type = (raw['type'] as string) ?? inferTransportType(raw);
  const env = (raw['env'] as Record<string, string>) ?? undefined;

  if (type === 'stdio') {
    return {
      type: 'stdio',
      command: (raw['command'] as string) ?? '',
      args: (raw['args'] as string[]) ?? undefined,
      env,
    };
  }

  if (type === 'sse') {
    return {
      type: 'sse',
      url: (raw['url'] as string) ?? '',
      headers: (raw['headers'] as Record<string, string>) ?? undefined,
      env,
    };
  }

  // Default to http
  return {
    type: 'http',
    url: (raw['url'] as string) ?? '',
    headers: (raw['headers'] as Record<string, string>) ?? undefined,
    env,
  };
}

/**
 * Infer transport type from raw JSON if `type` is not explicitly set.
 */
function inferTransportType(raw: Record<string, unknown>): string {
  if (typeof raw['command'] === 'string') return 'stdio';
  if (typeof raw['url'] === 'string') {
    const url = raw['url'] as string;
    if (url.includes('/sse')) return 'sse';
    return 'http';
  }
  return 'http';
}

/**
 * Generic install implementation used by all installers.
 */
export function installServer(
  target: McpInstallTarget,
  configPath: string,
  rootKey: string,
  serverKey: string,
  config: McpServerConfig,
  includeTypeField: boolean,
): McpInstallResult {
  try {
    const fileConfig = readJsonConfig(configPath);
    const servers = getServersObject(fileConfig, rootKey);
    servers[serverKey] = configToJson(config, includeTypeField);
    fileConfig[rootKey] = servers;
    writeJsonConfig(configPath, fileConfig);

    return { target, success: true, configPath };
  } catch (error) {
    return {
      target,
      success: false,
      configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generic uninstall implementation used by all installers.
 */
export function uninstallServer(
  target: McpInstallTarget,
  configPath: string,
  rootKey: string,
  serverKey: string,
): McpInstallResult {
  try {
    const fileConfig = readJsonConfig(configPath);
    const servers = getServersObject(fileConfig, rootKey);

    if (!(serverKey in servers)) {
      return { target, success: true, configPath };
    }

    delete servers[serverKey];
    fileConfig[rootKey] = servers;
    writeJsonConfig(configPath, fileConfig);

    return { target, success: true, configPath };
  } catch (error) {
    return {
      target,
      success: false,
      configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generic listInstalled implementation used by all installers.
 */
export function listInstalledServers(
  target: McpInstallTarget,
  configPath: string,
  rootKey: string,
): InstalledMcpServer[] {
  const fileConfig = readJsonConfig(configPath);
  const servers = getServersObject(fileConfig, rootKey);
  const result: InstalledMcpServer[] = [];

  for (const [key, value] of Object.entries(servers)) {
    if (typeof value !== 'object' || value === null) continue;

    result.push({
      serverKey: key,
      target,
      configPath,
      config: jsonToConfig(value as Record<string, unknown>),
      managedByPtah: false, // Will be enriched by the install service from manifest
    });
  }

  return result;
}

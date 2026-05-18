/**
 * Copilot File Auth - Cross-platform GitHub token reading
 *
 * Reads GitHub OAuth tokens from the standard Copilot config locations:
 * - Linux/macOS: ~/.config/github-copilot/hosts.json
 * - Windows: %LOCALAPPDATA%/github-copilot/hosts.json
 * - XDG override: $XDG_CONFIG_HOME/github-copilot/hosts.json
 *
 * File format:
 * {
 *   "github.com": {
 *     "oauth_token": "gho_xxxxxxxxxxxx"
 *   }
 * }
 *
 * Pattern source: CodexAuthService reads ~/.codex/auth.json (codex-auth.service.ts)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** Shape of the github-copilot/hosts.json file */
export interface CopilotHostsFile {
  [host: string]: {
    oauth_token?: string;
    [key: string]: unknown;
  };
}

/**
 * Get the Copilot config directory path.
 * Checks environment variables first, then platform defaults.
 */
function getCopilotConfigDir(): string {
  // XDG_CONFIG_HOME takes priority (standard on Linux)
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) {
    return join(xdg, 'github-copilot');
  }

  // Windows: %LOCALAPPDATA%/github-copilot
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
      return join(localAppData, 'github-copilot');
    }
  }

  // Linux/macOS default: ~/.config/github-copilot
  return join(homedir(), '.config', 'github-copilot');
}

/**
 * Get the path to the Copilot hosts.json file.
 * Checks environment variables first, then platform defaults.
 */
export function getCopilotHostsPath(): string {
  return join(getCopilotConfigDir(), 'hosts.json');
}

/**
 * Get the path to the Copilot apps.json file.
 * Same directory as hosts.json, used by Copilot CLI for gho_ tokens.
 */
export function getCopilotAppsPath(): string {
  return join(getCopilotConfigDir(), 'apps.json');
}

/**
 * Read a GitHub OAuth token from a Copilot config file (hosts.json or apps.json).
 * Returns null if file doesn't exist or contains no valid token.
 *
 * @param filePath - Absolute path to the JSON config file
 */
async function readTokenFromFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as CopilotHostsFile;

    // Check github.com entry first (exact match for hosts.json)
    const githubHost = data['github.com'];
    if (githubHost?.oauth_token) {
      return githubHost.oauth_token;
    }

    // Check any key with an oauth_token (handles GHES in hosts.json,
    // and "github.com:app_id" keys in apps.json)
    for (const entry of Object.values(data)) {
      if (entry?.oauth_token) {
        return entry.oauth_token;
      }
    }

    return null;
  } catch {
    // File not found or unreadable
    return null;
  }
}

/**
 * Read the GitHub OAuth token from the Copilot config files.
 *
 * Checks in order:
 * 1. hosts.json - Written by GitHub Copilot extensions and device code flow
 * 2. apps.json  - Written by Copilot CLI (keys have format "github.com:app_id")
 *
 * Returns null if neither file exists or contains a valid token.
 */
export async function readCopilotToken(): Promise<string | null> {
  // Check hosts.json first (primary location)
  const hostsToken = await readTokenFromFile(getCopilotHostsPath());
  if (hostsToken) {
    return hostsToken;
  }

  // Fall back to apps.json (Copilot CLI uses this with gho_ tokens)
  return readTokenFromFile(getCopilotAppsPath());
}

/**
 * Write a GitHub OAuth token to the Copilot hosts.json file.
 *
 * Persists the token so Electron users don't need to re-authenticate
 * on every app restart. Creates the config directory if it doesn't exist.
 *
 * Errors are silently caught — token persistence failure should never
 * break the authentication flow.
 *
 * @param token - GitHub OAuth access token to persist
 */
export async function writeCopilotToken(token: string): Promise<void> {
  try {
    const hostsPath = getCopilotHostsPath();

    // Ensure the config directory exists
    await mkdir(dirname(hostsPath), { recursive: true });

    // Read existing file content or start with empty object
    let hosts: CopilotHostsFile = {};
    try {
      const raw = await readFile(hostsPath, 'utf-8');
      hosts = JSON.parse(raw) as CopilotHostsFile;
    } catch {
      // File doesn't exist or is unreadable — start fresh
    }

    // Set the github.com token, preserving any other host entries
    hosts['github.com'] = {
      ...hosts['github.com'],
      oauth_token: token,
    };

    await writeFile(hostsPath, JSON.stringify(hosts, null, 2), 'utf-8');
  } catch {
    // Token persistence is best-effort — never break the auth flow
  }
}

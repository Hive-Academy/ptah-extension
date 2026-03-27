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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Shape of the github-copilot/hosts.json file */
export interface CopilotHostsFile {
  [host: string]: {
    oauth_token?: string;
    [key: string]: unknown;
  };
}

/**
 * Get the path to the Copilot hosts.json file.
 * Checks environment variables first, then platform defaults.
 */
export function getCopilotHostsPath(): string {
  // XDG_CONFIG_HOME takes priority (standard on Linux)
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) {
    return join(xdg, 'github-copilot', 'hosts.json');
  }

  // Windows: %LOCALAPPDATA%/github-copilot/hosts.json
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
      return join(localAppData, 'github-copilot', 'hosts.json');
    }
  }

  // Linux/macOS default: ~/.config/github-copilot/hosts.json
  return join(homedir(), '.config', 'github-copilot', 'hosts.json');
}

/**
 * Read the GitHub OAuth token from the Copilot hosts file.
 * Returns null if file doesn't exist or contains no valid token.
 */
export async function readCopilotToken(): Promise<string | null> {
  try {
    const hostsPath = getCopilotHostsPath();
    const raw = await readFile(hostsPath, 'utf-8');
    const hosts = JSON.parse(raw) as CopilotHostsFile;

    // Check github.com entry first
    const githubHost = hosts['github.com'];
    if (githubHost?.oauth_token) {
      return githubHost.oauth_token;
    }

    // Check any host with an oauth_token (for GHES instances)
    for (const host of Object.values(hosts)) {
      if (host?.oauth_token) {
        return host.oauth_token;
      }
    }

    return null;
  } catch {
    // File not found or unreadable
    return null;
  }
}

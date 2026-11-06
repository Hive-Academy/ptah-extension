import { z } from 'zod';
import type { IMcpCallerCredentials } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

export const LANE_MCP_TTL_MS = 4 * 60 * 60 * 1000;

/** Lane-report credentials may briefly live in Antigravity's spawn config. */
export function issueLaneMcpToken(
  credentials: IMcpCallerCredentials | undefined,
  logger: Logger,
  agentId: string | undefined,
  workingDirectory: string,
  capability: 'privileged' | 'lane-report' = 'privileged',
): string | undefined {
  if (!credentials || !agentId || !workingDirectory) {
    logger.warn('[Lane MCP] Credentials unavailable; omitting ptah MCP server');
    return undefined;
  }
  try {
    return z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(
        credentials.issue(
          {
            kind: 'agent',
            agentId,
            workspaceRoot: workingDirectory,
            capability,
          },
          agentId,
          LANE_MCP_TTL_MS,
        ),
      );
  } catch {
    logger.warn(
      '[Lane MCP] Credential issuance failed; omitting ptah MCP server',
    );
    return undefined;
  }
}

export function laneMcpAuthUrl(url: string, token: string): string {
  const target = new URL(url);
  return `${target.origin}/auth/${token}${target.pathname}`;
}

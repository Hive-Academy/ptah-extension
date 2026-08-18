/**
 * Ptah CLI Registry - Pure utility functions and constants
 *
 * No DI dependencies. Extracted from PtahCliRegistry for reuse
 * across helper services.
 *
 */

import { randomUUID } from 'node:crypto';

/**
 * Secret key prefix for Ptah CLI API keys.
 * Full key format: `ptahCli.{agentId}`
 */
export const PTAH_CLI_KEY_PREFIX = 'ptahCli';

/**
 * Config key for Ptah CLI configurations in ConfigManager
 */
export const PTAH_CLI_AGENTS_CONFIG_KEY = 'ptahCliAgents';

/**
 * Generate a cryptographically random ID for new Ptah CLI instances.
 * Uses crypto.randomUUID() for unpredictable identifiers with `pc-` prefix
 * for visual identification as a Ptah CLI ID.
 */
export function generateAgentId(): string {
  return `pc-${randomUUID()}`;
}

/**
 * Collapse a blank session id to `undefined`.
 *
 * `''` is a third state nothing in the session model intends:
 * `AgentProcessInfo.parentSessionId` is optional (absent = `undefined`) and the
 * branded `SessionId` requires a UUID. An empty string survives `??` chains, so
 * a caller that passes `parentSessionId: ''` silently defeats every
 * `a ?? b ?? fallback` default downstream. Normalise at the boundary instead of
 * teaching each consumer a second spelling of "absent".
 */
export function blankToUndefined(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Summarize tool input for display in structured segments.
 *
 * Extracts the most useful field from the tool input object
 * (e.g., file_path for file tools, command for shell tools)
 * and truncates to a readable length.
 *
 * @param input - Raw tool input from SDK ToolUseBlock
 * @returns Human-readable summary string, or undefined if empty
 */
export function summarizeToolInput(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input || Object.keys(input).length === 0) return undefined;

  const displayField =
    input['file_path'] ??
    input['command'] ??
    input['path'] ??
    input['query'] ??
    input['pattern'] ??
    input['url'];

  if (typeof displayField === 'string') {
    const truncated =
      displayField.length > 120
        ? displayField.substring(0, 117) + '...'
        : displayField;
    return truncated;
  }

  try {
    const str = JSON.stringify(input);
    return str.length > 150 ? str.substring(0, 147) + '...' : str;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize error messages before forwarding to output callbacks or users.
 *
 * Third-party API error messages may contain sensitive information such as
 * API keys, account IDs, internal URLs, or stack traces. This method strips
 * those patterns while preserving the actionable error description.
 *
 * @param message - Raw error message from provider
 * @returns Sanitized message safe for user-facing output
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  sanitized = sanitized.replace(
    /\b(sk-|key-|token-)[A-Za-z0-9_-]{20,}\b/g,
    '[REDACTED]',
  );
  sanitized = sanitized.replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[REDACTED]');
  sanitized = sanitized.replace(
    /https?:\/\/[^\s]*[:@][^\s]*/g,
    '[REDACTED_URL]',
  );
  sanitized = sanitized.replace(/^\s*at\s+.+$/gm, '').replace(/\n{2,}/g, '\n');
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 497) + '...';
  }
  return sanitized.trim();
}

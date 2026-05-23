/**
 * Pure builder for the `session.describe` introspection response.
 *
 * Used by both `ptah interact` and `ptah mcp-serve` to advertise their live
 * wire surface to external hosts. No DI, no IO — safe to call from any
 * dispatch site and easy to unit-test in isolation.
 *
 * The MCP tool catalog is sourced from `@ptah-extension/vscode-lm-tools`
 * (`MCP_MVP_TOOL_NAMES` / `buildMcpMvpTools`). The wire method list is
 * captured at the call site from `JsonRpcServer.getRegisteredMethods()` so
 * the introspection always reflects the live handler table — there is no
 * second compile-time enum to keep in sync.
 */

import type {
  SessionDescribeResult,
  SessionDescribeToolEntry,
} from '@ptah-extension/shared';

import { PTAH_ERROR_CODES } from '../jsonrpc/types.js';

/** Capabilities advertised by `session.ready` in `ptah interact`. */
export const INTERACT_CAPABILITIES = [
  'chat',
  'session',
  'permission',
  'question',
] as const;

/** Capabilities advertised by `notifications/initialized` in `ptah mcp-serve`. */
export const MCP_SERVE_CAPABILITIES = ['mcp'] as const;

/** Input contract for {@link buildSessionDescribe}. */
export interface BuildSessionDescribeInput {
  /** Active subcommand mode. */
  readonly mode: 'interact' | 'mcp-serve';
  /** CLI version (matches `apps/ptah-cli/package.json` `version`). */
  readonly version: string;
  /** Ptah JSON-RPC schema version (matches `JSONRPC_SCHEMA_VERSION`). */
  readonly schemaVersion: string;
  /** Snapshot of `JsonRpcServer.getRegisteredMethods()`. */
  readonly methods: readonly string[];
  /** MCP tool catalog — empty in `interact`, 7 MVP entries in `mcp-serve`. */
  readonly mcpTools?: readonly SessionDescribeToolEntry[];
  /**
   * Capabilities the matching `session.ready` advertised. Defaults to the
   * mode-appropriate value when omitted.
   */
  readonly capabilities?: readonly string[];
}

/**
 * Assemble the `session.describe` response payload.
 *
 * Mode-specific defaults:
 *   - `interact` → `capabilities = ['chat','session','permission','question']`,
 *     `tools = []` (the interact surface has no MCP-style tool catalog).
 *   - `mcp-serve` → `capabilities = ['mcp']`, `tools = mcpTools ?? []`.
 *
 * `errorCodes` always enumerates the full `PTAH_ERROR_CODES` tuple — the
 * server may surface any of those codes regardless of mode.
 */
export function buildSessionDescribe(
  input: BuildSessionDescribeInput,
): SessionDescribeResult {
  const tools = input.mode === 'mcp-serve' ? (input.mcpTools ?? []) : [];
  const defaultCapabilities =
    input.mode === 'interact'
      ? (INTERACT_CAPABILITIES as readonly string[])
      : (MCP_SERVE_CAPABILITIES as readonly string[]);

  return {
    serverName: 'ptah',
    version: input.version,
    schemaVersion: input.schemaVersion,
    mode: input.mode,
    catalog: {
      methods: input.methods,
      tools,
    },
    errorCodes: PTAH_ERROR_CODES as readonly string[],
    capabilities: input.capabilities ?? defaultCapabilities,
  };
}

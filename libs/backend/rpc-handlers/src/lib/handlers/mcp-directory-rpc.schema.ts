/**
 * Zod schemas for {@link McpDirectoryRpcHandlers}.
 *
 * These validate secret-bearing boundary inputs (the Smithery API key) before
 * the handler touches secure storage. The schema lives here so it can be unit
 * tested independently of the handler surface.
 */

import { z } from 'zod';
import { NON_AUTH_PROVIDER_KEY_SLOT_IDS } from '@ptah-extension/platform-core';

/**
 * Validated shape for the `mcpDirectory:setSmitheryApiKey` RPC method.
 *
 * `apiKey` is a raw secret routed to encrypted storage. An empty / whitespace
 * value is a sentinel meaning "clear the stored key" (handled by the caller).
 */
export const SetSmitheryApiKeySchema = z.object({
  apiKey: z.string(),
});

export type SetSmitheryApiKeyInput = z.infer<typeof SetSmitheryApiKeySchema>;

/**
 * Validated shape for the `mcpDirectory:resolveSmithery` RPC method.
 *
 * `config` is collected from the connection configSchema form; the API key is
 * NOT part of this boundary (read backend-side at resolve time).
 */
export const ResolveSmitherySchema = z.object({
  qualifiedName: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  profile: z.string().optional(),
});

export type ResolveSmitheryInput = z.infer<typeof ResolveSmitherySchema>;

/**
 * Validated shape for the `mcpDirectory:installSmithery` RPC method.
 *
 * Records a Smithery install. `config` may carry per-server secrets — it is
 * routed to the encrypted secret store, never to the plaintext manifest.
 */
export const InstallSmitherySchema = z.object({
  qualifiedName: z.string().min(1),
  serverKey: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()),
  profile: z.string().optional(),
});

export type InstallSmitheryInput = z.infer<typeof InstallSmitherySchema>;

/** Every MCP install target, as `McpInstallTarget` spells it. */
const McpInstallTargetSchema = z.enum([
  'vscode',
  'claude',
  'cursor',
  'copilot',
  'codex',
  'antigravity',
  'opencode',
]);

/** The home-folder targets (`McpHomeInstallTarget`); only a global install may name them. */
const McpHomeInstallTargetSchema = z.enum(['codex', 'copilot', 'antigravity']);

const McpEnvSchema = z.record(z.string(), z.string()).optional();
const McpHeadersSchema = z.record(z.string(), z.string()).optional();

/** `McpServerConfig`: one of the three transports. */
const McpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: McpEnvSchema,
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().min(1),
    headers: McpHeadersSchema,
    env: McpEnvSchema,
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().min(1),
    headers: McpHeadersSchema,
    env: McpEnvSchema,
  }),
]);

/**
 * Validated shape for the `mcpDirectory:install` RPC method.
 *
 * `scope` DEFAULTS TO `'workspace'`: an install applies to the open workspace
 * only unless the caller explicitly asks for every workspace. Which targets a
 * workspace install may name is checked by the handler, before any write.
 */
export const InstallMcpSchema = z.object({
  serverName: z.string().min(1),
  serverKey: z.string().min(1),
  config: McpServerConfigSchema,
  targets: z.array(McpInstallTargetSchema).min(1),
  scope: z.enum(['workspace', 'global']).optional().default('workspace'),
});

export type InstallMcpInput = z.infer<typeof InstallMcpSchema>;

/**
 * Validated shape for the `mcpDirectory:makeGlobal` RPC method. `homeTargets`
 * is the opt-in list of home-folder files to add; `[]` adds none.
 */
export const MakeMcpGlobalSchema = z.object({
  serverKey: z.string().min(1),
  homeTargets: z.array(McpHomeInstallTargetSchema),
});

export type MakeMcpGlobalInput = z.infer<typeof MakeMcpGlobalSchema>;

/** Fixed refusal for an install request whose fields do not validate. */
export const MCP_INSTALL_INVALID_ERROR =
  'This install request is not valid. Nothing was installed.';

/** Fixed refusal for a workspace install with no folder open (D-4, AC4). */
export const MCP_NO_WORKSPACE_ERROR =
  'No workspace is open. Nothing was installed. Choose All workspaces to install for every workspace.';

/**
 * Fixed refusal for a workspace install that names a home-folder target
 * (D-4, AC6). Copy from the design spec's workspace-scope MCP helper.
 */
export const MCP_HOME_TARGET_NEEDS_GLOBAL_ERROR =
  'This workspace writes only project files. Tools that keep settings in your home folder need All workspaces.';

/** Fixed copy for every `mcpDirectory:makeGlobal` failure (design spec). */
export function mcpMakeGlobalFailureCopy(serverKey: string): string {
  return `Could not change where ${serverKey} is installed.`;
}

/**
 * Validated shape for the `mcpDirectory:uninstall` RPC method.
 *
 * `force` is the only field that can delete something Ptah did not write, so it
 * is validated rather than read off an untyped payload, and it DEFAULTS TO
 * FALSE — a caller that omits it gets the ordinary reconcile-based uninstall,
 * which leaves a user-owned key alone.
 */
export const UninstallMcpSchema = z.object({
  serverKey: z.string().min(1),
  targets: z.array(McpInstallTargetSchema).optional(),
  force: z.boolean().optional().default(false),
});

export type UninstallMcpInput = z.infer<typeof UninstallMcpSchema>;

/** Validated shape for the `mcpDirectory:uninstallSmithery` RPC method. */
export const UninstallSmitherySchema = z.object({
  serverKey: z.string().min(1),
});

export type UninstallSmitheryInput = z.infer<typeof UninstallSmitherySchema>;

/**
 * Derive a stable, filesystem/URL-safe serverKey from a qualified name when the
 * caller does not supply one (e.g. "@owner/server" → "smithery_owner_server").
 */
export function deriveSmitheryServerKey(qualifiedName: string): string {
  const slug = qualifiedName
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `smithery_${slug || 'server'}`;
}

/**
 * Validated shape for `mcpDirectory:smitheryConnectionStatus` and
 * `mcpDirectory:openSmitherySetup`. Both address a Ptah install record, so
 * both take the same `serverKey`.
 */
export const SmitheryServerKeySchema = z.object({
  serverKey: z.string().min(1),
});

export type SmitheryServerKeyInput = z.infer<typeof SmitheryServerKeySchema>;

/**
 * Derive the Smithery CONNECTION id from a Ptah serverKey.
 *
 * A connection id lives in a URL path inside a namespace, so it is stricter
 * than a serverKey: the `smithery_` prefix is dropped (the namespace already
 * says these are Smithery connections) and every character outside
 * `[a-z0-9-]` becomes `-`. Leading and trailing dashes are trimmed because a
 * path segment must not start or end with one; an id that trims to nothing
 * falls back to `server`.
 *
 * Example: `smithery_owner_server` → `owner-server`.
 */
export function deriveSmitheryConnectionId(serverKey: string): string {
  const trimmed = serverKey
    .toLowerCase()
    .replace(/^smithery_/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return trimmed || 'server';
}

/**
 * Validated shape for the `mcpDirectory:connectOAuth` RPC method.
 *
 * `serverUrl` is the remote MCP server the user wants to connect via OAuth. The
 * flow itself acquires and stores the tokens backend-side — no secret crosses
 * this boundary.
 */
export const ConnectOAuthSchema = z.object({
  serverUrl: z.string().url(),
  name: z.string().min(1).optional(),
  serverKey: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  // Pre-registered client credentials for auth servers without DCR. Secret is
  // used only in-memory during the flow and stored in the encrypted token record.
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

export type ConnectOAuthInput = z.infer<typeof ConnectOAuthSchema>;

/**
 * Validated shape for the `mcpDirectory:probeOAuthDiscovery` RPC method.
 *
 * Same `serverUrl` rule as {@link ConnectOAuthSchema} — the probe hits the same
 * server, so a URL the probe accepts is a URL connect would accept.
 */
export const ProbeOAuthDiscoverySchema = ConnectOAuthSchema.pick({
  serverUrl: true,
});

export type ProbeOAuthDiscoveryInput = z.infer<
  typeof ProbeOAuthDiscoverySchema
>;

/** Validated shape for the `mcpDirectory:oauthStatus` RPC method. */
export const OAuthStatusSchema = z.object({
  serverKey: z.string().min(1),
});

export type OAuthStatusInput = z.infer<typeof OAuthStatusSchema>;

/** Validated shape for the `mcpDirectory:disconnectOAuth` RPC method. */
export const DisconnectOAuthSchema = z.object({
  serverKey: z.string().min(1),
});

export type DisconnectOAuthInput = z.infer<typeof DisconnectOAuthSchema>;

/**
 * Secret storage key for the Smithery API key. Kept in lockstep with the
 * `SMITHERY_API_KEY_DEF` descriptor in `@ptah-extension/settings-core`.
 * Routed through `IAuthSecretsService` provider-key slots (each id gets an
 * isolated, encrypted slot), so the key value never leaves the backend.
 * Declared as a non-auth slot so saving it does not re-initialize the SDK
 * adapter (which disposes every live chat session).
 */
export const SMITHERY_API_KEY_SECRET_ID =
  NON_AUTH_PROVIDER_KEY_SLOT_IDS.smitheryApiKey;

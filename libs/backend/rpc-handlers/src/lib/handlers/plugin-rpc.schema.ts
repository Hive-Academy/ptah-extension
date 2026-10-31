/**
 * Zod boundary schemas for the external-marketplace half of
 * {@link PluginRpcHandlers}.
 *
 * These validate params arriving from the WEBVIEW. The marketplace lib
 * separately validates everything arriving from GitHub — the two boundaries are
 * distinct and neither substitutes for the other: a well-formed RPC call can
 * still name a hostile repository.
 *
 * `source` is checked against the shared `SAFE_SOURCE_PATTERN` (the same guard
 * `skillsSh:install` uses) so a malformed slug is rejected before it can reach
 * URL construction.
 */

import { z } from 'zod';
import { SAFE_SOURCE_PATTERN } from '@ptah-extension/shared';

/** Single `[a-zA-Z0-9_.-]` token — a plugin name or path segment. */
const SAFE_TOKEN_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** `plugins:add-marketplace` and `:remove-marketplace`. */
export const MarketplaceSourceParamsSchema = z.object({
  source: z.string().min(1).max(256).regex(SAFE_SOURCE_PATTERN),
});

/** `plugins:browse-marketplace` — the source, plus an explicit cache bypass. */
export const MarketplaceBrowseParamsSchema =
  MarketplaceSourceParamsSchema.extend({ refresh: z.boolean().optional() });

/** A server-issued approval id: a `randomUUID`. */
const APPROVAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** At most as many decisions as the approval registry can hold approvals. */
const MAX_LOCAL_ITEM_DECISIONS = 256;

/**
 * Approval ids mapped to the user's keep/replace decision. Only ids the server
 * issued can match a live approval; the shape check here only keeps garbage
 * out of the registry lookup.
 */
export const LocalItemDecisionsSchema = z
  .record(z.string().regex(APPROVAL_ID_PATTERN), z.enum(['keep', 'replace']))
  .refine(
    (decisions) => Object.keys(decisions).length <= MAX_LOCAL_ITEM_DECISIONS,
    { message: 'Too many local-item decisions.' },
  );

/**
 * `plugins:install-external`.
 *
 * `consentToken` is optional BY DESIGN: its absence is what requests a plan.
 * When present it is a hex SHA-256 digest, so the shape is checked here and its
 * validity is checked by the installer against the plans it actually minted.
 */
export const ExternalInstallParamsSchema = z.object({
  source: z.string().min(1).max(256).regex(SAFE_SOURCE_PATTERN),
  plugin: z.string().min(1).max(128).regex(SAFE_TOKEN_PATTERN),
  consentToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /** Keep/replace per plan `approvalId`; a missing entry means keep. */
  localItemDecisions: LocalItemDecisionsSchema.optional(),
  /**
   * Where the plugin's declared MCP servers are recorded. Read only on the
   * consented call; the plan call ignores it. Workspace unless the user
   * explicitly chose "All workspaces".
   */
  mcpScope: z.enum(['workspace', 'global']).default('workspace'),
});

/** `plugins:replace-kept-items`. */
export const ReplaceKeptItemsParamsSchema = z.object({
  decisions: LocalItemDecisionsSchema,
});

/**
 * `plugins:resolve-config-home`. `folder` is only ever compared with the
 * server's own candidate list, never used as a path.
 */
export const ResolveConfigHomeParamsSchema = z.object({
  action: z.enum(['adopt', 'dismiss']),
  folder: z.string().min(1).max(4096),
});

/** `plugins:uninstall-external`. */
export const ExternalUninstallParamsSchema = z.object({
  pluginId: z
    .string()
    .min(1)
    .max(512)
    .regex(/^external:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
});

export type MarketplaceSourceParamsInput = z.infer<
  typeof MarketplaceSourceParamsSchema
>;
export type MarketplaceBrowseParamsInput = z.infer<
  typeof MarketplaceBrowseParamsSchema
>;
export type ExternalInstallParamsInput = z.infer<
  typeof ExternalInstallParamsSchema
>;
export type ExternalUninstallParamsInput = z.infer<
  typeof ExternalUninstallParamsSchema
>;

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

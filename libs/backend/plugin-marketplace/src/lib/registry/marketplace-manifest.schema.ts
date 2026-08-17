/**
 * Zod boundary for `.claude-plugin/marketplace.json` fetched from an arbitrary
 * GitHub repository.
 *
 * TREAT THIS INPUT AS HOSTILE. Anyone can publish a repo and hand the user an
 * `owner/repo` slug, so nothing below trusts a field's shape, and every value
 * that later becomes a filesystem path or a URL segment is constrained here
 * rather than downstream. In particular:
 *
 * - `plugins[].name` must be a single safe path token — it becomes a directory
 *   name under `~/.ptah/plugins/external/<owner>/<repo>/`.
 * - `plugins[].source` must be a repo-RELATIVE path with no `..` segment, no
 *   leading `/`, no drive letter and no scheme. This is the first of two
 *   traversal guards; the installer applies the second against resolved
 *   absolute paths, because a schema alone cannot see where a path lands.
 *
 * The schema is deliberately permissive about EXTRA keys and about the shape of
 * `owner` (real manifests in the wild use both a bare string and an object).
 * Being strict there would reject valid marketplaces without buying any safety;
 * being strict about names and paths is what buys safety.
 */

import { z } from 'zod';
import { isSafePathToken } from '@ptah-extension/shared';

/** A single safe filesystem path segment (rejects `.`, `..`, separators). */
const SafePathToken = z.string().min(1).max(128).refine(isSafePathToken, {
  message:
    'must be a single path segment of [a-zA-Z0-9_.-] and not "." or ".."',
});

/**
 * A repo-relative subtree path such as `./plugins/dotnet-test`.
 *
 * Normalizes the leading `./` away and yields forward-slash segments.
 */
const RepoRelativePath = z
  .string()
  .min(1)
  .max(512)
  .transform((raw) => raw.replace(/^\.\//, '').replace(/\\/g, '/'))
  .refine((value) => !value.startsWith('/'), {
    message: 'must be repo-relative, not absolute',
  })
  .refine((value) => !/^[a-zA-Z]:/.test(value), {
    message: 'must not be a drive-qualified path',
  })
  .refine((value) => !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value), {
    message: 'must not be a URL',
  })
  .refine(
    (value) =>
      value
        .split('/')
        .filter((segment) => segment.length > 0)
        .every(isSafePathToken),
    { message: 'contains an unsafe or traversing path segment' },
  );

/**
 * An MCP server declaration.
 *
 * Captured verbatim so the consent dialog can render the exact command line.
 * Ptah never executes or registers these — see `ExternalPluginMcpServer`.
 */
const McpServerSchema = z.object({
  command: z.string().min(1).max(512),
  args: z.array(z.string().max(512)).max(64).optional(),
  env: z.record(z.string(), z.string().max(2048)).optional(),
});

/** One entry in the manifest's `plugins` array. */
const MarketplacePluginSchema = z.object({
  name: SafePathToken,
  source: RepoRelativePath,
  description: z.string().max(4096).optional(),
  version: z.string().max(64).optional(),
  mcpServers: z.record(z.string().max(128), McpServerSchema).optional(),
});

/**
 * `owner` appears in the wild both as `"dotnet"` and as
 * `{ "name": "...", "email": "..." }`. Accept either, normalize to a string.
 */
const OwnerSchema = z.union([
  z.string().max(256),
  z
    .object({ name: z.string().max(256).optional() })
    .passthrough()
    .transform((value) => value.name ?? ''),
]);

/** The whole `.claude-plugin/marketplace.json` document. */
export const MarketplaceManifestSchema = z.object({
  name: z.string().min(1).max(256),
  owner: OwnerSchema.optional(),
  plugins: z.array(MarketplacePluginSchema).min(1).max(512),
});

export type MarketplaceManifest = z.infer<typeof MarketplaceManifestSchema>;
export type MarketplaceManifestPlugin = MarketplaceManifest['plugins'][number];

/** `plugin.json` inside a plugin subtree. Only the display fields matter. */
export const PluginMetadataSchema = z
  .object({
    name: z.string().max(256).optional(),
    description: z.string().max(4096).optional(),
    version: z.string().max(64).optional(),
  })
  .passthrough();

/** `version.json` inside a plugin subtree (dotnet/skills uses this file). */
export const PluginVersionFileSchema = z
  .object({ version: z.string().max(64).optional() })
  .passthrough();

/**
 * Mirror of the Claude Agent SDK output-style frontmatter schema.
 *
 * PINNED TO SDK v0.3.150. Source of truth: the zod `.strict()` schema inside
 * node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe, cross-read
 * against node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (Settings,
 * sdk.d.ts:5037). Exactly four keys; any fifth key voids the file.
 *
 * UPGRADE CHECKPOINT (R4): if the SDK minor version changes, re-verify this
 * schema. A drift makes Ptah reject files the SDK accepts, or vice versa —
 * which breaks the one guarantee this surface owes the user, that Ptah's
 * verdict on a style file matches the SDK's.
 *
 * This is the SINGLE named location for the schema. Do not inline a second
 * copy of these key names anywhere; import `OUTPUT_STYLE_FRONTMATTER_KEYS`.
 */
import { z } from 'zod';

/** The SDK release this schema was read out of. Bump only after re-verifying. */
export const SDK_OUTPUT_STYLE_VERSION_PIN = '0.3.150' as const;

/**
 * Every key the SDK's strict schema accepts, in the canonical kebab-case form
 * that Ptah always WRITES. Reads additionally accept the camelCase spelling
 * (the SDK loads with `normalizeKeys: true`) — see `normalizeFrontmatterKeys`.
 */
export const OUTPUT_STYLE_FRONTMATTER_KEYS = [
  'name',
  'description',
  'keep-coding-instructions',
  'force-for-plugin',
] as const;

export const OutputStyleFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    'keep-coding-instructions': z.boolean().optional(),
    'force-for-plugin': z.boolean().optional(),
  })
  .strict();

export type OutputStyleFrontmatter = z.infer<
  typeof OutputStyleFrontmatterSchema
>;

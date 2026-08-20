/**
 * Zod schemas and validation constants for {@link SkillsShRpcHandlers}.
 *
 * Extracted from the inline validation that previously lived (triplicated) in
 * the per-app `skills-sh-rpc.handlers.ts` copies so the source/skill-id/name
 * allowlists can be unit-tested in isolation and reused without duplicating
 * the literal regexes across handler and specs.
 *
 * EXTRACTION CONTRACT — these MUST keep the exact same accept/reject behavior
 * as the regexes the handler used before consolidation:
 *   - `SAFE_SOURCE_PATTERN` accepts `owner/repo` slugs (`[a-zA-Z0-9_.-]+/...`).
 *   - `SAFE_SKILL_ID_PATTERN` / `SAFE_SKILL_NAME_PATTERN` accept a single
 *     `[a-zA-Z0-9_.-]+` token.
 *   - `sanitizeSearchQuery` strips everything outside `[a-zA-Z0-9\s\-._/]`.
 */

import { z } from 'zod';
import { SAFE_SOURCE_PATTERN } from '@ptah-extension/shared';

/**
 * `owner/repo` slug guard — matches the handler's install `source` check.
 *
 * The literal moved to `@ptah-extension/shared` when the external plugin
 * marketplace registry needed the same guard and could not import this file
 * (`rpc-handlers` sits above it in the graph). Re-exported here unchanged so
 * the EXTRACTION CONTRACT above still describes this module's public surface.
 */
export { SAFE_SOURCE_PATTERN };

/** Single-token guard for `skillId` and skill `name`. */
export const SAFE_SKILL_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Alias kept for readability at the uninstall call site. */
export const SAFE_SKILL_NAME_PATTERN = SAFE_SKILL_ID_PATTERN;

/**
 * Strip characters outside the safe set from a free-text search query.
 * Mirrors the handler's `params.query.replace(/[^a-zA-Z0-9\s\-._/]/g, '')`.
 */
export function sanitizeSearchQuery(query: string): string {
  return query.replace(/[^a-zA-Z0-9\s\-._/]/g, '');
}

/** Boundary schema for `skillsSh:search`. */
export const SkillsShSearchParamsSchema = z.object({
  query: z.string(),
});

/**
 * Boundary schema for `skillsSh:install`.
 *
 * `agents` and `scope` are gone — see the `skillsSh:install` contract in
 * `@ptah-extension/shared`'s `rpc.types.ts` for why each named a choice the
 * implementation could not make. The regexes below stay exactly as they were;
 * the extra `.`/`..` rejection these values need now that they become directory
 * names is layered ON TOP in `rejectUnsafeInstallRequest`
 * (`../utils/skills-sh-cli.ts`), never by loosening anything here.
 */
export const SkillsShInstallParamsSchema = z.object({
  source: z.string().regex(SAFE_SOURCE_PATTERN),
  skillId: z.string().regex(SAFE_SKILL_ID_PATTERN).optional(),
});

/** Boundary schema for `skillsSh:uninstall`. */
export const SkillsShUninstallParamsSchema = z.object({
  name: z.string().regex(SAFE_SKILL_NAME_PATTERN),
});

export type SkillsShSearchParams = z.infer<typeof SkillsShSearchParamsSchema>;
export type SkillsShInstallParams = z.infer<typeof SkillsShInstallParamsSchema>;
export type SkillsShUninstallParams = z.infer<
  typeof SkillsShUninstallParamsSchema
>;

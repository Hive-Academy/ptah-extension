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

/** `owner/repo` slug guard — matches the handler's install `source` check. */
export const SAFE_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

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

/** Boundary schema for `skillsSh:install`. */
export const SkillsShInstallParamsSchema = z.object({
  source: z.string().regex(SAFE_SOURCE_PATTERN),
  skillId: z.string().regex(SAFE_SKILL_ID_PATTERN).optional(),
  scope: z.enum(['project', 'global']),
  agents: z.array(z.string()).optional(),
});

/** Boundary schema for `skillsSh:uninstall`. */
export const SkillsShUninstallParamsSchema = z.object({
  name: z.string().regex(SAFE_SKILL_NAME_PATTERN),
  scope: z.enum(['project', 'global']),
});

export type SkillsShSearchParams = z.infer<typeof SkillsShSearchParamsSchema>;
export type SkillsShInstallParams = z.infer<typeof SkillsShInstallParamsSchema>;
export type SkillsShUninstallParams = z.infer<
  typeof SkillsShUninstallParamsSchema
>;

/**
 * SecretStorage slot for the skills.sh API key. Must match SECRET_KEY in
 * libs/backend/cli-agent-runtime/src/lib/skills-directory/skills-sh-api.schema.ts
 * (the SkillsShApiClient owns the canonical copy).
 */
export const SECRET_KEY = 'skillsSh.apiKey';

export const SkillsShSetApiKeyParamsSchema = z.object({
  apiKey: z.string().min(1),
});

export const SkillsShEmptyParamsSchema = z.object({}).strict();

export type SkillsShSetApiKeyParams = z.infer<
  typeof SkillsShSetApiKeyParamsSchema
>;

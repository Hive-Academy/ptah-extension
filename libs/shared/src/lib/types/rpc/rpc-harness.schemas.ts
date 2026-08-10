/**
 * Zod schemas for the Harness Setup Builder RPC contracts.
 *
 * Split out of `rpc-harness.types.ts` so the harness data model and its plain
 * constants can be imported without pulling `zod` in. Dependency direction is
 * one-way: schemas → types.
 */

import { z } from 'zod';

import type { HarnessSkillRef } from './rpc-harness.types';

/**
 * Boundary shape for a skill ref as the designing agent writes it: `source` may
 * be omitted, in which case it is inferred from the presence of `installSource`.
 */
export const HarnessSkillRefInputSchema = z.object({
  skillId: z.string().min(1),
  source: z.enum(['local', 'skills.sh']).optional(),
  installSource: z.string().optional(),
  scope: z.enum(['project', 'global']).optional(),
});

/** Loose ref accepted at the agent boundary; normalized to `HarnessSkillRef`. */
export type HarnessSkillRefInput = z.infer<typeof HarnessSkillRefInputSchema>;

/**
 * Reconcile the two shapes a skill selection can arrive in into the canonical
 * `{ selectedSkills, selectedSkillRefs }` pair.
 *
 * Accepts both the legacy `string[]` (every preset on disk) and refs, whether
 * the agent put them in `selectedSkills` directly or in `selectedSkillRefs`.
 * IDs keep first-seen order and are deduped; a ref-only ID is still treated as
 * a selection. Refs are deduped by `skillId`, with an explicit
 * `selectedSkillRefs` entry winning over one inlined into `selectedSkills`.
 */
export function normalizeHarnessSkillSelection(
  selectedSkills: ReadonlyArray<string | HarnessSkillRefInput> | undefined,
  selectedSkillRefs: ReadonlyArray<HarnessSkillRefInput> | undefined,
): { selectedSkills: string[]; selectedSkillRefs: HarnessSkillRef[] } {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const refsById = new Map<string, HarnessSkillRef>();

  const toRef = (input: HarnessSkillRefInput): HarnessSkillRef => ({
    skillId: input.skillId,
    source: input.source ?? (input.installSource ? 'skills.sh' : 'local'),
    ...(input.installSource ? { installSource: input.installSource } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  });

  const addId = (skillId: string): void => {
    if (skillId.length === 0 || seenIds.has(skillId)) return;
    seenIds.add(skillId);
    ids.push(skillId);
  };

  for (const entry of selectedSkills ?? []) {
    if (typeof entry === 'string') {
      addId(entry);
      continue;
    }
    addId(entry.skillId);
    refsById.set(entry.skillId, toRef(entry));
  }

  for (const entry of selectedSkillRefs ?? []) {
    addId(entry.skillId);
    refsById.set(entry.skillId, toRef(entry));
  }

  return { selectedSkills: ids, selectedSkillRefs: [...refsById.values()] };
}

/**
 * Zod schema validating a `Partial<HarnessConfig>` at the `proposeConfig` MCP
 * tool boundary. Every field is optional so the agent can stream incremental
 * config decisions; structures are intentionally permissive (the agent owns
 * the authoring contract) while still rejecting non-object payloads.
 */
export const HarnessConfigUpdatesSchema = z
  .object({
    name: z.string(),
    persona: z
      .object({
        label: z.string(),
        description: z.string(),
        goals: z.array(z.string()),
        templateId: z.string().optional(),
      })
      .partial(),
    agents: z
      .object({
        enabledAgents: z.record(z.string(), z.unknown()),
        harnessSubagents: z.array(z.unknown()),
      })
      .partial(),
    // `selectedSkills` accepts bare IDs (the legacy/local case) or full refs —
    // agents routinely inline the search result they picked. Both shapes are
    // reconciled here so the surface always receives IDs plus refs.
    skills: z
      .object({
        selectedSkills: z.array(
          z.union([z.string(), HarnessSkillRefInputSchema]),
        ),
        selectedSkillRefs: z.array(HarnessSkillRefInputSchema),
        createdSkills: z.array(z.unknown()),
      })
      .partial()
      .transform(
        (
          skills,
        ): {
          selectedSkills?: string[];
          selectedSkillRefs?: HarnessSkillRef[];
          createdSkills?: unknown[];
        } => {
          const touched =
            skills.selectedSkills !== undefined ||
            skills.selectedSkillRefs !== undefined;
          if (!touched) return { createdSkills: skills.createdSkills };
          return {
            ...normalizeHarnessSkillSelection(
              skills.selectedSkills,
              skills.selectedSkillRefs,
            ),
            createdSkills: skills.createdSkills,
          };
        },
      ),
    prompt: z
      .object({
        systemPrompt: z.string(),
        enhancedSections: z.record(z.string(), z.string()),
      })
      .partial(),
    mcp: z
      .object({
        servers: z.array(z.unknown()),
        enabledTools: z.record(z.string(), z.array(z.string())),
      })
      .partial(),
    claudeMd: z
      .object({
        generateProjectClaudeMd: z.boolean(),
        customSections: z.record(z.string(), z.string()),
        previewContent: z.string(),
      })
      .partial(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .partial();

/**
 * Prompt-authoring rubric rules that apply to generated agent sections.
 *
 * The rubric (`.claude/skills/skill-creator/references/prompt-authoring-rubric.md`)
 * governs skill bodies. Of its ten rules, 2, 3, 5, 6, 7 and 8 also decide the
 * content of the repository-specific half of a generated agent; rules 1, 4, 9
 * and 10 concern skill structure, examples, generic skills and measurement and
 * do not apply.
 *
 * Each entry pairs the rubric heading it implements with the one instruction
 * the generation system prompt carries for it. `generation-prompt-rules.spec.ts`
 * pins both sides by hash, so a rubric edit without a prompt edit (or the
 * reverse) fails until the pinned table is reviewed and updated.
 */

/** The rubric rule numbers that apply to generated agent sections. */
export type GenerationRubricRuleNumber = 2 | 3 | 5 | 6 | 7 | 8;

export interface GenerationRubricRule {
  /** Rubric rule number (`## <rule>. <title>` in the rubric). */
  readonly rule: GenerationRubricRuleNumber;
  /** Rubric heading title, without the number. */
  readonly title: string;
  /** The instruction the generation system prompt carries for this rule. */
  readonly instruction: string;
}

export const GENERATION_RUBRIC_RULES: readonly GenerationRubricRule[] = [
  {
    rule: 2,
    title: 'One home per rule',
    instruction:
      'Do not restate rules already in the authored half of the template; add only what this repository decides.',
  },
  {
    rule: 3,
    title: 'Cut model education',
    instruction:
      'Do not explain general engineering concepts the agent already knows; state only what it cannot derive without reading this repository.',
  },
  {
    rule: 5,
    title: 'No history',
    instruction:
      'Write no task IDs, dates or change history; state the current contract only.',
  },
  {
    rule: 6,
    title: 'Contracts over narrative',
    instruction: 'State contracts, paths and boundaries rather than narrative.',
  },
  {
    rule: 7,
    title: 'No rosters, counts or versions that discovery supplies',
    instruction:
      'Write no rosters, counts or versions the agent can discover: no counts of anything, no version numbers (name the framework, never its version), no inventory of the directory tree, the lib set or the dependency list.',
  },
  {
    rule: 8,
    title: 'Role-gated capabilities',
    instruction:
      "Reference a plugin skill only when it is relevant to this agent's role and listed under Available Plugin Skills; never reference a skill, tool or action this agent may not invoke.",
  },
];

/** The "RUBRIC RULES" block appended to the generation system prompt. */
export function formatRubricRulesBlock(
  rules: readonly GenerationRubricRule[] = GENERATION_RUBRIC_RULES,
): string {
  return `RUBRIC RULES\n${rules.map((r) => `- ${r.instruction}`).join('\n')}`;
}

import type { OutcomeTaskKind } from '@ptah-extension/shared';

/**
 * Known lane roles and subagent types mapped to the task kind they perform
 * (Req 2, `taskKindSource: 'mapped'`). Keys are lower case; lookup is a
 * case-insensitive exact match with no fuzzy matching. Phase kinds mirror
 * `lane-routing` `phase-plan.ts` (`taskKindFor`), and the agent slugs are the
 * built-in subagent roles plus the repository's own agents.
 */
const TASK_KIND_BY_ROLE: ReadonlyMap<string, OutcomeTaskKind> = new Map<
  string,
  OutcomeTaskKind
>([
  // Task kinds and phase kinds.
  ['plan', 'plan'],
  ['architecture', 'plan'],
  ['implement', 'implement'],
  ['review', 'review'],
  ['document-review', 'review'],
  ['visual-review', 'review'],
  ['plan-review', 'review'],
  ['research', 'research'],
  ['tests', 'tests'],
  ['docs', 'docs'],
  ['design', 'docs'],
  // Agent slugs.
  ['project-manager', 'plan'],
  ['software-architect', 'plan'],
  ['team-leader', 'plan'],
  ['backend-developer', 'implement'],
  ['frontend-developer', 'implement'],
  ['devops-engineer', 'implement'],
  ['code-logic-reviewer', 'review'],
  ['code-style-reviewer', 'review'],
  ['visual-reviewer', 'review'],
  ['researcher-expert', 'research'],
  ['senior-tester', 'tests'],
  ['technical-content-writer', 'docs'],
  ['ui-ux-designer', 'docs'],
]);

/**
 * The task kind a known role or subagent type performs, or null when the role
 * is absent or unknown (including `general-purpose`, `Explore` and `unknown`).
 */
export function taskKindForRole(role: string | null): OutcomeTaskKind | null {
  if (role === null) return null;
  return TASK_KIND_BY_ROLE.get(role.trim().toLowerCase()) ?? null;
}

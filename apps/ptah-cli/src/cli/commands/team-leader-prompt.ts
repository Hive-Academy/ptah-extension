/**
 * Team Leader execution prompt — shared between `ptah execute-spec` and
 * `ptah mcp-serve` (`session_submit` MCP tool).
 *
 * Extracted from `execute-spec.ts:46` so the `session_submit` dispatcher can
 * import the pure prompt builder without dragging in the entire
 * `executeSessionStart` transitive graph. Re-exported by `execute-spec.ts`
 * for the existing public-API consumers.
 *
 * Behavior is byte-identical to the original `buildTeamLeaderPrompt` —
 * the single template literal, the embedded task description + plan, and the
 * trailing batch-coordination directive.
 */

export function buildTeamLeaderPrompt(
  specId: string,
  taskDescription: string,
  implementationPlan: string,
): string {
  return [
    'You are coordinating execution of a pre-planned task.',
    '',
    `Task ID: ${specId}`,
    '',
    '## Task description',
    taskDescription,
    '',
    '## Implementation plan',
    implementationPlan,
    '',
    'Execute the plan. Coordinate sub-agents per the implementation-plan batch breakdown. After each batch, run the validation gates (typecheck, test, lint, build) for the affected workspaces. Report progress before each batch and verification results after each batch. Halt and surface any blocker rather than improvising.',
  ].join('\n');
}

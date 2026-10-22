# Batch 11 fix round 1 — sibling spec still expected the old badge label

Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea`
Batch: 11, fix round 1 (after the orchestrator ran `nx test @ptah-extension/skill-synthesis-ui`)
Status: implemented. No check was run by this executor.

## Cause

Batch 11 changed the badge so an ungraded agent renders `No grade`
(`scorecard-badge.component.ts:102-119`). The clone-card spec still asserted the old
`no data yet` label through the badge's `scorecard-success` test id, so two tests failed.

## File changed

| File : line | Before | After |
| --- | --- | --- |
| `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.spec.ts:330` | `expect(q('scorecard-success')?.textContent?.trim()).toBe('no data yet');` | `expect(q('scorecard-success')?.textContent?.trim()).toBe('No grade');` |
| `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.spec.ts:545` | same | same |

One replace-all edit changed both lines. A grep for `scorecard-success` over the whole file
returned only these two occurrences, so no other assertion needed the same fix. Line 330 is
the test that renders an agent clone with no scorecard input (badge defaults to null →
`No grade`); line 545 is the outcome-signals test whose card likewise carries no scorecard.

No other file was touched. LF line endings preserved. No test, nx or git command was run.
# Context - TASK_2026_680_bc6c

Epic: TASK_2026_647_1b0f. Depends on TASK_2026_649_33c4 (builders on normal chat sessions).

## Request

User, 2026-10-15 (649 design confirmation): "can we flag these sessions and add a small follow up
task to flag them in the session sidebar then from them when clicked they open in ai team builder
same for other sessions for setup hub and project builder".

## Scope

- Sessions are already flagged by 648/649: `TabState.workflow` (`harness-configure`,
  `harness-new-project`), `WorkflowSessionIndexService` (history), `ptah-workflow-badge` in the
  tab bar, sidebar rows, rail card and canvas focus header.
- This task: a click on a flagged session in the session sidebar opens it in its builder page
  (AI Team Builder for `harness-configure`, New Project builder for `harness-new-project`, and the
  Setup Wizard page when 650/651 add its workflow kind) instead of the plain chat view. The builder
  page hosts the session through `ptah-session-embed` plus the builder sidebar (649 D1).
- Unflagged sessions keep the current behavior.

## Open points for design

- Same rule for the tab bar, or only the session sidebar (user named the sidebar).
- How the user still reaches the plain chat view for a flagged session (if at all).
- Behavior when the builder page already hosts another session of the same kind (649 draft rules,
  652 D16-D18).

## Inputs

- `../TASK_2026_649_33c4/decisions.md` D1, D2.
- `../TASK_2026_648_374e/decisions.md`, `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts`,
  `libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.ts`.

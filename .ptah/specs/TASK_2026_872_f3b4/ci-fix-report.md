# CI fix report

## Canvas

Root cause: the intended stable failed-last roster partition moves Broken behind the two completed agents. At 450px the five visible chips are Orchestrator, Waiter, Runner, Finished, and Extra; Broken overflows. The waiting and running chips remain visible, so this is an expectation change, not a source bug. Updated visible-chip assertions at `canvas-lane-tabs.component.spec.ts:942-944` and overflow order at `:966`. The observer disconnect assertion remains.

## Chat UI

Root cause: the exact key list predates additive `inspectorRuns` and `providerLimits` fields. The model still stores per-run values separately and has no session token or cost field. Updated `stats-limit-view-model.spec.ts:436-439` to check the new fields and exclude session token/cost keys. Intended additive model change; no source bug.

## Chat

Root cause: `agentListRow` now includes the agent name in its usage label, placing `Explore.` between the model and token facts in the accessible label. Sub-agent token count, input/output tooltip and model remain intact. Updated `inspector-agents-section.component.spec.ts:514-515` to assert the model and usage facts separately. Intended name change; no source bug.

## Webview e2e

Root cause: LANES now renders provider limit rows, while run details and the subtotal moved to AGENTS. Replaced obsolete per-run tile assertions in `plan-limits-visual.e2e.spec.ts:145-182` with four provider rows (ptah-cli, codex, opencode, copilot), their percent/unknown/multiple-account states, a reset detail, the AGENTS subtotal, and Codex review run tokens and owner detail. Existing `data-provider-id`, `data-agent-key`, and `data-testid` attributes suffice; no source edit. The 280/360/440 width and both-theme loops remain.

## Verification

Ran `npm run verify -- -t test -p canvas,chat-ui,chat`; exit 1 before Jest. Output tail: `Failed to load 3 default Nx plugin(s)` and `@nx/jest/plugin: spawn EPERM`; verify lock released, exit code 1. Scoped `ptah_get_diagnostics` returned `TypeScript check still running after 45s`, with four files unchecked. E2e was not run, as requested; CI must verify it.

## Files changed

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts`
- `.ptah/specs/TASK_2026_872_f3b4/ci-fix-report.md`

## Decisions

- Keep failed-last ordering and update the canvas fixture expectation. Evidence: roster order and 450px chip count keep Waiter and Runner visible. Reversible: yes.
- Keep the additive view model and assert the session-total boundary directly. Evidence: `buildStatsLimitViewModel` returns `inspectorRuns` and `providerLimits` beside `subtotal`, with no session total field. Reversible: yes.
- Keep the agent name in the accessible usage label and test the independent facts. Evidence: `agentListRow` prepends `name` to `usageLabel`; underlying usage values are unchanged. Reversible: yes.

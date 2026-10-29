# implementation-plan.md — review

- Reviewer: orchestrator (in-process Claude), opposite execution side to the codex author.
- Verdict: **APPROVED with amendments** (amendments are binding on the implementation lanes).

## Checks

- User decisions 1-4 in context.md: all reflected (Scope, batches B/A/C/D).
- Do-not-edit list (4 files overlapping fix/lane-chat-order): respected; no batch lists them.
- Order B → A is correct: `command-center` imports `@ptah-extension/tribunal-panel/phase` and `/discovery`.
- Spot-checked: `CommandCenterRosterProvider` (501 lines) also owns ordinary (non-Tribunal)
  pending questions (`ordinaryQuestion`, `isRosterIdleWithoutPendingRequest`). The plan says to keep
  that behaviour before deletion — correct.
- `tasks:getRoundJudge`: only production caller is `tribunal-progress.service.ts:328`; contract,
  allowlist (`rpc.types.ts:3565`) and baseline (`host-source-registry.baseline.ts:348`) listed.

## Amendments

1. Roster provider: prefer slimming it into a question-only provider
   (`command-center-question.provider.ts`, keep `isRosterIdleWithoutPendingRequest` renamed only if
   all callers update) over spreading its logic into the controller. Keep its non-Tribunal spec cases.
2. Lane-introduced constraint REMOVED: do not add a new skill mirror byte-equality spec (not
   requested). Mirror parity is checked by the orchestrator with `cmp` at review.

## Lane-introduced constraints

- "New mirror spec in D" — rejected (amendment 2).

## Execution split

- Lane 1: batch B (command-center, chat-state, chat-routing).
- Lane 2: batches C + D (backend RPC/preset, shared RPC types, skill text + mirrors).
- Lane 3: batch E (e2e, docs, README, misc).
- Lane 4 (after lane 1): batch A (delete lib, route, surfaces, shells).

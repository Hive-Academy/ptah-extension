# Development Tasks — TASK_2026_263

**Batches**: 5 | **Branch**: `ak/tui-defects` | **Decomposed**: 2026-08-16

## Batch 1 — Question routing on interactive surfaces (frontend-developer)

- `PermissionHandlerService.hasSurfaceQuestionTargets(id)` keyed on `_questionTargetTabs`; use in harness-builder-view; replace tribunal-page local copy.
- `StreamRouter`: microtask fallback + `refreshQuestionTargetsForSession` + `refreshStaleQuestionTargets` also resolve to interactive surfaces.
- `ChatMessageHandler.handleSessionIdResolved`: append `realSessionId` to claimed surface conversation.
- Backend `ask-user-question.service.ts`: honour delivery boolean like the permission twin.
- Specs for each.

## Batch 2 — Persistence + intake (frontend-developer + backend-developer)

- Workflow state (mode, user bubbles, correlationId, surfaceId, streaming state) in root services; component no longer disposes on destroy; explicit "Close / Start over" action disposes.
- Persist `{ sessionId, mode, workspaceRoot, bubbles }` (localStorage) → rehydrate on reload via `chat:continue`-capable resume; Setup Hub card shows Resume state.
- Intake form on Setup Hub (product/business, target users, constraints, stack pref incl. recommend); RPC `harness:start-new-project` takes `{ intake }` (Zod); seed prompt built from intake and mandates AskUserQuestion discovery + ddd/nx skills.

## Batch 3 — Skill content (backend-developer / technical writer)

- Rewrite `saas-workspace-initializer/SKILL.md` Step a: business first → stack → invoke ddd-architecture + nx-workspace-architect in Stage A; mandate AskUserQuestion; fix ddd link; de-emphasise hardcoded stack/roadmap example.
- Rewrite `/init-saas` command to match; align orchestration SAAS_INIT strategy.
- Sync all four copies (`.claude`, `.agents`, `.github`, `apps/ptah-extension-vscode/assets/plugins`).

## Batch 4 — E2E (senior-tester)

- `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts`: intake → observed RPC params; question card renders on surface + response RPC observed; navigate away/back preserves transcript and no restart RPC.

## Batch 5 — Review (code-logic-reviewer, code-style-reviewer)

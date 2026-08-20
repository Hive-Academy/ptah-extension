# TASK_2026_263 — New Project flow: intake, questions on surface, persistence, discovery-first skill, e2e

## User intent (2026-08-16)

Starting a new project from the Setup Hub card was "very generic": no way to
describe the business, no discovery questions, and the AskUserQuestion routing
"doesn't work on that setup wizard channel — we keep having this issue over and
over". New projects should (1) ask about the business and what is being built,
(2) then the tech stack, (3) then initialize the nx + ddd skills. Also required:
the session must persist when the user navigates to another page and back (it
currently drops back to the setup page); this is a major, stable, showcase-grade
feature; add e2e tests proving it works.

## Evaluation findings (verified 2026-08-16)

### A. Questions unrenderable on the New Project surface (BUG, recurring)

- Flow: `setup-hub.component.ts:925` → RPC `harness:start-new-project`
  (`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:590`) →
  broadcast `harness:open-workflow` → `HarnessWorkflowService.startWorkflow`
  (`libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:54`)
  claims a `SurfaceId` registered `{ interactive: true }`, calls `chat:start`
  with `surfaceMode: true`.
- `StreamRouter.routeQuestionPrompt` (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:498-511`)
  correctly attaches `[surfaceId]` via `attachQuestionTargets` → `_questionTargetTabs`.
- `harness-builder-view.component.ts:448-451` filters `questionRequests()` with
  `permissionHandler.hasSurfaceTargets(q.id)` which reads `_promptTargetTabs`
  (permission map, `permission-handler.service.ts:352-358`) → always false →
  question card never renders. Chat view hides it too (`chat-view.component.ts:715-719`).
  Agent blocks (`timeoutAt: 0`), then `ask-user-question.service.ts:166-197`
  auto-picks option #1 after 5 min → "hardcoded" behaviour.
- Same bug was fixed locally in tribunal-panel by commit `54c24f85f`
  (`hasQuestionSurfaceTargets` in tribunal-page) — never lifted into the shared
  `PermissionHandlerService`, hence "over and over".
- Secondary: `refreshQuestionTargetsForSession` / `refreshStaleQuestionTargets`
  (`stream-router.service.ts:707-750`) and the `queueMicrotask` fallback (`:525`)
  only re-resolve to tabs, never to interactive surfaces; `handleSessionIdResolved`
  (`chat-message-handler.service.ts:519-524`) early-returns for claimed surfaces
  without appending `realSessionId` to the surface conversation.
- Backend: `ask-user-question.service.ts:92-110` ignores the delivery boolean
  (permission twin `sdk-permission-handler.ts:163-190` checks it).

### B. Zero user input before the agent starts

- Card has no input. Backend injects `NEW_PROJECT_CHAT_SEED_PROMPT`
  (`libs/backend/rpc-handlers/src/lib/harness/harness-constants.ts:3-12`) as a
  fabricated first user turn (`harness-builder-view.component.ts:477-480`).
- Force-enables `ptah-nx-saas` plugin unconditionally (`harness-rpc.handlers.ts:594-606`).
- No model/provider hardcoded (`harness-workflow.service.ts:76-90` uses ModelStateService).

### C. No persistence across navigation

- `harness-builder-view.component.ts:491-493` `ngOnDestroy → workflow.dispose()`
  releases claim + closes surface; `_userBubbles` and `_viewMode` are component-local.
  Navigating away and back loses the transcript and the surface; a pending
  question has no surface to render on.

### D. Skill content

- Runtime source `apps/ptah-extension-vscode/assets/plugins/` (downloaded from
  GitHub via `content-download.service.ts:79`, junctioned by `skill-junction.service.ts`);
  `.claude/skills`, `.agents/skills`, `.github/skills` are byte-identical mirrors.
- `saas-workspace-initializer/SKILL.md:33-61` discovery = framework/tenancy/auth
  only; no business/product question; prose only, no AskUserQuestion mandate.
  Stack hardcoded (`:8`, `:81-84`), roadmap template + worked example
  (`references/roadmap-format.md:48-118`).
- `nx-workspace-architect` and `ddd-architecture` explicitly deferred to Stage B
  (`SKILL.md:31`); ddd link `../../ptah-core/skills/...` broken under junction layout.
- `.claude/commands/init-saas.md:24-33` references Phases 1-6 / Steps 2a-2i that
  no longer exist in the skill (dead). Orchestration `SAAS_INIT`
  (`orchestration/references/strategies.md:264-397`) has a third divergent
  discovery set + conflicting batch template.

### E. E2E infra

- `apps/ptah-electron-e2e` Playwright; `UiDriver` (`src/support/ui-driver.ts`)
  supports `goto('setup-hub'|'harness-builder')`, `mockRpc`, `pushEvent`
  (renderer messages), `getObservedCalls`/`waitForObservedCall`. Existing
  `src/specs/harness/harness-builder.spec.ts` only checks the views open.

## Target behaviour

1. Card → intake form (what are you building / who for / constraints / stack
   preference incl. "recommend for me") → first real user turn built from it.
2. Agent runs discovery through `AskUserQuestion` (business first, then stack),
   questions render as cards on the harness surface, answers flow back.
3. Stage A invokes `ddd-architecture` (bounded contexts) and
   `nx-workspace-architect` (lib layout) before scaffolding.
4. Workflow state lives in root services; navigating away/back keeps transcript,
   surface, pending questions; Setup Hub card shows "Resume"; page reload rehydrates.
5. Playwright e2e specs prove intake → RPC params, question card on surface +
   response RPC, persistence across navigation.

# Task Context - TASK_2026_540_0940

## User Request

The user recalled a task to elevate the UI and UX of the main pages and to separate settings from the chat, and the
coding agent from Apps and the regular chat (2026-09-23). Search result: the design exists, the build task did not.

## Task Type

FEATURE (webview shell).

## What already exists

- Design: `.ptah/specs/TASK_2026_492_0bcc/design-spec.md:11-24` - code-workspace nav set (Chat, Apps, Tasks,
  Tribunal, Analytics), space nav set (Home, Chat, Apps, Schedules), and one global configuration menu (Thoth, Setup
  hub, Marketplace, Settings) in the navbar global-actions cluster through `ptah-native-dropdown`, reachable before a
  workspace is open. Their view state must stop being workspace-partitioned (`app-state.service.ts:244-274` precedent).
- Mechanism: `.ptah/specs/TASK_2026_524_1125` (Angular Router, one route table, `retain: true` in batch 3).
- Research: `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 5, steps 1-3.
- Related: `TASK_2026_523_c3df` (one Providers & Auth settings surface), `TASK_2026_529_b482` (contrast audit).

## Scope

Revision 5 step 2 only: move the four configuration surfaces to the global menu, un-partition their view state, and
apply the code-workspace navigation set. The Apps tab itself comes from TASK_2026_494.

Out of scope: spaces, Home and Schedules (Revision 5 step 3) - create a separate task when this one lands.

## Depends on

TASK_2026_492_0bcc (design), TASK_2026_524_1125 (router).

## Complexity

Medium

## Strategy

FEATURE, Full depth: project-manager -> software-architect -> team-leader -> implementation -> review -> QA.
Handed over from session ptah-ptah-extension-task-494 (2026-09-23). Worktree:
`.claude-worktrees/feat-task-540-global-config-menu`, branch `feat/task-540-global-config-menu` from origin/main 2f798f0d5.

## CLI Lanes

Mode: enabled (user choice, Gate 0.1).

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue |
| antigravity | cli | installed | messaging: queue |
| opencode | cli | installed | messaging: none |
| Glm | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-355b645d-35af-4974-84cf-9cf961ea0164, messaging: queue |

Roster (pinned by the user):

| Phase | Lane | spawn args | Deliverable |
| --- | --- | --- | --- |
| Plan | Glm | `{ ptahCliId: 'pc-355b645d-35af-4974-84cf-9cf961ea0164', modelTier: 'opus' }` | task-description.md |
| Architecture | Glm | same, `modelTier: 'opus'` | implementation-plan.md |
| Team-leader | subagent | - | batches.md |
| Implement (per batch) | opencode | `{ cli: 'opencode', model: 'opencode-go/kimi-k3' }` | code + batch report |
| Review (per batch) | Glm | `{ ptahCliId: ..., modelTier: 'opus' }` | code-logic-review.md |

Lane limits: one batch of <=6 files per lane, 40-tool-call ceiling, `deliverables` declared, timeout 1200000 ms. Revise cap: 2 rounds.

## Conversation Summary

- Router batch 3 (`data: { retain: true }` / RouteReuseStrategy) is NOT needed: the design mount policy
  (TASK_2026_492 design-spec.md:37-49) marks thoth, setup-hub, marketplace and settings "Stays mounted: No".
  `chat` is already mounted; `apps` belongs to TASK_2026_494. 540 must add no new `[class.hidden]` block.
- Apps tab: NOT in 540 (TASK_2026_494 adds the `apps` id, route and tab after Canvas). Leave its slot in the code-workspace set.
- VS Code must not change: the global menu and the navigation sets are Electron only.
- Spaces, Home, Schedules: out of scope (TASK_2026_541_9deb).
- No commit to main and no merge without the user.
- Gate 1: task-description.md APPROVED by the user (2026-09-23). Labels Chat/Analytics accepted as in the design.
- Coordination: the user asked to consult session `ptah-ptah-extension-marketplace-5c345b0000njk2pjljpjg05`
  (marketplace refactor, defines marketplace routes) before the architecture is fixed.
- TASK_2026_533 answer (2026-09-23), source D:\projects\ptah-extension\.ptah\specs\TASK_2026_533_marketplace_redesign\implementation-plan.md (D1, D2):
  - 'marketplace' stays the one surface id; route becomes `loadChildren` with child routes (overview, connectors, servers, skills...).
    The menu item opens the bare 'marketplace' root; the root redirect restores the last page.
  - 533 changes no surface ids and no electron-shell lines. Overlap: app-state.service.ts (533 adds `marketplaceRoute`
    to the view slice, `rememberMarketplaceRoute`, `openMarketplace(route)`, `requestSurface(surface, subPath)`).
  - Merge order: 540 merges FIRST; 533 (branch feat/task-2026-533-marketplace-redesign, 25 batches) rebases onto it.
  - Request: keep the global configuration state a generic per-surface slot so 533 can add
    `marketplaceRoute: MarketplaceRoute | null` to the global Marketplace state.
  - Open design point: with no Marketplace tab, nothing names the open surface in Electron. 540 must say whether the menu
    button shows the active surface (label/highlight); else 533 shows its breadcrumb header in Electron.
  - 533 Batch 18 (Task 18.2, their plan C1) adds a no-op rule to `AppStateManager.setCurrentView`: do nothing when
    `view` is already the current surface, no navigation is pending, and `_settlementOwner` is the active workspace
    (so a menu click on 'marketplace' does not close an open detail). Not in `requestSurface`; `switchWorkspace`
    (app-state.service.ts:714-716) still re-navigates; `openMarketplace(route)` still navigates. The rule then also
    applies to thoth/setup-hub/settings if the 540 menu calls setCurrentView. If 540 changes setCurrentView or the
    settlement logic, 533 folds the rule into the 540 version during its rebase (533 Batch 18b). 540 must tell 533.
- Gate 2: implementation-plan.md APPROVED by the user (2026-09-23). Orchestrator corrected one sentence in
  "Extension points" item 3 (marketplace IS covered by the switchWorkspace stay-branch).
- User instruction at Gate 2: spawn INTERNAL subagents to review (a) the plans (task-description.md,
  implementation-plan.md) and (b) the work of every Glm and Kimi lane. Review per batch = Glm lane review
  (code-logic-review.md, batch section) + internal code-logic-reviewer subagent (batch-N-internal-review.md).
  Plan review = internal software-architect subagent (plan-review.md).
- TASK_2026_533 accepted all Gate 2 answers (no change requested): it renders an <h1> breadcrumb header in Electron,
  adds the setCurrentView no-op rule in its Batch 18, moves marketplaceRoute into perSurface.marketplace in Batch 18b.
  533 asks to be told when 540 is MERGED (the merge is the user's action, not this session's).
- Internal plan review (plan-review.md): APPROVE WITH FIXES, 3 MAJOR + 8 MINOR. Orchestrator applies findings 1, 4-11
  as corrections. User decisions (2026-09-23) on the two design-changing findings:
  - Finding 2 / team-leader R1 (pre-workspace render path): the no-workspace branch renders a BARE
    `<div class="h-full w-full"><router-outlet /></div>`, NOT ptah-app-shell (no canvas, no auth-redirect effect).
    app-shell.component.ts stays unchanged.
  - Finding 3 (workspace switch while a configuration surface is open): STAY on the surface AND RE-CREATE (remount) its
    component on the workspace change, so it shows fresh data for the new workspace. Architect designs the mechanism.
- Plan revision 2 (Glm) + internal re-review (APPROVE WITH FIXES) -> orchestrator "Revision 3 overrides" at the top of
  implementation-plan.md (remount = SurfaceRouterService.remountActiveSurface() outlet re-activation, not a keyed
  ptah-app-shell). Gate 2 delta APPROVED by the user (2026-09-23).
- Batch 1 implemented by opencode `opencode-go/kimi-k3`. Batch 2 lane failed twice: "Go usage limit exceeded"
  (OpenCode Go quota). User decision (2026-09-23): implement the remaining batches with opencode model
  `ollama/kimi-k3:cloud` (same Kimi 3 model, billed to Ollama Cloud, shared limits with the Glm lanes).
- Then Ollama Cloud also hit its limit (429 "session usage limit"): the Batch 1 Glm review and the Batch 2
  ollama/kimi-k3 lane both failed without output. User decision (2026-09-23): "continue with codex and glm along with
  your own subagents" -> implement batches 2-7 with the `codex` lane (default model); review each batch with the Glm
  lane (when its limit allows) AND the internal code-logic-reviewer subagent.

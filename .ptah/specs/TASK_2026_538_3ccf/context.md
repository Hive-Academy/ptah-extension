# Task Context - TASK_2026_538_3ccf

## User Request

The user wants the agent to "truly be able to build forms, sections with lists and select, and a way to send back
and forth communication between the UI state and the agent state, to elevate both the Apps dashboard and also the
coding agent". Decided 2026-09-23 while TASK_2026_494 was at Gate 2: build contract v2 first, then revise 494 on it.

## Task Type

FEATURE (shared contract + backend host state + MCP tools). No webview rendering here; TASK_2026_494 renders.

## Why this task exists

The TASK_2026_493 contract (`libs/shared/src/mcp-apps-contracts/`) has five read-only kinds (stat, line chart, bar
chart, table, list), full-snapshot specs only, no data model and no actions except the `DASHBOARD_ACTIONS` ids. The
TASK_2026_494 architecture (`.ptah/specs/TASK_2026_494_ca38/implementation-plan.md`, feat/task-494-apps-page worktree)
is sound, but building it on v1 would bake the snapshot-only intake, the selection-only channel (D4) and the v1 view
model into code that v2 rewrites.

## Scope to specify (PM + architect decide the details)

1. Catalog v2, versioned alongside v1 (`DASHBOARD_SUPPORTED_CATALOG_VERSIONS`):
   - layout primitives: section, stack, grid, card
   - input primitives: text, select, radio group, checkbox (bounded options, labels, validation hints)
   - keep the five v1 display kinds
2. A data model with bound paths (A2UI-style `updateDataModel` semantics), so inputs read and write named values.
3. Actions: `submit` (starts an agent turn with the validated values), `change` (updates host state, no turn).
   Every action is allowlisted, bound to session + surface id + revision, and mediated by the host.
4. Stable surface ids with incremental updates (patch a surface or its data model) in addition to full snapshots.
5. Host-owned surface state store (generalises the `DashboardSessionStore` proposed in 494 D4): spec, data model,
   selection, form values, keyed by routing id (`tabId`), bounded.
6. MCP tools for the agent:
   - `ptah_surface_update` - agent -> UI patches
   - `ptah_surface_get_state` - the agent reads the current UI state on demand
   - `ptah_dashboard_propose_spec` stays (or is folded in) - decide.
7. UI -> host RPC channel (`surface:*`), registered in `rpc.types.ts` and `ALLOWED_METHOD_PREFIXES`.

## Constraints and evidence

- Security controls from `TASK_2026_490_583c/research-report.md` Revision 6: action allowlist, Zod validation of every
  value, no `innerHTML`, markdown only through `libs/frontend/markdown`, URL scheme limits, host mediation, operation
  ids for mutations and the timeout rule (Revision 6 item 3).
- The Claude Agent SDK has no LangGraph state object or `Command({ resume })`. Two-way state must be host-owned and
  exposed through MCP tools and RPC (see `TASK_2026_494_ca38/research-property-hub-agent-ui.md` section 6).
- Reference patterns, adapt not copy: `D:\projects\property-hub` - `libs/shared/contracts/agent/src/lib/ui-node.types.ts`
  (primitive tree), `libs/shared/client/agent-chat-ui/src/lib/primitives/surface-form.store.ts` (local form state),
  `ui-action.format.ts` (submit -> turn). property-hub validates only the outer envelope; Ptah keeps per-kind schemas
  and budgets.
- Known 493 defect to fix first or here: `ElectronWebviewManagerAdapter` has no `getActiveWebviews()`, so the
  dashboard push throws on Electron (494 plan Component 7).

## Depends on / unblocks

- Depends on TASK_2026_493_9f58 (merged).
- Unblocks TASK_2026_494_ca38 (revision of D3, D4 and the renderer) and TASK_2026_539_67f5 (chat mount).

## Suggested strategy

FEATURE, Full: project-manager -> software-architect -> team-leader -> backend-developer -> QA.

## Orchestration run (2026-09-23)

- Handed off from session `ptah-ptah-extension-task-494-658c070000njk2pjljpjg07` to session
  `ptah-ptah-extension-task-583-7167d70000njk2pjljpjg08`. Gates run with the user in the second session.
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2`, branch
  `feat/task-538-surface-contract-v2` from `origin/main` 2f798f0d5. Never commit to or merge into main.
- Deliverable at the end: a section in this task folder that says what the TASK_2026_494 architect must change
  (D3 intake, D4 channel, renderer view model).

## Gates

- Gate 0: skipped (scope in this file is specific).
- Gate 1: APPROVED by the user on 2026-09-23 (task-description.md, with the codex lane review applied).
- Gate 1.5: skipped. The open questions in task-description.md go to the architect.
- Gate 2: implementation-plan.md written (17 components, codex lane review applied). The user said "don't wait
  for my approval" on 2026-09-23; taken as the go-ahead for team-leader Mode 1.

## Standing user rule: cross-review (2026-09-23)

"If we asked a CLI tool to do the work, you should spawn a subagent to review the work, and vice versa. Don't wait
for my approval." So: lane-implemented batch -> subagent reviewer (code-logic-reviewer); subagent-implemented batch
-> CLI lane reviewer. Run the review automatically, without a user gate. Requirements and plan already satisfied
this rule (subagent wrote, codex lane reviewed).

## Orchestrator decisions during implementation

- Batch 6 zod-free guard (2026-09-23): the main `@ptah-extension/shared` barrel already reaches zod through three
  pre-existing modules (`lib/providers/provider-registry.ts:20`, `lib/types/origin-sidecar.types.ts:31`,
  `lib/utils/codex-token-freshness.ts:1`). The approved requirement (task-description line 116) only needs the v2
  plain types in a zod-free module. Decision: scope `index.zod-free.spec.ts` to the closure of `surface.types.ts` and
  `surface-catalog.ts`; do not edit the three modules (out of scope). Recorded as a follow-up. The user may override.
- R8 barrel: architect chose a second subpath entry point `@ptah-extension/shared/mcp-apps-contracts/surface`
  (implementation-plan.md appendix "R8 barrel decision").
- Lanes: antigravity and Glm hit quota limits (429); opencode failed twice and was dropped. codex is the only lane.
- Batch 9 read budget (2026-09-24): architect raised `SURFACE_LIMITS.maxStateReadBytes` to 548 KiB and kept the
  U+2028/U+2029 escaping (implementation-plan.md appendix "Batch 9 read-budget decision").
- Batch 14 exports (2026-09-24): to test the real agent/UI round trip per host, approved a narrow production change -
  export `buildSurfaceNamespace` and its `SurfaceNamespace` / `SurfaceCaller` types (and the MCP surface tool-call
  helper if needed) from the `@ptah-extension/vscode-lm-tools` barrel. No `SurfaceRpcHandlers` export; tests use the
  public `RPC_HANDLER_MANIFEST` / `resolveRpcHandlerPlan` seam.
- Session restart (2026-09-24): the earlier subagents were unreachable after the restart; new ones were spawned with
  the same names and continued from the files on disk.

## CLI Lanes

Mode: enabled (Gate 0.1, user answered "yes").

| Agent | Type | Status |
| --- | --- | --- |
| codex | cli | installed |
| antigravity | cli | installed |
| opencode | cli | installed |
| Glm | ptah-cli | available, Ollama Cloud, ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164 |

copilot is disabled, cursor and pi are not installed.

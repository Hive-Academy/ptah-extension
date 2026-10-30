# Context — Setup Hub surfaces on the normal chat session

## Request (user, 2026-10-13)

The Setup Hub surfaces — AI Team Builder, New Project builder and Setup Wizard — keep breaking.
They are a normal chat session plus a small workflow-specific part. They must share the session
tile features (the advanced chat input `ptah-chat-input` and the streaming chat messages) and add
only their own add-ons.

Setup Wizard plans from the user:

1. Extract subagent generation and system-prompt generation out of the overall workspace analysis.
2. Make the workspace-analysis steps tracked so that they survive turns.

## Guiding rule (user-requested)

**Keep and fix, do not delete features.** Every builder and wizard feature is wanted, in
particular the AI Team Builder and the New Project builder. Code that exists but is not wired
(for example the harness AI services `suggest-config`, `design-agents`, `generate-skills`,
`generate-document`, `analyze-intent`) is wired into the builders, not removed. Only duplicated
chat infrastructure (own composer, own transcript, own claim/rehydrate lifecycle, own SDK stream
transport) is replaced by the shared chat pieces. Any removal of a user-visible capability goes
under `## Proposed Removals` for user approval.

## Decisions (user, 2026-10-13)

| #   | Decision                                                             | Answer                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Hotfix the broken AI Team Builder before the larger change?          | **No hotfix.** Fix inside the phased plan.                                                                                                                                                                         |
| 2   | Show setup sessions as normal session tiles (tab bar, session list)? | **Yes, normal tiles** with a workflow tag; the add-on panel shows next to the session.                                                                                                                             |
| 3   | Wizard analysis phases as chat sessions                              | **One chat session per phase**; the manifest records sessionId and status per phase.                                                                                                                               |
| 4   | Generation without an analysis                                       | **Generation must gather all the information it needs itself when no analysis exists or the analysis is old.** Applies to agent generation and the project system prompt. Needs a freshness check on the analysis. |

## Known defects in the AI Team Builder (user-reported, verified 2026-10-13)

1. **No streaming.** `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:121`
   sends live chunks only for tab ids in `visibleTabIds`. The builder correlation id is a claimed
   surface, never a visible tab, so events are retained and not delivered. Started with commits
   `31d47bdfb` (stream delivery per tab visibility) and `ae47429ab` (flush scheduling by visibility tier).
2. **Snapshot events go to the chat store.** `handleStreamSnapshot`
   (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:530-543`) applies snapshot
   events by tab id without the claim check that the live-chunk path does (`renderedSurfaceFor`, `:344`).
3. **"Apply to Workspace" shows nothing.** `applyConfig`
   (`libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:853`) discards
   the `HarnessApplyResponse`; no success state, no written-file list. The apply works: it ran 3 times
   and wrote `seshat/.claude/CLAUDE.md`.

Defects 1 and 2 come from the parallel surface path; a real tab removes them. Defect 3 is an add-on
defect and must be fixed in phase 2.

## Phases (child tasks)

| Phase | Task               | Scope                                                                                                                                                                                             |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | TASK_2026_648_374e | Shared `ptah-session-embed` (canvas-tile injector recipe + `ng-content` header/panel slots), `Tab.workflow` tag, session-scoped and persisted `ptah_harness_propose_config` proposals.            |
| 2     | TASK_2026_649_33c4 | AI Team Builder + New Project on normal tabs; fix defects 1-3; wire the unused harness AI services as add-on actions or agent tools; keep intake, stack profile, preview, Apply, presets, health. |
| 3     | TASK_2026_650_2c78 | Wizard plan 1: agent generation and system-prompt generation as independent workflows; self-gather context when analysis is missing or stale.                                                     |
| 4     | TASK_2026_651_2fb8 | Wizard plan 2: one chat session per analysis phase; `.ptah/analysis/<slug>/manifest.json` gains sessionId, attempt, input fingerprints and verification status per phase (new manifest version).  |

Keep `WorkflowSessionClaimService` and `StreamingSurfaceRegistry`: Tribunal and the Apps page use them.

## Research (read before planning)

- `research/team-and-project-builder-analysis.md` — builder flow, duplicated chat pieces, 12 fragility points, preserve list.
- `research/setup-wizard-analysis.md` — wizard flow, existing checkpoint manifest, plan 1 and plan 2 proposals.
- `research/chat-session-reuse-points.md` — session tile anatomy, embed blockers, extension points, 12 gaps.

Note: the "Proposed Removals" tables in the research predate the keep-and-fix rule. Treat any
feature listed there as **wire, not delete**; only duplicated chat infrastructure may go.

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: The epic stays open only for its remaining children: TASK_2026_651 (analysis phases as tracked chat sessions), TASK_2026_680 (sidebar opens builder page) and TASK_2026_682 (649 review leftovers).
- Evidence on main: Phase 1 TASK_2026_648 is done; phase 2 TASK_2026_649 merged in PR #736 (01cc3bc2a builders on shared chat); phase 3 TASK_2026_650 merged in PR #763; manifest v4 + freshness + self-gathering generation merged in PR #732 (TASK_2026_652). Children TASK_2026_651, TASK_2026_680, TASK_2026_682 are still backlog.

# Implementation Plan - TASK_2026_677_efcd (clean session view) - integration document

This document merges four part plans into one build order. It owns: cross-part contracts, file ownership,
seam resolutions, batch order, decisions applied, the TASK_2026_648 hook-up and the deviation list for Gate 2.
Per-component detail stays in the parts (Appendices). Where this document and a part disagree, THIS document wins;
every override is listed in §6.3.

Root for every relative path: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`.
Frontend only. No backend, no new stored field, no new lane type, no new Nx project, no new spec file.

## 1. Inputs and constraints

- Requirements used: `context.md`, `task-description.md` (reqs 1-19), `design-spec.md` (§2-§9, D1-D43),
  `parity-inventory.md` (A-, B-, C-, D-, E- rows), `decisions.md` rows 1-44, `handoff-3.md` §3 and §3.4.
- Part plans (appendices, by reference): A1 turn, A2 header/composer/motion, B inspector, C agents.
- Corrections applied: decisions rows 32, 38, 43, 44 (USER / Gate 1.7), and the 648 embed contract (row 42).
- Design handoff used: `design-spec.md`, `prototype/` (not re-read here; the parts cite it).
- Missing decision-critical input: none. Rows 43 and 44 settled the two user items the parts left open.
- Build constraints (repeat in every executor prompt): Claude frontend-developer sub-agents build; CLI lanes only
  review. Angular 22 (`package.json:97`): standalone, OnPush, signals, `input()`/`output()`, `inject()`. Icons from
  `lucide-angular`; CLI marks via `ptah-provider-mark`. Imports only through lib `index.ts` aliases; canvas -> chat
  direction only (chat never imports canvas). 677 never edits `tab-bar`, `tab-item`, `canvas-rail-card`, `app-shell`,
  `canvas-detail-transcript`.

## 2. Component and contract map

### 2.1 Components per lib (owner part)

| Lib | New / changed unit | Kind | Owner |
| --- | --- | --- | --- |
| chat-ui | `agent-avatar/` types, `agent-status.ts`, `agent-duration.ts`, `agent-marks.ts`, `ptah-agent-avatar` | CREATE | C §1 |
| chat-ui | `formatTokenCount`, `formatCostUsd` extracted from token/cost badges | MODIFY (behaviour-preserving) | A1 §chat-ui formatters |
| chat-ui | `AutopilotPopoverComponent` trigger re-skin | MODIFY | A2 §5 |
| ui | monogram helpers on the `monogram-tile` barrel | MODIFY | C §3 |
| chat | `session-agents/` roster builder, `SessionAgentRosterService`, `owned-by-session.ts` | CREATE | C §2 |
| chat | `compact-lane-rows.ts` `laneStatus` delegates to the shared mapping | MODIFY | C §4 |
| chat | `session-inspector/` types, requests merge, `SessionInspectorStore`, `InspectorOpenStateService`, `InspectorShellController` | CREATE | B §3-4 |
| chat | `tokens/session-workflow-addons.token.ts` (§7.2) | CREATE | B (this doc §7) |
| chat | `session-git-stats.store.ts`: `branch` in `known` state + `sessionBranch()` helper | MODIFY | B (seam §3.2) |
| chat | `organisms/session-inspector/` component tree + `session-task-reader` | CREATE | B §5-6 |
| chat | `molecules/session-header/session-header.component.ts` | CREATE | A2 §1 |
| chat | `chat-input.component.ts` composer chips | MODIFY | A2 §5 |
| chat | `utils/turn-facts.utils.ts`, `utils/turn-answer-split.utils.ts` | CREATE | A1 §1-2 |
| chat | `molecules/turn/` disclosure row, activity panel, live line, agent chips | CREATE | A1 §3-6 |
| chat | `message-bubble.component.*` assistant branch, `chat-transcript.component.*` | REWRITE / MODIFY | A1 §7-8 |
| chat | `chat-view.component.{html,ts,css}` | MODIFY (shared, serialized §3.1) | B -> A2 -> A1 |
| chat-streaming | `message-finalization.service.ts` start timestamp (A1-D1) | MODIFY | A1 §10 |
| tasks-ui | secondary entry `@ptah-extension/tasks-ui/presentation`, tasks-changed feed | CREATE / MODIFY | B §2 |
| canvas | `canvas-lane-tabs` rewritten as the agent dock; dock card, dock menu, `dock-overflow.ts` | REWRITE / CREATE | C §5-6 |
| canvas | `lane-owner.ts` DELETED (moved to chat); 3 importers re-pointed | DELETE / MODIFY | C §2.4 |
| canvas | Rail board asides host `ptah-session-inspector`; `canvas-session-details` DELETED | MODIFY / DELETE | B §8 |
| webview app | per-theme status-ink tokens, tailwind, `state-ink-contrast.spec.ts`, `app.config.ts` | MODIFY | B §1 |

chat-state and core: no change.

### 2.2 Shared contracts (exact signatures)

C1. `ptah-agent-avatar` (chat-ui, `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts`),
standalone, OnPush, `host: { 'aria-hidden': 'true' }`, no outputs (Part C lines 174-178):

```ts
kind      = input.required<AgentKind>();            // 'orchestrator' | 'subagent' | 'cli' | 'background'
status    = input<AgentStatusWord | null>(null);    // 'running'|'waiting'|'done'|'failed'|'stopped'|'queued'
size      = input<AgentAvatarSize>(28);             // 24 | 28 | 32
cliId     = input<string | null>(null);             // -> cliMarkFor() -> ptah-provider-mark or monogram
agentType = input<string | null>(null);             // -> roleIconFor() -> lucide icon, fallback Bot
```

Also exported from `@ptah-extension/chat-ui`: `AGENT_KIND_LABEL`, the four `*StatusWord` mappers,
`formatAgentDuration(ms): string | null`, `agentAccessibleLabel(...)`, `cliMarkFor`, `roleIconFor`
(Part C lines 125-173). Consumers: A1 chips (size 24), B AGENTS rows (32), C dock (28).

C2. `SessionAgentRosterService` (chat, `@Injectable({ providedIn: 'root' })`, Part C lines 259-269):

```ts
roster(tabId: string | null): readonly SessionAgent[];        // plain signal-reading method; callers wrap in computed
requestsForTab(tabId: string | null): { permissions: readonly PermissionRequest[];
                                        questions: readonly AskUserQuestionRequest[] };
interface SessionAgent { key; kind: AgentKind; name; cliId: string|null; agentType: string|null;
  status: AgentStatusWord|null; startedAt: number|null; endedAt: number|null; activity: string|null;
  openRequestIds: readonly string[] }                            // order: Orchestrator, sub-agents, CLI, background
```

Unknown tab -> Orchestrator only, status `null`. `ownedBySession` exported unchanged from `@ptah-extension/chat`.

B1. `InspectorShellController` (chat, `@Injectable()`, provided by `ChatViewComponent` and
`CanvasRailBoardComponent`; Part B lines 278-294):

```ts
attach(shell: HTMLElement, opener: () => HTMLElement | null, title: () => HTMLElement | null): void;
band: Signal<'docked' | 'sheet' | 'full-sheet'>;  isOpen: Signal<boolean>;  isModal: Signal<boolean>;
showDot: Signal<'need' | 'sel' | null>;            toggleLabel: Signal<string>;
toggle(): void;  closeInsp(target?: HTMLElement | 'opener'): void;  onTabChanged(): void;
```

Amendment (settles A2 O1c): `showDot()` returns `null` while `isOpen()`; A2 binds it directly and adds no guard.

B2. `SessionInspectorStore` (chat, root): `modelFor(tabId: string): Signal<SessionInspectorModel>`;
`SessionInspectorModel.needsYouCount: number` (unique open request ids + `waiting` roster lanes with no open
request) and `.orchestrator.state: OrchestratorState` (Part B lines 190-226). Callers guard a null tab id.

A1 consumption (settles A1 open checks 3 and 8):

- Per-turn agent chips: A1 drops its own `TurnAgentChip` type and the `providerId` field. `chat-transcript` reads
  `roster = computed(() => rosterService.roster(tabId()))` once and gives each turn the roster entries whose `key`
  matches an agent node of that turn's tree: `laneKey('subagent', node.toolCallId)` and
  `laneKey('background', node.toolCallId)`. CLI lanes are not turn-scoped (no verified turn link) and show only in
  the dock and inspector. Chip avatar binds `kind`, `status`, `cliId`, `agentType` from `SessionAgent`. Implementer
  check: the agent node field that equals `SubagentRecord.parentToolUseId` (today's `openSubagentLane(key)`,
  `chat-transcript.component.ts:769-791`, already builds this key; reuse it).
- Needs-you: `chat-transcript` binds `[needsYouCount]` from `inspectorStore.modelFor(tabId)().needsYouCount` for the
  live turn only (`0` when there is no tab).
- Duration text: A1 drops `formatTurnElapsed` and uses `formatAgentDuration` (Part C line 16: one formatter). A
  `null` result (under 1 s) renders the label `Worked` / `Working`, which §3.9 already defines for "not derivable".

## 3. File ownership

Each file has exactly one owning batch (batch ids in §5), with two named exceptions: the chat-view chain (§3.1)
and the three shared barrels (§3.2 "Shared barrels"). Every other file in §3.3 has one batch.

### 3.1 Shared file `chat-view.component.{html,ts,css}` (serialized)

| Batch | Owner | Edits |
| --- | --- | --- |
| CV-1 | B | Root `<div class="cs-shell ...">` + `container-type: inline-size` (css); `[attr.inert]` on the main column; inspector `@if` / `@defer (on immediate)` block with `id="inspector"` on its aside; `[attr.data-request-id]` on `ptah-question-card`; `providers: [InspectorShellController]`; `hostsInspector`, `hasLaneSurface`, tab-feed effect calling `onTabChanged()`, `openLaneFromInspector`, `focusQuestionCard`; `controller.attach(...)` in `afterNextRender` with lazy opener/title getters (B §7 a-e). No `[inspectorSection]` re-projection (§7.3). |
| CV-2 | A2 | **Compact-card retirement (the ONE owner of A-6 / A-16):** `showCompactCard` narrows to `this._forcedCard?.() ?? false` (`chat-view.component.ts:974-978`) so compact view renders the transcript; the forced Rail card path (A-5) is untouched; `expandToFullView` stays only if the forced branch still binds it. Header block (A2 binding contract) at the top of the transcript branch; add-on outlets in the header slots (§7.2); stagger effect keyed on `resolvedTabId`, `playEnter()` in `afterNextRender` with the one `.st-t` index pass (`--i = min(k+1, 8)`, DOM order), timer release; `ptahStaggerUp` on `.st-t` and reduced-motion block (css) (A2 §4, Decision A2-3; the `.st-t` hooks come from A1-3); composer wrapper `st-f`. |
| CV-3 | A1 | None expected (A1 binds in `chat-transcript`). Any chat-view binding A1-B3 discovers lands here, after CV-2. |

Settles A2 O2: the compact card no longer replaces the transcript, so the header always renders above the one
branch. chat-view specs (`chat-view.component.spec.ts`, `.dock`, `.keepalive`, `.memo`) are updated by the batch
whose edit breaks them.

### 3.2 Other seams

- `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts` and its spec: **B-3**. Adds
  `branch: string | null` to the `known` state from `result.branch.branch` in `toState` (`:55-70`) and the exported
  pure `sessionBranch(tab, gitState)` (A2-4 rule). B's GIT section (`GitSectionData.branch`) and A2's header/composer
  both read it. A2 never starts git tracking.
- **Shared barrels (named exception, serialized).** Rule for each: append-only export lines; a batch never edits,
  reorders or deletes another batch's lines; owners run in the order below, never in parallel with each other.
  §5 dependencies force every order (each later owner depends, directly or transitively, on the earlier one).

  | Barrel | Serialized owners | Lines added | Order forced by (§5) |
  | --- | --- | --- | --- |
  | `libs/frontend/chat-ui/src/index.ts` | C-1 -> A1-1 -> A2-2 | C-1 avatar vocabulary; A1-1 formatters; A2-2 popover export only if needed (expected none) | A1-1 depends on C-1; A2-2 depends on A1-1 |
  | `libs/frontend/chat/src/lib/services/index.ts` | C-2 -> B-3 | C-2 roster, `ownedBySession`; B-3 session-inspector barrel, `sessionBranch` | B-3 depends on C-2 |
  | `libs/frontend/chat/src/index.ts` | C-2 -> B-3 -> B-4 | C-2 roster; B-3 token file; B-4 `SessionInspectorComponent` (Rail board) | B-3 depends on C-2; B-4 depends on B-3 |

  Why serialization rather than one final barrel batch: every order above is already forced by a code dependency
  except A2-2 -> A1-1, and that edge costs nothing (A1-1 sits at order 2, A2-2 at order 4), so the critical path is
  unchanged. A single barrel batch at the end would leave C-2, B-3 and B-4 unable to expose what their own consumers
  and specs import through the public alias until the end, which breaks per-batch typecheck. A2-1 touches no barrel
  (canvas does not need the header; Rail keeps `canvas-focus-header`).
- `libs/frontend/chat/src/lib/components/index.ts`: B-4 only (single owner). 648 also appends here (rebase conflict,
  keep both lines).
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`: C-3 only (one binding,
  `sessionId` -> `tabId`). Part B does not touch it (settles C open check 4; absent from Part B file list,
  lines 616-639).
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`: B-5 only (details-button gate). 648
  Batch 3 adds its workflow badge here: rebase conflict, keep both.
- `compact-lane-rows.ts`: C-2 changes `laneStatus` only; B reads `buildLaneSummary` unchanged.

### 3.3 File list per batch

| Batch | Files (CREATE / MODIFY / DELETE) | Part ref |
| --- | --- | --- |
| C-1 | C: `chat-ui/src/lib/atoms/agent-avatar/{agent-avatar.types,agent-status,agent-duration,agent-marks,agent-avatar.component}.ts`; M: `chat-ui/src/index.ts` (shared barrel 1st, §3.2), `ui/src/lib/native/monogram-tile/index.ts` | C §1, §3 |
| C-2 | C: `chat/src/lib/services/session-agents/{session-agent-roster,session-agent-roster.service,owned-by-session}.ts`; M: `chat/src/lib/services/index.ts` + `chat/src/index.ts` (shared barrels 1st, §3.2), `chat/.../compact-session/compact-lane-rows.ts` | C §2, §4 |
| B-1 | M: `apps/ptah-extension-webview/src/styles.css`, `tailwind.config.js`, `src/app/state-ink-contrast.spec.ts` | B §1 |
| B-2 | C: `tasks-ui/src/presentation.ts`, `tasks-ui/src/lib/{tasks-changed,task-stage}.ts`, `tasks-ui/src/lib/services/tasks-changed-feed.service.ts`; M: `tsconfig.base.json`, `tasks-ui/.../tasks-store.service.ts` | B §2 |
| A1-1 | C: `chat/src/lib/utils/{turn-facts,turn-answer-split}.utils.ts`; M: `chat-ui/src/lib/atoms/{token-badge,cost-badge}.component.ts`, `chat-ui/src/index.ts` (shared barrel 2nd, §3.2) | A1 §1-2, formatters |
| A1-4 | M: `chat-streaming/src/lib/message-finalization.service.ts` (+ its spec if asserting `Date.now()`) | A1 §10 |
| A2-2 | M: `chat/.../molecules/chat-input/chat-input.component.ts` (+ spec), `AutopilotPopoverComponent` file in chat-ui (+ spec); `chat-ui/src/index.ts` only if a new export is needed (shared barrel 3rd, §3.2) | A2 §5 |
| B-3 | C: `chat/src/lib/services/session-inspector/{session-inspector.types,session-inspector-requests,session-inspector.store,inspector-open-state.service,inspector-shell.controller,index}.ts`, `chat/src/lib/tokens/session-workflow-addons.token.ts`; M: `session-git-stats.store.ts` (+ spec), `chat/src/lib/services/index.ts` + `chat/src/index.ts` (shared barrels 2nd, §3.2), `apps/ptah-extension-webview/src/app/app.config.ts` | B §3-4, §7 here |
| A2-1 | C: `chat/src/lib/components/molecules/session-header/session-header.component.ts` | A2 §1 |
| C-3 | R: `canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` (+ spec); C: `canvas-detail/{agent-dock-card,agent-dock-menu}.component.ts`, `dock-overflow.ts`; M: `canvas-rail/canvas-focus-area.component.ts`, `canvas-detail/canvas-lane-view.component.ts`, `canvas-needs-you-queue.ts`; D: `canvas-detail/lane-owner.ts` | C §5-6 |
| A1-2 | C: `chat/src/lib/components/molecules/turn/{turn-disclosure-row,turn-activity-panel,turn-live-line,turn-agent-chips}.component.ts` | A1 §3-6 |
| B-4 | C: `chat/src/lib/components/organisms/session-inspector/{session-inspector.component.ts,.html,inspector-orchestrator-card,inspector-agents-section,inspector-request-panel,inspector-task-section,inspector-todos-section,inspector-git-section,session-task-reader}`; M: `chat/src/lib/components/index.ts` (single owner), `chat/src/index.ts` (shared barrel 3rd, §3.2) | B §5-6 |
| A1-3 | REWRITE assistant branch: `chat/.../organisms/message-bubble.component.{ts,html,css}` (+ spec), including the stagger hook class `st-t` (class only, no `--i`) on the five turn items: user `<article aria-label="You">`, `ptah-turn-disclosure-row` host, `.cs-answer`, `ptah-turn-agent-chips` host, action-row wrapper (A2 §4); M: `chat/.../transcript/chat-transcript.component.{ts,html}` (+ specs) | A1 §7-8 |
| CV-1, CV-2, CV-3 | `chat/src/lib/components/templates/chat-view.component.{html,ts,css}` + chat-view specs (§3.1) | B §7, A2 §2/§4, A1 §11 |
| B-5 | M: `canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` (+ spec), `canvas-rail/canvas-focus-header.component.ts`; D: `canvas-detail/canvas-session-details.component.ts` + `.spec.ts` | B §8 |

`app.config.ts` moves from B's component list into B-3 (only file with a provider change; B line 628). Any canvas
barrel (`canvas/src/index.ts`) export of `CanvasSessionDetailsComponent` is removed in B-5 (implementer greps).

## 4. Open checks: settled or routed

| # | Check | Result |
| --- | --- | --- |
| A2 O1 | B aside `id`, `st-r` rows, dot precedence, branch owner | settled: aside `id="inspector"` (CV-1); `st-r` + `--i` on inspector rows (B-4); `need` > `sel`, null while open (§2.2 B1 amendment); branch -> B-3 (§3.2). |
| A2 O2 | Header above the compact card? | settled: compact swap removed in CV-2 (§3.1); one branch, header on top. |
| A2 O3-O7 | popover path, Stop/Send, stagger hooks, grid host, slot projection | for implementer as written in A2 Open checks. O5 now: `.st-t` hooks present and never nested (A2-3 replaced `nth-last-child`). O4: keep both Stop and Send (no capability removal). O6: grid tiles provide `SESSION_CONTEXT` per 648 embed (`session-embed.component.ts:78` on the 648 branch) -> no main header per tile once rebased; check `app-shell.component.html:553` on main. O7 superseded by §7.3. |
| A1 3 | Per-turn agent status source | settled: §2.2 "A1 consumption" (roster filtered by turn agent keys). |
| A1 8 | Needs-you count | settled: `SessionInspectorStore.modelFor(tabId)().needsYouCount` (B lines 190, 225). |
| A1 4 | Assistant `Claude` + time header removal | settled: approved by the USER (decisions row 45, §8 R1); parity row added. |
| A1 1, 2, 5, 9, 10, 11 | turn grouping, `message_start` id, copy button, user-time contrast, caret, compaction turn | for implementer as in A1 lines 319-349. 9 escalates to the user only if contrast fails. |
| C 1 | lucide icon data type name | settled: `LucideIconData` (`node_modules/lucide-angular/icons/types/index.d.ts:5`, `export declare type LucideIconData = readonly LucideIconNode[]`); repo idiom `import type { LucideIconData } from 'lucide-angular'` (`libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.ts:10`). |
| C 2 | Hover card clipping at 400 / 760 px | for visual review: Rail at 400 and 760 px and a split pane; card must flip or clamp inside the pane. |
| C 3 | `paused` -> `queued` | for code-logic reviewer (Decision C4, Assumption A3). |
| C 4 | Part B in `canvas-focus-area` | settled: no (§3.2). |
| B O1 | Roster API | settled: §2.2 C2. |
| B O2 | `PermissionRequest.agentToolCallId` | settled: `libs/shared/src/lib/types/permission.types.ts:58` (`readonly agentToolCallId?: string`). |
| B O3 | `ng-content` inside `@defer` | settled by removal: no re-projection; registry outlets (§7.3). |
| B O4 | Stage-ladder names in `DOC_FILES` | for implementer: `task-spec.contract.ts:74-96`. |
| B O5 | tasks-ui secondary entry | settled: the existing secondary entry `@ptah-extension/tasks-ui/services` is declared only in `tsconfig.base.json:106-107`; `/presentation` follows it. Implementer greps jest configs for `tasks-ui/services` to mirror any mapper. |
| B O6 | git refresh method, `Review changes` opener | for implementer: `session-git-stats.store.ts:93-160`; fallback untrack + track. |
| B O7 | latest-`TodoWrite` locator | for implementer: move verbatim from `canvas-session-details.component.ts:125-143` before B-5 deletes it (B-4 copies, B-5 deletes). |
| B O8 | focus-header details gate | for implementer (B-5): `canvas-focus-header.component.ts:55-70`. |
| B O9 | Rail `answerRequested` forwarding | for implementer (B-5): `canvas-detail.service.ts`; accepted degradation otherwise. |
| B O10 | Tab field names | settled in part: `TabState.claudeSessionId` (`libs/frontend/chat-types/src/lib/chat-types.ts:608`); `workspacePath` is NOT a TabState field there -> read `findTabByIdAcrossWorkspaces(tabId)?.workspacePath` as A2 lines 104-107 do. |
| B O11 | chat-view CSS location | settled: `styleUrl: './chat-view.component.css'` (`chat-view.component.ts:247`). |
| B O12 | bundle headroom | settled by row 43: BUILD-1 in §5. |

## 5. Batch order (advisory for the team-leader)

| Order | Batch | Depends on | Parallel-safe with |
| --- | --- | --- | --- |
| 1 | C-1 avatar vocabulary (chat-ui, ui) | - | B-1, B-2, A1-4 |
| 1 | B-1 status-ink tokens (webview app) | - | C-1, B-2, A1-4 |
| 1 | B-2 tasks-ui `/presentation` | - | C-1, B-1, A1-4 |
| 1 | A1-4 finalization timestamp (chat-streaming) | - | C-1, B-1, B-2 |
| 2 | C-2 roster (chat) | C-1 | A1-1 |
| 2 | A1-1 turn utils + formatter export | C-1 (shares `chat-ui/src/index.ts`, uses `formatAgentDuration`) | C-2 (disjoint files) |
| 3 | B-3 inspector services + token + git branch | C-2 | C-3, A2-1 |
| 3 | C-3 agent dock (canvas) | C-2 | B-3, A2-1, A1-2 |
| 3 | A2-1 session header | - | B-3, C-3 |
| 4 | A2-2 composer chips | B-3 (`sessionBranch`), A1-1 (shared barrel `chat-ui/src/index.ts`, §3.2) | A1-2, B-4 |
| 4 | A1-2 turn molecules | A1-1, C-1 | B-4, A2-2 |
| 5 | B-4 inspector component tree | B-2, B-3, C-1 | A1-3 |
| 5 | A1-3 bubble + transcript | A1-2, C-2, B-3 | B-4 |
| 6 | CV-1 (B) chat-view shell + inspector host | B-4 | - |
| 7 | CV-2 (A2) header, motion, compact-card retirement | CV-1, A2-1, A1-3 (`.st-t` stagger hooks) | - |
| 8 | CV-3 (A1) chat-view leftovers (expected empty) | CV-2, A1-3 | - |
| 9 | B-5 Rail board inspector (last Part B batch) | B-4, C-3, CV-1 | - |
| 10 | BUILD-1 one webview build (row 43) | all batches | - |

A2-2 waits for B-3 because the composer branch hint reads `sessionBranch`. Batches sharing a barrel (§3.2) are never
parallel: C-1/A1-1/A2-2, C-2/B-3, C-2/B-3/B-4 run in that order (no "Parallel-safe" cell pairs them). B-5 is placed last on purpose:
it is the last Part B batch, so the one build allowed by row 43 measures the complete eager delta (B ~10 kB, A2
header ~2-3 kB, C avatar, A1 molecules). Parallel batches touching the same Nx project still run their heavy checks
one at a time (§9).

## 6. Decisions applied

### 6.1 User and Gate decisions

- Row 43 (USER): BUILD-1, once, after B-5:
  `node .ptah/tmp/check-run.mjs bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`.
  Pass = no budget error against `maximumError: "3.5mb"` (`apps/ptah-extension-webview/project.json:61`) and the
  component-style error budget at `:66` (`20kb`; `chat-view.component.css` is 3.5 kB today and gains keyframes and
  container rules). Record the initial-bundle size in the batch report. Fail -> move the largest new eager unit
  behind `@defer` (candidates: B-4 is already deferred; next the turn activity panel, opened on demand) and rebuild
  only with a new user approval. No other build/serve target.
- Row 44 (USER): TASK section with no linked task renders NOTHING (D27; B-8 already implements it). Req 17.6 text
  `No task linked to this session` is SUPERSEDED; an unknown lead task also renders no section. The orchestrator
  aligns `task-description.md` req 17.6 (PM-owned file; not edited by this plan).
- Row 32 (USER): tool-call / action rows inside the work log render exactly as today. A1-D6 renders each root child
  through the unchanged `ptah-execution-node` with the inputs of the root `'message'` case; no restyle of tool rows,
  no change to `execution-node` or tool components. Reviewers reject any diff in tool-row templates or styles.
- Row 38 Moderate 1: ONE dot. `showDot()` = `'need'` (`bg-state-need`) when `needsYouCount > 0`, else `'sel'`
  (`--sel`) when the tab's initial-open is `true`, else `null`; `null` while open. Dot is `aria-hidden`; the toggle's
  accessible name never changes with the dot.
- Row 38 Moderate 2, and the one contract for §3.8 / §8.3 / initial-open (B §4 rules 1-5 are the text of record):
  - Docked (shell >= 960 px): `open = manual ?? (initialOpen ?? viewMode === 'full')`; `manual = {open, mode}` per
    tab in memory, ignored when `mode` differs (mode change resets). Tab switches restore the per-tab choice.
  - Overlay (< 960 px): the modal sheet is closed on load, on EVERY tab or session switch (`onTabChanged()` ->
    `closeInsp()`), and on resize into the band; it never reopens by itself, also not for workflow tabs; it opens only
    by toggle; sheet state is never written to the per-tab docked choice (B-4). Workflow tabs show the `sel` dot.
  - Resize overlay -> docked with the sheet open writes `manual = {open: true, mode}`.

### 6.2 Cross-part decisions made here

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| M-1 | A2 owns compact-card retirement in CV-2; forced Rail card kept | A1 owns it in CV-3 | header placement (A2 O2) depends on it; `showCompactCard` = forced OR compact (`chat-view.component.ts:974-978`), A-5 needs the forced half | yes |
| M-2 | `session-git-stats` branch field owned by B-3 | A2-1 owns it | B's GIT section and A2 header both read it; B batch lands first | yes |
| M-3 | Initial-open and add-ons resolve the tab's workflow kind through one chat helper `sessionWorkflowKind(tab)` (returns `null` on main); the `inspectorInitialOpen` input of Part B Decision B-5 is dropped | keep the input | main panel is `<ptah-chat-view />` with no bindings (`app-shell.component.html:829`, off-limits); the 648 embed creates ChatView through `*ngComponentOutlet` with no inputs and provides `SESSION_CONTEXT`, so chat-view hosts no inspector there | yes |
| M-4 | Workflow add-ons register through a multi-provider token (§7.2); no `[inspectorSection]` / header re-projection through ChatView | `ngComponentOutletContent`; keep re-projection | no host can project into ChatView (M-3 evidence); B O3 unverified; row 42 prefers the registry | yes |
| M-5 | Header stays presentational (A2 inputs); chat-view provides and binds the controller | header injects the controller (B line 295) | A2 §1; the header renders only in chat-view | yes |
| M-6 | One duration formatter `formatAgentDuration`; A1 `formatTurnElapsed` dropped | two formatters | Part C line 16, same §3.9 rule | yes |

### 6.3 Overrides of part text

A1: `TurnAgentChip`, `formatTurnElapsed`, A1-B5 compact-card removal (-> CV-2); A1 line 141 "user branch: NO other
change" now allows the `st-t` class on the user `<article>` (A2-3 hook, §3.3 A1-3). A2: `inspectorDot` guard (-> B1
amendment), slot re-projection from ChatView (-> §7.2 outlets). B: Part B Decisions B-5 input (-> M-3) and B-6 projection (-> M-4),
"648 binds in session-embed" (-> §7.4), `app.config.ts` placement (-> B-3). C: none.

## 7. TASK_2026_648 integration

### 7.1 Facts (648 branch `feat/task-648-session-embed`, Batch 2 `db30cc25d`, local, no PR)

- `ptah-session-embed` (`libs/frontend/chat/src/lib/components/templates/session-embed.component.ts` on that
  branch): template `<ng-content select="[sessionHeader]" />`, `*ngComponentOutlet="chatView; environmentInjector:
  childInjector"`, `<ng-content select="[sessionAddon]" />` (lines 40-44); child injector provides `SESSION_CONTEXT`
  (line 78), `SESSION_VISIBLE`, `SESSION_FOCUSED`, `RAIL_MIN_CONTENT_WIDTH`, `SESSION_START_GUARD`, `SURFACE_ACTIVE`,
  `SESSION_CARD_ACTIONS` (lines 76-98).
- 648 `TabState.workflow?: WorkflowKind` (`chat-types.ts:605` on that branch); `WorkflowKind` at `:873`.
- 648 non-spec edits in 677's libs so far: `canvas-detail-transcript.component.ts`, `chat/.../components/index.ts`,
  `session-embed.component.ts`. Batch 3 will add `forgetWorkflowSession` to app-shell and chat-view and a workflow
  badge in `canvas-focus-header`.
- Consequence: inside any embed `SESSION_CONTEXT` is set, so `hostsInspector()` is false; the inspector there is the
  Rail board aside (B-5) and the header is `canvas-focus-header`. ChatView content projection is unreachable.

### 7.2 Registry token (created in B-3)

File `libs/frontend/chat/src/lib/tokens/session-workflow-addons.token.ts`, exported from `@ptah-extension/chat`:

```ts
export type SessionAddonSlot = 'inspectorSection' | 'sessionHeaderChip' | 'sessionHeaderAction';
export interface SessionWorkflowAddon {
  readonly workflowKind: string;      // H2 narrows to WorkflowKind after the rebase
  readonly slot: SessionAddonSlot;
  readonly component: Type<unknown>;  // must declare tabId = input.required<string>()
}
export const SESSION_WORKFLOW_ADDONS =
  new InjectionToken<readonly SessionWorkflowAddon[]>('SESSION_WORKFLOW_ADDONS');
export function sessionWorkflowKind(tab: TabState | null | undefined): string | null; // null on main (H1)
```

- Registration (649, in the webview `app.config.ts`): `{ provide: SESSION_WORKFLOW_ADDONS, multi: true, useValue:
  { workflowKind, slot, component } }`. 677 registers nothing.
- Rendering: `ptah-session-inspector` injects the token `{ optional: true }` and renders matching `inspectorSection`
  entries with `*ngComponentOutlet="a.component; inputs: { tabId }"` after the Orchestrator card and before AGENTS
  (row 35 anatomy: section label, `p-4`, 304 px content, >= 24 px targets, <= 1 primary button). chat-view renders
  `sessionHeaderChip` / `sessionHeaderAction` entries the same way inside the header's two `ng-content` slots
  (`ngProjectAs`; header slots are eager, so plain projection works, A2 O7). Empty list -> nothing rendered.
- Rail: the board aside's inspector uses the same lookup, so a workflow tab shows its section in every host.
- Failure: no tab, no kind, or no match -> no outlet. A registered component that throws is the add-on's defect;
  677 adds no error boundary (none exists in the repository for outlets).

### 7.3 What 677 does not build

No `[inspectorSection]` re-projection through ChatView and no `ngComponentOutletContent`. 677 does not touch
`tab-bar`, `tab-item`, `canvas-rail-card`, `app-shell`, `canvas-detail-transcript`, `session-embed`.

### 7.4 One-line hook-ups after 677 rebases onto main once 648 merges

- H1 `session-workflow-addons.token.ts`: `sessionWorkflowKind` body -> `return tab?.workflow ?? null;`. This alone
  turns on workflow initial-open in chat-view (docked default open, `sel` dot) and in the Rail board controller, and
  add-on lookup in both hosts.
- H2 same file: `workflowKind: string` -> `workflowKind: WorkflowKind` (import from `@ptah-extension/chat-types`).
- H3 conflict resolution only, keep both sides: `chat-view.component.ts` (648 `forgetWorkflowSession`),
  `canvas-focus-header.component.ts` (648 badge vs B-5 gate), `chat/src/lib/components/index.ts` (exports).
- The orchestrator tells the 648/652 session: register 649 sections through `SESSION_WORKFLOW_ADDONS`; the embed's
  `[sessionHeader]` / `[sessionAddon]` slots stay theirs.

## 8. Spec deviations for the Gate 2 reviewer

D-A2-2 (whole-slot stagger) is withdrawn after its Gate 2 rejection: the stagger now follows design-spec §7.1 row 2
per item in DOM order with the capped delay (A2 Decision A2-3). The trigger stays `resolvedTabId` (the active tab
identifies the active session; `resolvedSessionId` flips null -> id on first send, `chat-view.component.ts:798-807`),
which the reviewer accepted, so it is no deviation.

| # | Spec ref | Plan choice | Reason | Removal? |
| --- | --- | --- | --- | --- |
| D-A2-1 | §5 item 1 (sidebar toggle in header) | not in `ptah-session-header` | sidebar state is private to app-shell (`app-shell.component.ts:245-246`); `ptah-sidebar-tab` keeps toggling | no (control stays) |
| D-A1-2 | §3.9 (E needs every duration) | `E = max(timestamp + duration)` over messages with both finite | live finalization puts `duration` only on the last root (`message-finalization.service.ts:215-239`); equals spec whenever spec is derivable | no |
| D-A1-1 | §3.9 / criterion 8 (live = reload) | finalization passes the message-start timestamp (`message-finalization.service.ts:228-240`, default `Date.now()` at `factories.ts:37`) to match history (`history-message-builder.service.ts:216`) | without it "Worked for" changes after reload | no (fix) |
| D-C-1 | E-2 / req 18.5 | orchestrator avatar ALWAYS neutral lucide `Workflow` | no session-provider field exists (rows 33, 37); user row 31 asked for the provider mark: reviewer confirms rows 33/37 govern; reversible by one input (C1) | no; touches USER row 31 |
| D-C-2 | E-5 (label `cli`) | dock shows `displayName || cli` | same rule as `compact-lane-rows.ts:68`; spec examples | no |
| D-C-3 | §3.5 / §4.7 | sub-agent `pending` and `paused` -> `queued` | `waiting` carries needs-you urgency; code-logic reviewer checks `paused` | no |
| D-C-4 | E-3 | `lane-owner.ts` deleted, `ownedBySession` moved to chat unchanged | every importer re-pointed: `canvas-lane-tabs.component.ts:21`, `canvas-lane-view.component.ts:35`, `canvas-needs-you-queue.ts:6`; no spec imports it (Part C row 13) | no (move) |
| D-C-5 | §4.7 background-command visuals | not built | no data source (§9 "live shells are not exposed") | no (never existed) |
| D-B-1 | §4.6 artifact open via `editor:openFile` | `FILE_LINK_OPENER` (Tasks-board path, `tasks-store.service.ts:1351-1376`) | VS Code opens natively; Electron opens in the git dock editor | no (changed mechanism) |
| D-B-2 | §9.1 inspector placement | Rail shows the inspector in the Rail board aside; chat-view hosts it only without `SESSION_CONTEXT`; `canvas-session-details` deleted | two inspectors would show in Rail (B-3); D-1..D-11 map to the inspector | no (move, parity D rows) |
| D-B-3 | §4.6 lead task "first in stored order" | most recent `createdAt` when no primary | req 17 Terms and PM-12 outrank the design | no |
| D-B-4 | req 17.6 | no section (row 44) | user decision | no |
| D-M-4 | row 35 projection slots | registry token + outlets (§7) | M-3/M-4 evidence | no (same slot positions) |
| R1 | parity (row added after approval) | A1-D5 removes the assistant avatar + `Claude` + time line (`message-bubble.component.html:22-31`); per-message time appears only in the activity panel for N > 1 turns | §3 anatomy has none | **YES: removal of the assistant message time for single-message turns, approved by the USER (decisions row 45).** Time stays reachable as the turn duration; parity row added. A1-3 builds as planned. |

## 9. Verification per batch and risks

Rules for every executor and lane (repeat verbatim): run checks only through
`node .ptah/tmp/check-run.mjs <label> -- <command>`; changed projects only; `--parallel=1 --skip-nx-cache`; Jest
`--maxWorkers=2`; one heavy check at a time across all lanes; no workspace-wide run; no build/serve/dev/e2e/package
except BUILD-1; no npm install; no new spec files (existing specs are updated where intended behaviour changed);
no git in `D:\projects\ptah-final-run-ws`; never kill processes by image name; handoff file is `handoff-N.md`.

Per batch run `test`, `typecheck`, `lint` for each project it changed, e.g.
`node .ptah/tmp/check-run.mjs c1-chat-ui-test -- npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.

| Batch | Projects |
| --- | --- |
| C-1 | `@ptah-extension/chat-ui`, `@ptah-extension/ui` |
| C-2, B-3, A2-1, A1-2, B-4, A1-3, CV-1..3 | `@ptah-extension/chat` |
| A1-1 | `@ptah-extension/chat`, `@ptah-extension/chat-ui` |
| A2-2 | `@ptah-extension/chat`, `@ptah-extension/chat-ui` |
| A1-4 | `@ptah-extension/chat-streaming` |
| B-1 | `ptah-extension-webview` (test the one spec: `npx jest -c apps/ptah-extension-webview/jest.config.ts src/app/state-ink-contrast.spec.ts --coverage=false --maxWorkers=2`; typecheck, lint) |
| B-2 | `@ptah-extension/tasks-ui` (+ `chat` lint after B-4 for the `/presentation` boundary) |
| C-3, B-5 | `@ptah-extension/canvas` |
| B-3 | also `ptah-extension-webview` typecheck (`app.config.ts`) |
| BUILD-1 | §6.1 |

Also `ptah_get_diagnostics` scoped to the changed files after each batch. Lint must show no
`@nx/enforce-module-boundaries` error (chat -> `tasks-ui/presentation`, canvas -> chat only).

Reviewer focus at Gate 2 and code review: one `cliId -> providerId` table and no per-id template branch (req 18.1);
exhaustive status switches; no timer or observer per list item (one transcript clock, one `ResizeObserver` per
controller with `disconnect()` on destroy); `SessionInspectorStore` map pruned when tabs close; focus paths §8.3 1-7.

Risks:

1. chat-view is edited by three batches: keep CV-1..3 strictly serial; each runs the four chat-view specs. The
   three shared barrels (§3.2) follow the same rule: serial owners, append-only lines.
2. Bundle: ~10 kB eager vs ~10 kB headroom; BUILD-1 is the only measurement; a failure needs a new user approval
   for a second build.
3. 648 rebase conflicts in `chat-view.component.ts`, `canvas-focus-header.component.ts`,
   `chat/src/lib/components/index.ts` (H3); semantic risk is low because 677 renames or removes none of the 648 seams
   (row 34).
4. Per-turn chips depend on matching turn agent nodes to roster keys; a wrong field yields no chips (silent). The
   code-logic reviewer checks the key against `openSubagentLane` (`chat-transcript.component.ts:769-791`).
5. A1-D1 changes stored-message timing only for live finalization; if `tree.id` is not the `message_start` id
   (A1 check 2) the fallback keeps `Date.now()`, so behaviour is never worse than today.
6. R1 removal approved by the USER (decisions row 45); single-message turns show time only as the "Worked for"
   duration, and the revert stays one template block.

## Appendices (by reference)

Read these for per-component detail. Section names are the part headings.

- A. `plan-part-a1-turn.md` - Summary; Components; Exact edits per file (`turn-facts.utils.ts`,
  `turn-answer-split.utils.ts`, `molecules/turn/*`, `message-bubble.component.*`, `chat-transcript.component.*`,
  chat-ui formatters, `message-finalization.service.ts`); Parity row -> location; Data flow + empty/failure states;
  Bundle impact; Existing specs likely needing assertion updates; Decisions A1-D1..D7; Open checks 1-11.
- B. `plan-part-a2-header.md` - Host evidence; Components 1-5 (`SessionHeaderComponent`, chat-view wiring,
  `ChatInputComponent`, session-switch stagger, composer chips); Exact edits per file; Header <-> inspector binding
  contract; Parity row -> location; Data flow; Bundle impact; Existing specs; Decisions A2-1..A2-6; Open checks O1-O7.
- C. `plan-part-b-inspector.md` - Codebase evidence; Architecture decision; Component specifications 1-8
  (status-ink tokens, tasks-ui `/presentation`, `SessionInspectorStore`, open state + shell controller, inspector
  component tree, `SessionTaskReader`, chat-view host wiring, Rail board wiring); Parity row -> location map;
  Integration architecture; Quality requirements; Decisions B-1..B-10; Team-leader handoff; Open checks O1-O12.
- D. `plan-part-c-agents.md` - Codebase evidence (rows 1-39); Architecture decision; Component specifications 1-6
  (avatar vocabulary + `ptah-agent-avatar`, session agent roster, monogram helpers, compact lane status delegation,
  dock hover card + menu, agent dock rewrite); Parity map E-1..E-18; Integration architecture; Decisions C1-C11;
  Team-leader handoff (existing specs to update); Open checks.

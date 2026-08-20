# Survey C — `libs/frontend/**` (16 files > 1000 LOC)

Surveyor: frontend-developer. Measured 2026-08-17 against `ak/tui-defects`.
No code was changed.

## How the components were measured

Every component was measured before it was judged, because the TS-vs-template
split changes the verdict entirely. `head` = imports + module-level types before
the `@Component` decorator. `tpl` = the inline `template:` backtick block.
`sty` = inline `styles:`. `class` = the component/service class body.

The single most useful number below is the **TS** column: a 1388-line component
that is 918 lines of template (`setup-hub`) is a cheap, low-risk cut; a
1262-line component whose template already lives in a separate `.html`
(`chat-view`) is 1262 lines of pure logic sitting in a template component, and
that is a defect.

---

## Ranked table

| #   | File                                                              | Class                        | head | tpl                       | sty                   | **TS**   | Verdict in one line                                                                                                        | Effort                    |
| --- | ----------------------------------------------------------------- | ---------------------------- | ---- | ------------------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `chat/…/templates/chat-view.component.ts`                         | logic→service move           | —    | 0 (external `.html`, 272) | 0 (external css, 164) | **1262** | A template component hosting a 380-line transactional rewind/branch protocol and a 135-line pointer-drag gesture           | M, behaviour-preserving   |
| 2   | `tasks-ui/…/services/tasks-store.service.ts`                      | store facade + type barrel   | 415  | —                         | —                     | **2313** | Board store, bulk-run engine and workspace/board feed in one class, plus 415 lines of bulk vocabulary above it             | M, behaviour-preserving   |
| 3   | `editor/…/editor-panel/editor-panel.component.ts`                 | logic→service + directive    | 81   | 648                       | ~8                    | **1183** | Shell mixes split-pane, save-conflict dialog, file-ops dialogs and a 200-line pointer-drag tracker for three surfaces      | M, behaviour-preserving   |
| 4   | `editor/…/diff-view/diff-view.component.ts`                       | logic→service + child cmp    | 191  | 422                       | 66                    | **1527** | Monaco model-pair LRU cache, hunk decoration/widget layer, toolbar a11y, revert dialog and a language-map all in one class | L, needs visual review    |
| 5   | `chat/…/molecules/chat-input/chat-input.component.ts`             | logic→service                | 110  | 250                       | —                     | **1066** | Attachment intake (paste/drop/file/image) and the `@`//` trigger state machine are two engines inside a text box           | M, behaviour-preserving   |
| 6   | `chat-streaming/…/agent-monitor.store.ts`                         | store facade                 | 219  | —                         | —                     | **1456** | Agent-card lifecycle, panel UI state and outbound subagent RPC commands share one store                                    | M, behaviour-preserving   |
| 7   | `core/…/services/auth-state.service.ts`                           | service facade               | 94   | —                         | —                     | **1216** | Auth status + per-provider key CRUD + custom-provider CRUD + two CLI OAuth login flows                                     | M, behaviour-preserving   |
| 8   | `marketplace/…/smithery-surface.component.ts`                     | logic→service + child cmp    | 105  | 430                       | —                     | **722**  | Catalog search/paginate, install/uninstall lifecycle and card presentation in one surface                                  | M, behaviour-preserving   |
| 9   | `tasks-ui/…/components/tasks-view.component.ts`                   | child extraction             | 113  | **705**                   | —                     | 627      | Mostly template: the shell also owns a create-task form, a sweep dialog and an exclusions drawer                           | S–M, behaviour-preserving |
| 10  | `chat/…/settings/ptah-ai/agent-orchestration-config.component.ts` | child extraction             | 41   | **705**                   | —                     | 373      | Template problem: one per-CLI card repeated inline. **No spec file**                                                       | S, needs visual review    |
| 11  | `skill-synthesis-ui/…/skill-synthesis-tab.component.ts`           | child extraction             | 82   | 598                       | —                     | 662      | Sub-view host that also owns every dialog, toast and bulk-selection rule                                                   | M, behaviour-preserving   |
| 12  | `tasks-ui/…/board/task-list.component.ts`                         | logic→module + de-dupe       | 155  | 563                       | —                     | 598      | Roving-focus keyboard engine + row formatting that is duplicated in `task-card`                                            | S–M, behaviour-preserving |
| 13  | `harness-builder/…/setup-hub.component.ts`                        | child extraction             | 188  | **918**                   | —                     | 468      | Template problem: hub cards + a new-project intake modal + a discard confirm                                               | S, behaviour-preserving   |
| 14  | `chat/…/execution/inline-agent-bubble.component.ts`               | child extraction (marginal)  | 81   | 436                       | 87                    | 572      | Four small concerns, none of which clears the 150-line floor alone                                                         | S, low value              |
| 15  | `chat/…/settings/ptah-ai/ptah-cli-config.component.ts`            | child extraction — **defer** | 137  | 528                       | —                     | 644      | CRUD form + Copilot OAuth flow, and **no spec file** to hold it                                                            | M, defer until pinned     |
| 16  | `chat-state/…/tab-manager.service.ts`                             | **EXEMPT (in the main)**     | 82   | —                         | —                     | **2069** | 90 deliberately thin intent-named mutators over one signal — the width IS the documented contract                          | —                         |

**Exempt: 1** (`tab-manager.service.ts`, in the main; a ~300-line peripheral cut
is available and described but is not where the value is).
**Mostly template (template ≥ 60 % of the file): 3** — `setup-hub` (66 %),
`agent-orchestration-config` (65 %), `tasks-view` (53 % — the largest single
block in the file). Three more are near-even splits (`task-list`,
`skill-synthesis-tab`, `ptah-cli-config`).

---

## Two cross-file findings that pay for more than one refactor

### A. The pointer-drag tracker exists twice, in my two heaviest components

`setPointerCapture` appears in exactly two production files in `libs/frontend`,
and both are in this partition:

- `chat-view.component.ts:304-437` — ~135 lines (agent-panel edge)
- `editor-panel.component.ts:1521-1829` — ~200 lines (terminal, sidebar, split)

Both implement the same non-obvious protocol: pointer capture instead of
document listeners (so a drag that leaves the window still ends), `NgZone`
`runOutsideAngular` + `requestAnimationFrame` coalescing, Escape-to-cancel,
window-blur cancel, `lostpointercapture` teardown. Both are pinned by their spec
files (`setPointerCapture` appears in both `.spec.ts`).

A `PointerDragDirective` in `libs/frontend/ui` — the primitives lib that
`editor` and `chat` may both import — takes ~250 lines out of ranks 1 and 3 at
once and deletes a duplicated gesture protocol. Caveat: `editor` does not import
`@ptah-extension/ui` today for this (it does for the branch-picker overlays), so
this adds no new lib edge; `chat` already imports it. This is a separate task,
not a per-file cut — but it should be scheduled BEFORE ranks 1 and 3 or the two
refactors will each invent their own local answer.

### B. Stick-to-bottom scrolling is reimplemented in ~12 components

`scrollHeight`-based auto-scroll appears in 12+ frontend components
(`inline-agent-bubble`, `chat-transcript`, `agent-monitor-panel`, the three
`*-output` agent cards, `chat-ui/agent-card-output`, two `compact-session`
components, `harness-builder-view`, `setup-wizard/analysis-transcript`,
`chat-input`). Only `inline-agent-bubble` is in my 16, and on its own its
~100-line version is below the 150-line floor. As one `AutoScrollToBottomDirective`
in `libs/frontend/ui` it is a genuine seam that touches a dozen files. Flagging
it here so rank 14 is read in that light; do not cut it from
`inline-agent-bubble` alone.

---

# Per-file assessments

## 1. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` — 1262

**Classification**: logic-to-service move (plus the shared drag directive).

**TS-vs-template**: 1262 lines, **100 % TypeScript**. The template already lives
at `chat-view.component.html` (272 lines) and `chat-view.component.css` (164).
This is the only component in the 16 with no template debt at all — every one of
its 1262 lines is logic.

**Verdict**: it mixes four concerns, and two of them do not belong in a template
component at all.

1. **Session rewind and branch** — `onRewindRequested` → `attemptRewindV2`
   (`988-1191`, **203 lines in one method**), `onBranchRequested` (48),
   `deleteOriginalSession` (39), `isHardRewindFailure`, `isMessageIdNotFoundError`,
   `resolveAnchorId`, `buildAnchorHint` (20). This is a multi-step transactional
   protocol: dry-run `rewindFiles` RPC → build a human diff summary → confirm
   dialog with checkboxes → resolve the originating tab _before_ the irreversible
   step → revert → fork → in-place tab session swap → optional original-session
   delete. The comments in it document an ordering invariant ("aborting after the
   fork would leave an orphaned session the user can only see after a reload").
   An invariant that load-bearing should not be defended inside a component that
   also decides whether a banner is visible.
2. **Pointer-drag resize gesture** (`304-437`, ~135 lines). Note the component
   already injects `PanelResizeService` — that service owns the _width_; the
   component owns the _gesture_. See cross-file finding A.
3. **Action-banner plumbing** (`showActionError/Info/Warning`) — thin, fine.
4. **Actual template wiring** — panel toggles, prompt selection, queue edit,
   resume-agent handlers. This is the part that belongs.

**Proposed cut** (2 collaborators, both nameable):

- `chat/src/lib/services/chat-store/session-rewind.service.ts` →
  `SessionRewindService`. Takes the seven rewind/branch members (~380 lines).
  It already has every dependency it needs as an injectable: `ClaudeRpcService`,
  `ConfirmationDialogService`, `TabManagerService`, `TabSessionBinding`,
  `SessionLoaderService`. `chat.store.ts` documents `services/chat-store/` as
  exactly the place for a slice like this, so the home is prescribed, not invented.
  The component keeps `onRewindRequested(messageId)` / `onBranchRequested(messageId)`
  as one-line delegations, so the template does not change.
- `libs/frontend/ui/.../pointer-drag.directive.ts` → `PointerDragDirective`
  (~250 lines shared with rank 3; see finding A). If A is not scheduled, the
  local fallback is `chat/src/lib/services/agent-panel-drag.service.ts`
  (~140 lines) — acceptable but it leaves the duplicate standing.

Resulting: `chat-view.component.ts` ≈ **740** lines. Not under 700, and I am not
going to invent a third cut to get there — the remainder is honest template
wiring for a screen with a transcript, an input, an agent panel, four banners
and a background-agent tray.

**Risk**: the rewind path is the highest-consequence code in this file (it
deletes sessions and reverts files on disk). It is covered by a 1331-line spec,
which is what makes this a behaviour-preserving move rather than a rewrite —
run `chat-view.component.spec.ts` unchanged against the delegating component,
and add the service's own spec afterwards. No cross-lib risk: `chat` already
depends on `chat-state`, `core` and `ui`; nothing here reaches toward
`libs/backend`.

**Effort**: M, behaviour-preserving. **Rank 1** — largest pure-logic mass in the
partition, the clearest single seam, and the best spec cover to prove it.

---

## 2. `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts` — 2313

**Classification**: store facade (the TASK_2026_256 template) + a type barrel.

**Structure**: 415 lines of module-level vocabulary before the class
(`TaskBoardColumn`, `TaskEstimateBuckets`, `BoardSlice`, `BulkOperation`,
`BulkProgress`, `BulkFailure`, `BulkUntouched`, `BulkSummary`, `TaskBulkOutcome`,
`BULK_CONFIRM_THRESHOLD`, `readExcludedFolders`, `withRelationArrays`,
`emptyColumns`, `normalizeRootKey`), then `TasksStore` at `416-2312`.

**Verdict**: three separable concerns plus a vocabulary.

1. **Board read model** (the part that should keep the name): board/filter/sort
   computeds, the detail panel, document/artifact reads, metadata writes through
   the `applyMetadata` funnel, selection. The lib's own CLAUDE.md pins the funnel
   ("every carrier write goes through `applyMetadata`… there is no second
   mutating call site") — that invariant must survive any cut, which means
   `applyMetadata`, `enqueueWrite` and `writeMetadata` stay together.
2. **Bulk run engine** (`~1526-1910`, ~380 lines): `requestBulk`,
   `requestBulkStatus`, `requestBulkLabel`, `confirmBulkRequest`,
   `cancelBulkRequest`, `runBulk` (51), `callBulkChunk` (44), `settleBulk` (56),
   `reconcileAfterBulk`, `cancelBulk`, `clearBulkSummary`. Chunking, cancellation,
   per-item outcome settlement and post-run reconciliation are a machine with its
   own state (`BulkProgress`, `BulkSummary`), and nothing in the read model reads it.
3. **Workspace/board feed** (`~2079-2311`, ~230 lines): `setupWorkspaceSwitch`,
   `onWorkspaceSwitch`, `fetchBoard` (with `isLatest`/`isActive` staleness
   guards), `cacheBoard`, `setupVisibilityReconcile`, `refreshActiveFromPush`,
   `toSlice`, `applySlice`, `resetVisibleForLoading`. This is a cache + freshness
   protocol keyed by workspace root — the same "workspace partitioning" pattern
   `editor` already extracted into `EditorWorkspaceHelper`.

**Proposed cut** (2 collaborators + 1 type file — exactly the 256 shape):

- `services/tasks-bulk.types.ts` — the bulk vocabulary (`BulkOperation`,
  `BulkProgress`, `BulkFailure`, `BulkUntouched`, `BulkSummary`,
  `TaskBulkOutcome`, `BulkErrorCode`, `BULK_CONFIRM_THRESHOLD`), ~230 lines,
  re-exported from the store file so no consumer import changes.
- `services/tasks-bulk-runner.service.ts` → `TasksBulkRunner` (~420 lines).
  Injects `ClaudeRpcService`; receives the selection and a reconcile callback
  from the store. `TasksStore` keeps `requestBulk*` / `confirmBulkRequest` /
  `cancelBulk` as delegations and keeps re-exposing the bulk signals, so
  `tasks-view` and `task-bulk-bar` see no change.
- `services/tasks-board-feed.service.ts` → `TasksBoardFeed` (~270 lines).
  Owns the per-root cache, the fetch generation counter and the
  visibilitychange reconcile; `TasksStore` keeps `loadBoard()` and the board
  signals.

Resulting: `tasks-store.service.ts` ≈ **1050**, plus 420 + 270 + 230. Still over
700 and I will say so plainly — the read model with six filter/sort computeds and
the write funnel is genuinely ~1000 lines. Chasing the last 350 would mean
splitting the funnel, which the lib documentation forbids for good reason.

**Risk**: `TasksStore` is `providedIn: 'root'` and joins `MESSAGE_HANDLERS` for
`tasks:changed`. The facade keeps the class, the token and `handleMessage`, so
registration does not move (this is the property that made 256 cheap). Two live
invariants to preserve: **no optimistic board state** (guardrail 3 in the lib
doc — the feed service must still only apply authoritative payloads) and the
single write funnel. Constructor count after the cut: ~5 injected deps, inside
the 8 gate.

**Effort**: M, behaviour-preserving. The 2896-line spec is the best cover in the
partition. **Rank 2.**

---

## 3. `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts` — 1831

**Classification**: logic-to-service move + the shared drag directive.

**TS-vs-template**: head 81 / **template 648** (`82-729`) / class **1093**
(`738-1830`). TS total 1183 — template is 35 %, so this is a logic problem with
a large template attached, not a template problem.

**Verdict**: the panel is the editor shell, and a shell legitimately wires many
children. But it has absorbed three concerns that are not wiring:

1. **Pointer-drag tracking for three surfaces** (`1521-1829`, ~310 lines
   including `startDragTracking` at 103 lines, `applyLatest`, `endDrag`,
   `isOwnPointer`, `cleanupDragListeners`, `releaseDragPointer`,
   `cancelDragFrame`). Terminal height, sidebar width and split ratio all go
   through one generic tracker — the generalisation is already done, it is just
   done inside a component. Cross-file finding A.
2. **The file-ops dialog trio** (`1315-1507`, ~190 lines): context-menu action
   dispatch (`onContextMenuAction`, 70 lines), the delete confirm dialog, the
   inline input dialog (new file / rename), and the focus capture/restore pair
   that makes them accessible. Four `signal`s of dialog state plus keyboard
   traps.
3. **The save-conflict dialog** (`1056-1167`, ~110 lines) — a second, differently
   shaped modal protocol (detect conflict → confirm → persist).

**Proposed cut** (2 collaborators + 1 shared directive):

- `PointerDragDirective` in `libs/frontend/ui` (finding A) — or, locally,
  `services/editor/surface-drag.service.ts` → `SurfaceDragService` (~230 lines).
  Prefer the shared directive.
- `editor-panel/file-ops-dialog.controller.ts` → `FileOpsDialogController`
  (~200 lines), holding the delete/input dialog signals, the keyboard traps and
  the focus round-trip. The lib's CLAUDE.md guideline 3 already prescribes this
  shape ("when a service grows past ~500 lines, split into helpers under
  `services/<feature>/` keeping signals on the coordinator") — `EditorService`'s
  four-helper split is the in-repo precedent.
- The save-conflict protocol folds into the same controller only if it stays
  under ~350 total; otherwise leave it. Do **not** create a third ~110-line
  dialog file (guardrail 2).

Resulting: component ≈ **760** TS + 648 template. Together with a template split
(this lib does not forbid `templateUrl`; `marketplace-hub` and four `chat`
components already use it) the file lands ≈ 760.

**Risk**: highest-friction file to verify — 3027 lines of spec, much of it
driving pointer events and dialog focus. That spec is the reason this ranks
third rather than first: it will catch a regression, but it also means a larger
surface to keep green. No cross-lib risk; `editor` already depends on `core`,
`shared` and `ui`.

**Effort**: M, behaviour-preserving. **Rank 3.**

---

## 4. `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts` — 2016

**Classification**: logic-to-service move + one child component.

**TS-vs-template**: head 191 / **template 422** (`192-613`) / styles 66 /
class **1336** (`680-2015`). TS total 1527 — the largest class body in the
partition after `tasks-store`.

**Verdict**: five concerns, and they are unusually well separated already —
which is what makes the file long rather than tangled.

1. **Monaco model-pair lifecycle** (`1170-1454`, ~285 lines): `createEditor`,
   `syncDiff`, `createPair`, `getOrCreateModel`, `applyText`, `applyLanguage`,
   `enforcePairCap`, `evictClosedPairs`, `disposePair`, `saveViewState`,
   `restoreViewState`, `scheduleLayout`, plus the side-by-side layout preference
   read/write. This is an LRU cache of editor models with view-state persistence.
   It is not view logic.
2. **The hunk decoration + widget layer** (`1467-1659`, ~195 lines):
   `bindGlyphMargin`, `renderHunkDecorations`, `syncHunkWidget`,
   `hunkWidgetHost`, `removeHunkWidget`, `revealHunk` — imperative Monaco
   decoration and overlay-widget management driven by `EmbeddedViewRef`.
3. **The hunk toolbar's keyboard/a11y contract** (`1839-1914`, ~80 lines):
   roving tabindex, arrow handling, focus restoration, icon/label maps.
4. **The revert confirm dialog** (`1725-1835`, ~110 lines).
5. **`detectLanguage`** (`1963-2014`) — a 50-line extension→language map, and
   `detectMonacoTheme` (~25). Pure functions with no component state.

The pre-class 191 lines are fine as-is: `hunkLineRange` and `hunkAtLine` are
already exported pure functions with their own spec coverage. That part of the
file is not the problem — do not "tidy" it.

**Proposed cut** (2 collaborators + 1 pure module):

- `diff-view/diff-model-pair-cache.ts` → `DiffModelPairCache` (~330 lines).
  Owns the `Map<key, DiffModelPair>`, the cap, eviction, view-state save/restore
  and language application. Takes the `MonacoApi` as a parameter — no Angular DI
  needed, which keeps it unit-testable without a TestBed.
- `diff-view/hunk-decoration-layer.ts` → `HunkDecorationLayer` (~230 lines).
  Owns glyph-margin binding, decorations and the overlay widget host.
- `diff-view/monaco-language-detection.ts` → `detectMonacoLanguage` +
  `detectMonacoTheme` (~90 lines). Under the 150 floor, but it is a pure
  lookup table with zero component coupling and is the kind of file that would
  otherwise be pasted into the next Monaco surface — I would accept it, and
  note the exception explicitly rather than pretend it clears the bar.
- The revert dialog and the toolbar a11y stay. They are template-adjacent and
  splitting them yields two sub-150 fragments (guardrail 2).

Resulting: component ≈ **700-750** TS + 422 template + 66 styles.

**Risk**: the highest of the four top-ranked, because the Monaco interactions
are imperative and timing-sensitive (`afterNextRender`, `NgZone`, disposal
ordering in `ngOnDestroy`). The 2006-line spec covers hunk maths and apply
operations well; it covers editor disposal less. This one wants a visual pass on
a real diff with hunks, side-by-side toggled both ways, before it is called done.

**Effort**: L, needs visual review. **Rank 4** — high value, but it is the one
file here I would not hand to a batch that also has to finish something else.

---

## 5. `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` — 1318

**Classification**: logic-to-service move.

**TS-vs-template**: head 110 / template **250** (`111-360`) / class **956**
(`362-1317`). TS total 1066 — the template is only 19 % of the file. A text box
with a 956-line class.

**Verdict**: two engines and a text box.

1. **Attachment intake** (`601-893`, ~290 lines): `handlePaste` (48 — clipboard
   items, size limits, media-type resolution, base64), `handleDrop` (43),
   `handleDragOver`/`handleDragLeave`, `handleAttachFiles` (34),
   `handleAttachImages` (36), `removePastedImage`, `showImageAttachmentError`.
   Validation rules (`MAX_IMAGE_SIZE_BYTES`, `resolveImageMediaType`) and three
   different entry paths converging on one attachment list.
2. **The trigger/suggestion state machine** (`899-1153`, ~255 lines): the `@` and
   `/` activated/triggered/closed handlers, query changes, two fetch paths,
   selection, `replaceTrigger`, `removeTriggerText`, `closeSuggestions`, plus the
   `aria-activedescendant`/listbox id bookkeeping. Two triggers sharing one
   dropdown, with cursor-offset text surgery.
3. The rest — voice button, send/stop, agent + effort selection, auth label — is
   genuine input wiring.

**Proposed cut** (2 collaborators, both in `chat/src/lib/services/`, both
stateful and therefore NOT `chat-ui`):

- `services/attachment-intake.service.ts` → `AttachmentIntakeService` (~300).
  Injects `VSCodeService` + `FilePickerService`; exposes a signal of pending
  attachments and three intake methods (`fromClipboard`, `fromDrop`, `fromPicker`).
- `services/suggestion-trigger.controller.ts` → `SuggestionTriggerController`
  (~260). Owns trigger state, query, fetch delegation and the replacement
  arithmetic; the component keeps the `viewChild` textarea ref and hands it in.

Resulting: component ≈ **500** TS + 250 template. This one actually lands under
the ceiling.

**Risk**: `chat-input` is the most-touched surface in the product; a regression
in cursor-offset arithmetic (`replaceTrigger` / `removeTriggerText`) is subtle
and user-visible. The 744-line spec covers paste and trigger behaviour. Keep the
`@Output` set and the template bindings byte-identical. No cross-lib risk —
neither extraction reaches `chat-ui` (both inject services, which `chat-ui`
forbids by rule 1) and neither reaches `libs/backend`.

**Effort**: M, behaviour-preserving. **Rank 5.**

---

## 6. `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` — 1456

**Classification**: store facade, split by concern group.

**Structure**: 219 lines of types (`WorkflowRunFields`, `MonitoredAgent`,
`SubagentRpcError`, helper `readWorkflowFields`), class `220-1455`.

**Verdict**: three concerns, one of which does not belong in a store at all.

1. **Agent-card lifecycle** (the core): `onAgentSpawned` (107 lines),
   `onAgentOutput` (65), `onAgentExited`, `evictOldCompletedAgents`,
   `findReplacementCard`, `enforceMaxExpanded`, `loadCliSessions`,
   `clearSessionAgents`, `removeAgent`, `clearCompleted*`, plus the flat-event
   handlers `onAgentStart/Progress/Status/Completed`. ~600 lines. This is the
   store.
2. **Panel UI state**: `togglePanel`, `openPanel`, `requestPanelOpen`,
   `closePanel`, `isSidebar`, `toggleAgentExpanded`, the tick timer
   (`startTick`/`stopTick`/`syncTick` — a `setInterval` for elapsed-time
   display). ~130 lines. Panel open/closed and a display clock are view state
   that happens to live in a root-provided store.
3. **Outbound subagent commands** (~250 lines): `sendMessageToAgent`,
   `getSubagentTranscript`, `stopAgent`, `interruptSession`, `backgroundAgent`,
   `continueAgent`, `recordSubagentRpcError`. These are RPC calls out, not state
   in. A store that both accumulates events and issues commands has two reasons
   to change.

**Proposed cut** (2 collaborators; the class keeps its name, its
`providedIn: 'root'` and its exported signals):

- `agent-monitor/subagent-command.service.ts` → `SubagentCommandService`
  (~280 lines). Injects `ClaudeRpcService` + `VSCodeService`; owns the RPC error
  signal. `AgentMonitorStore` delegates and keeps its method names.
- `agent-monitor/agent-monitor-panel-state.service.ts` →
  `AgentMonitorPanelState` (~180 lines). Panel open/close/expansion + the
  elapsed-time tick and its `ngOnDestroy` teardown.
- Optionally `agent-monitor.types.ts` for the 219-line head, but only if the cut
  above lands; a type file alone is not worth a commit here.

Resulting: store ≈ **950**. The lifecycle core is genuinely ~600 lines of event
handling and I would not cut into it — `onAgentSpawned` at 107 lines is a single
decision tree (replacement-card matching, workflow field reading, eviction), and
splitting a decision tree by line count is how you get the fragment sprawl the
task is explicitly trying to avoid.

**Risk**: `chat-streaming` must never import `chat` (lib guideline 1) — both
extractions stay inside `chat-streaming`, so the edge is untouched. The store is
consumed by `chat-view`, `inline-agent-bubble` and `agent-monitor-panel` via
signals; keeping the signals on the facade preserves reference identity, which
matters here because the lib deliberately relies on signal equality semantics.
774-line spec.

**Effort**: M, behaviour-preserving. **Rank 6.**

---

## 7. `libs/frontend/core/src/lib/services/auth-state.service.ts` — 1216

**Classification**: service facade.

**Structure**: head 94 (`ApplyTo`, `SettingScope`, `CustomProviderMutationResult`,
`CustomProviderTestResult`, `CustomProviderTestState`), class `95-1215`.

**Verdict**: one service, four audiences.

1. **Auth status read model**: `loadAuthStatus`, `refreshAuthStatus`,
   `fetchAndPopulateAuthStatus`, `populateFromResponse`, `fetchAndPopulateScope`,
   `clearWorkspaceOverride`, `setAuthMethod`, `setSelectedProviderId`,
   `flagAuthRequired`, `clearAuthRequiredBanner`, `clearStatus`. ~350 lines. This
   is what most consumers mean by `AuthStateService`.
2. **Per-provider API-key operations**: `saveAndTest` (75 lines),
   `checkProviderKeyStatus`, `deleteApiKey`, `deleteProviderKey`,
   `hasKeyForProvider`. ~180 lines.
3. **Custom-provider CRUD** (~250 lines): `loadCustomEntries`, `addCustomEntry`,
   `updateCustomEntry`, `removeCustomEntry`, `testCustomEntry` (47),
   `mutateCustomEntry` (31), `reloadAfterCustomMutation`,
   `clearCustomEntryError`, `clearCustomTestState`, `isCustomProvider`,
   `customEntry`. A complete second entity with its own mutation/test/error
   protocol.
4. **CLI OAuth login flows**: `copilotLogin` (65 lines — device-code polling),
   `copilotLogout`, `codexLogin`. ~90 lines.

**Proposed cut** (2 collaborators; `AuthStateService` keeps its name — it is
injected by `chat-view`, the settings tree and others):

- `services/auth/custom-provider-registry.service.ts` →
  `CustomProviderRegistry` (~300 lines with its three result types moved
  alongside). `AuthStateService` re-exposes the custom-entry signals so
  `custom-provider-form.component.ts` and `llm-providers-config.component.ts`
  need no change.
- `services/auth/cli-login.service.ts` → `CliLoginService` (~150 lines) for the
  Copilot device-code flow, logout and the Codex hand-off. Two vendors today,
  and the pattern in this repo is that a third arrives — this is the file it
  should land in.

Resulting: `auth-state.service.ts` ≈ **750**. Close enough to the ceiling that a
third cut is not worth manufacturing.

**Risk**: `core` is imported by nearly every frontend lib, so the _file_ is
low-risk to split but the _class_ is high-risk to rename — do not. Both new
services must stay inside `libs/frontend/core` (they call `ClaudeRpcService`,
which lives there). The 1669-line spec is strong cover. Watch `saveAndTest`'s
`applyTo` scope handling — it is the one place global/app/workspace scope
diverges, and it stays on the facade.

**Effort**: M, behaviour-preserving. **Rank 7.**

---

## 8. `libs/frontend/marketplace/src/lib/smithery-surface.component.ts` — 1152

**Classification**: logic-to-service move + one child component.

**TS-vs-template**: head 105 / template **430** (`106-535`) / class **609**
(`543-1151`). Near-even, TS-leaning.

**Verdict**: a registry browser, an installer and a card renderer, sharing one
class and one set of loading flags.

1. **Catalog** (~200 lines): `effectiveQuery`, `runBrowse`, `loadMore` (cursor
   pagination), `performSearch`, `searchPage`, `onSearchInput` (debounce),
   `selectCategory`, `isCategoryActive`.
2. **Install lifecycle** (~230 lines): `toggleInstallPanel`, `setupServer` (53),
   `uninstall` (32), `loadInstalled`, `extractConfigSchema`, `resetInstallPanel`,
   the busy/uninstalling `Set` signals and their `addToSet`/`removeFromSet`
   helpers, plus the API-key pair `saveKey` / `checkKeyStatus`.
3. **Card presentation** (~90 lines): `iconSrc`, `onIconError`, `avatarLetter`,
   `cardTitle`, `getDisplayName`, `hasUseCount`, `formatUseCount`, `trimZero` —
   pure formatting feeding a card that is ~150 lines of the template.

`marketplace` is a flat lib (11 files, no sub-folders) with `marketplace-hub`
already using `templateUrl` — so both a child component and an external template
are idiomatic here.

**Proposed cut** (1 service + 1 child component):

- `smithery/smithery-catalog.service.ts` → `SmitheryCatalogService` (~250):
  search, browse, cursor pagination, category state, the installed set and the
  install/uninstall RPCs. One service rather than two — the busy sets are shared
  between browse and install and splitting them would put one `Set` in two files.
- `smithery/mcp-server-card.component.ts` → `McpServerCardComponent` (~230:
  ~150 template + ~80 formatting). Presentational, `input`/`output` only.
  **Beside its parent in `marketplace`, not in a shared lib** — it renders an
  `McpRegistryEntry`, which nothing outside marketplace shows.

Resulting: surface ≈ **330** TS + ~280 template. Comfortably under.

**Risk**: low. `JsonSchemaFormComponent` comes from `@ptah-extension/ui` and
stays on the parent. 563-line spec. Only real trap: `setupServer` writes the
MCP config through RPC — keep its error/`messageOf` handling attached to the
same call site rather than splitting the toast from the call.

**Effort**: M, behaviour-preserving. **Rank 8.**

---

## 9. `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts` — 1333

**Classification**: child-component extraction (template-led).

**TS-vs-template**: head 113 / **template 705** (`114-818`, 53 % of the file) /
class **514** (`819-1332`), of which ~175 lines are injected deps + signals and
~340 are methods.

**Verdict**: the shell is doing its job — header actions, board/list swap,
detail panel — but four self-contained overlays are inlined into it:

1. **New Task modal**: `openCreate`, `closeCreate`, `setCreateType`,
   `setCreateStatus`, `submitCreate`, six form signals, and ~180 lines of
   template.
2. **Sweep dialog**: `openSweep`, `confirmSweep`, `modeLabel`, `modeTitle`, and
   ~90 lines of template.
3. **Exclusions drawer**: `openExclusions`/`closeExclusions` + a
   `NativeDrawerComponent` body of ~110 template lines.
4. **Command palette + global keyboard**: `openPalette`, `closePalette`,
   `onKeyDown`, `onPaletteRun` (46 lines dispatching 15 actions). The palette
   component already exists; the dispatch table does not.

`tasks-ui/components/` already has `bulk/`, `detail/`, `filter/`, `palette/`
sub-folders, so a `create/` folder is the established shape.

**Proposed cut** (2 child components + 1 module):

- `components/create/task-create-dialog.component.ts` →
  `TaskCreateDialogComponent` (~260: 180 template + 80 form state), emitting one
  `create` output. **Beside its parent in `tasks-ui`** — there is no shared
  presentational lib on this side, and a task-create form is not reusable
  anywhere else.
- `components/sweep/task-sweep-dialog.component.ts` → `TaskSweepDialogComponent`
  (~160). Borderline on the 150 floor; justified because it is a destructive
  confirm with its own preview/apply protocol, not a fragment.
- `components/palette/palette-dispatch.ts` → `runPaletteAction(action, deps)`
  (~90) — pure dispatch beside the existing `palette-entries.ts`. Under the
  floor and I will call that out; it earns its place only because
  `palette-entries.ts` is already its neighbour.
- The exclusions drawer body can move into the same file as its trigger only if
  it clears ~150; otherwise leave it inline. Do not create a fifth file.

Resulting: `tasks-view.component.ts` ≈ **430** template + ~330 TS ≈ **760**.

**Risk**: low-moderate. Guardrail 6 in the lib doc — Start lives on the card and
the row and nowhere else — is untouched by these cuts, and guardrail 3 (no
optimistic board state) is a store concern. The 1570-line spec drives the
modal and palette through the host, so extracted children must keep the same
DOM structure/`data-*` hooks or the spec will need selector churn (that churn is
the main cost here).

**Effort**: S–M, behaviour-preserving. **Rank 9.**

---

## 10. `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` — 1078

**Classification**: child-component extraction. **Pure template problem.**

**TS-vs-template**: head 41 / **template 705** (`42-746`, 65 % of the file) /
class **327** (`751-1077`). Only one injected dependency (`ClaudeRpcService`) and
20 short methods.

**Verdict**: this file is not complex, it is repetitive. The template renders the
same per-CLI accordion — enable toggle, model select, reasoning-effort select,
auto-approve, max-concurrent, expand/collapse, ordering arrows — and the class is
a thin RPC-per-control layer over it. There is no buried role here; there is a
missing child component.

**Proposed cut** (1 child component):

- `settings/ptah-ai/cli-agent-card.component.ts` → `CliAgentCardComponent`
  (~380: ~300 template + ~80 of per-card state), `input` the CLI descriptor,
  `output` each change. **Beside its parent in `chat/settings/ptah-ai/`**, not
  in `chat-ui`: it is settings-specific and used exactly once
  (`chat-ui` rule: "components only used in one place — keep them co-located").
- The parent keeps load/save/ordering (`moveAgentUp`/`Down`,
  `savePreferredOrder`, `redetectClis`) and the Cursor API-key row.

Resulting: parent ≈ **380** total; child ≈ 380.

**Risk**: **no spec file exists for this component.** Every other refactor in
this partition is held by a spec; this one is held by nothing. The cut is
mechanical and the blast radius is one settings pane, but it must be
verified by hand (or, better, a characterisation spec written first). Also note
`toggleCliEnabled` / `toggleAutoApprove` write real provider config — a mis-wired
output here silently disables a CLI.

**Effort**: S mechanically, but **needs visual review** and ideally a spec first.
**Rank 10** — high ratio, docked for having no safety net.

---

## 11. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` — 1262

**Classification**: child-component extraction.

**TS-vs-template**: head 82 / **template 598** (`83-680`) / class **580**
(`682-1261`). Near-even.

**Verdict**: the lib has already done the right thing once — `skill-candidates-table`,
`skill-digest-panel`, `skill-invocations-panel`, `skill-pipeline-status`,
`skill-settings-panel`, `skill-stats-strip`, plus `clones/`, `suggestions/` and
`diagnostics/` folders all exist as children. The tab is the host that switches
between them. What it has _also_ accumulated:

1. **Every dialog and toast**: curator modal open/close, the action dialog
   (`onOpenAction`/`onCloseDialog`), `showToast`, and the promote/reject reason
   text builders (`promoteReasonText`, `mostCommonFailureReason` — ~80 lines of
   prose assembly).
2. **Bulk selection**: `_selectedIds`, `onSelectRow`, `onToggleSelect`,
   `onToggleSelectAll`, `clearSelection`, `onClearSelection`, `selectedCount`.
3. **Sub-view + filter routing**: `subView`, `setSubView`, `onFilterChange`, the
   `filters`/`subViews` descriptor arrays (~30 lines of config).
4. Six injected services, including a `FormBuilder` for the settings form.

**Proposed cut** (1 child component + 1 controller):

- `components/skill-action-dialog.component.ts` → `SkillActionDialogComponent`
  (~280: template + the reason-text builders). One dialog host for promote /
  reject / clone actions, replacing three inline blocks.
- `skill-selection.controller.ts` → `SkillSelectionController` (~150): the
  selected-id set, select-all semantics against the filtered list, and clearing
  on filter change. Nameable, and it is the piece most likely to grow.
- Leave the sub-view switch and the toast on the host — they are the host's job.

Resulting: tab ≈ **400** template + ~380 TS ≈ **780**.

**Risk**: low. Six injected services stay on the host, so the constructor gate is
not touched. 810-line spec. The lib is Electron-visible (`thoth-shell` tab) plus
VS Code, so verify in both shells if the dialog markup changes.

**Effort**: M, behaviour-preserving. **Rank 11.**

---

## 12. `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts` — 1161

**Classification**: logic-to-module move + duplication removal.

**TS-vs-template**: head 155 / **template 563** (`156-718`) / class **441**
(`720-1160`).

**Verdict**: a presentational component that has grown two things it should not
own alone.

1. **A roving-focus keyboard engine** (~150 lines): `navigationOrder`,
   `focusedTaskId`, `rovingTabIndex`, `onKeyDown` (55 lines), `collapseFocusedGroup`,
   `focusAt`, `focusGroupHeader`, `focusElement` — including direct DOM focus by
   attribute selector through an injected `ElementRef`. This is a well-defined
   widget behaviour (WAI-ARIA grid navigation), not row rendering.
2. **Row formatting duplicated with `task-card`**: `chipClass`, `statusLabel`,
   `onCheckboxClick`, `onStart`, `onStatusPick` are defined in **both**
   `task-list.component.ts` and `task-card.component.ts`, while
   `task-presentation.ts` already exists as the lib's shared presentation module.
   `task-list` adds its own `typeClass`, `estimateClass`, `estimateTitle`,
   `visibleLabels`, `hiddenLabelCount`, `updatedLabel`, `parseUpdated` on top.

**Proposed cut** (1 controller + 1 module extension — no new component):

- `board/task-list-keyboard.ts` → `TaskListKeyboardNavigator` (~180). A plain
  class the component instantiates with a host `ElementRef`; keeps the roving
  contract in one testable place.
- Move the shared formatters into the existing `task-presentation.ts`
  (`taskChipClass`, `taskTypeClass`, `taskEstimateClass`, `taskUpdatedLabel`,
  `visibleTaskLabels`) and have **both** `task-list` and `task-card` call them.
  This deletes a live duplication rather than relocating one — and it does not
  touch the board/list input parity that lib guideline 6 protects, because
  formatters are internal.

Resulting: `task-list.component.ts` ≈ **563** template + ~180 TS ≈ **760**.
A further `TaskRowComponent` extraction (~300 template lines) is available if
the number matters more than the churn; I would not do it in the same pass,
because the row template is the thing the 678-line spec asserts against.

**Risk**: low, with one sharp edge — `focusElement` finds nodes by attribute
selector, so any template change in the extracted-or-not row must keep those
attributes. Do the formatter de-duplication and the keyboard extraction as two
separate commits so a focus regression is bisectable.

**Effort**: S–M, behaviour-preserving. **Rank 12.**

---

## 13. `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` — 1388

**Classification**: child-component extraction. **Mostly template (66 %).**

**TS-vs-template**: head 188 / **template 918** (`189-1106`) / class **280**
(`1108-1387`). The class is the smallest of any component in the 16 relative to
its file, and it is well-formed: four injected services, ~20 signals with
`asReadonly()` exposure, six `computed()`, and short methods.

**Verdict**: there is no buried role in the TypeScript. The 918-line template
holds three distinct surfaces: the hub cards (setup wizard / harness builder /
tribunal / new project), the **new-project intake modal** (audience + stack
options, a "what" field, validation, a progress ring), and a **discard-confirm
dialog**. The intake modal is the only part with real state
(`_showIntake`, `_audience`, `_stack`, `_isStarting`, `_intakeError`,
`_whatFilled`, `_stackOtherFilled`, `canStartPlanning`, `progressOffset`).

**Proposed cut** (1 child component):

- `components/new-project-intake-dialog.component.ts` →
  `NewProjectIntakeDialogComponent` (~450: ~350 template + ~100 state), taking
  the intake modal _and_ its discard confirm, emitting `start` / `discard`.
  **Beside its parent in `harness-builder`** — it is harness-specific.
- Do **not** move the template to a `.html`: this lib's CLAUDE.md explicitly
  records "inline templates with styles" as its convention, and a survey should
  not quietly overturn a stated lib convention. The child-component route
  respects it and reduces both files.

Resulting: hub ≈ **560** template + ~180 TS ≈ **760**; child ≈ 450.

**Risk**: low. `HarnessWorkflowService` and `WebviewNavigationService` stay on
the parent; the child needs only the option constants from `shared`. 288-line
spec is thin — this is the one place where a hand check of the intake flow
(start → resume → discard) is worth doing.

**Effort**: S, behaviour-preserving. **Rank 13.**

---

## 14. `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` — 1097

**Classification**: child-component extraction — **marginal**; see cross-file
finding B.

**TS-vs-template**: head 81 / template **436** (`82-517`) / **styles 87**
(`518-604`, inline `@keyframes` glow animation) / class **491** (`606-1096`).

**Verdict**: four small concerns, none of which clears the 150-line floor on its
own inside this file:

1. **Auto-scroll** (`121-191`, ~100 lines): `onAgentScroll`,
   `scrollAgentContentToBottom`, `setupMutationObserver`, `scheduleScroll`,
   `cleanup`. This is the twelfth copy of stick-to-bottom in `libs/frontend`
   (finding B) — worth extracting _as a shared directive across all twelve_, not
   worth extracting for this file alone.
2. **Mini reply composer** (`415-457`, ~50): `toggleSendInput`, `onSendDraftInput`,
   `onSendKeydown`, `onSendSubmit`, `flashSentToast`.
3. **Agent actions** (`457-500`, ~45): stop, background, view-transcript.
4. Six injected services and ~200 lines of `computed()` bubble presentation.

**Proposed cut**: none on its own. If finding B is scheduled, this file loses
~100 lines to `AutoScrollToBottomDirective` and lands ≈ 990 — still over 1000
before the directive, just under after. That is the whole available win.

An `AgentReplyComposerComponent` (~130) would be a fragment, and it could not go
to `chat-ui` anyway because `onSendSubmit` calls `AgentMonitorStore` — `chat-ui`
rule 1 forbids components that inject services. Do not cut it.

**Risk**: n/a (recommending no local change). 344-line spec.

**Effort**: S if it rides along with finding B; otherwise skip. **Rank 14.**

---

## 15. `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts` — 1172

**Classification**: child-component extraction — **defer**.

**TS-vs-template**: head 137 / template **528** (`138-665`) / class **505**
(`667-1171`). Near-even.

**Verdict**: two concerns, both real:

1. **Agent CRUD**: `loadAgents`, `toggleAddForm`, `createAgent` (48),
   `resetAddForm`, `startEdit`, `cancelEdit`, `saveEdit` (34), `toggleEnabled`,
   `deleteAgent` (36), `testConnection` (39) — a list + inline add/edit form with
   per-row busy state.
2. **Provider/OAuth plumbing**: `loginWithGitHub` (34 — a second copy of the
   Copilot device-code dance, cousin to `auth-state.service.ts`'s
   `copilotLogin`), `checkCopilotStatus`, `isLocalProvider`,
   `isOptionalKeyProvider`, `onProviderChange`, plus tier-mapping load and the
   model-mapping modal.

The natural cut is `PtahCliAgentFormComponent` (~300) for the add/edit form and
moving `loginWithGitHub`/`checkCopilotStatus` into the `CliLoginService` proposed
in rank 7 — which would delete a genuine duplication between this component and
`AuthStateService`.

**Why defer**: **there is no spec file for this component**, and unlike rank 10
the change is not mechanical — it touches an OAuth device-code flow and a
credential-bearing CRUD form. Doing it blind risks a silent auth regression that
no test will catch. Sequence it _after_ rank 7 lands `CliLoginService` (so the
duplication has somewhere to go) and only with a characterisation spec written
first.

**Risk**: high relative to its size, for the reason above. No cross-lib concern.

**Effort**: M, and it needs a spec before it is safe. **Rank 15.**

---

## 16. `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — 2069 — **EXEMPT (in the main)**

**Classification**: EXEMPT for the bulk of the file; a ~300-line peripheral cut
is available and described below, but it is not where the value is.

**Structure**: head 82, class `83-2068`. ~90 methods under explicit section
banners: `DEPENDENCIES`, `PRIVATE STATE SIGNALS`, `PUBLIC READONLY SIGNALS`,
`COMPUTED SIGNALS`, `FINE-GRAINED SELECTORS`, `TAB LOOKUP`, `INITIALIZATION`,
`WORKSPACE OPERATIONS`, `TAB OPERATIONS`, `INTENT-NAMED MUTATORS` (`951-1711`,
**760 lines**), `ADVANCED TAB OPERATIONS`, `PERSISTENCE`, `STREAMING INDICATOR`,
`ABORT CONTROLLER LIFECYCLE`, `UTILITIES`.

**Verdict — why the count is incidental here**: the 760-line mutator block is
~55 methods averaging under 14 lines each, and the file's own comment states the
rule: _"These are the only allowed public mutation surface. The generic
[`updateTab`] is private… All methods are thin wrappers over `updateTabInternal`
and preserve every [invariant]."_ The width is the design. Every mutator exists
so that no caller can reach `_tabs` with an arbitrary patch, and they are grouped
by intent (`Status transitions`, `Messages`, `Finalization`, `Queue`,
`Compaction`, `Stats and model bookkeeping`, `Session resume / load`, …).

Moving those wrappers into collaborators requires handing `updateTabInternal` —
the single choke point the design exists to protect — to another class. That
trades a long file for a leaked invariant, in a lib whose CLAUDE.md lists four
separate "do not collapse this" rules (branded IDs, `_byTab` vs `_bySurface`,
closed-tab signal not callback, immutable updates). This is the "a file can be
long and fine" case the task description asks the survey to identify.

**The cut that IS available**, if this file must come down:

- `tab-liveness-registry.service.ts` → `TabLivenessRegistry` (~190 lines):
  the `STREAMING INDICATOR` set (`markTabStreaming`, `markTabIdle`,
  `registerVisibleTab`, `unregisterVisibleTab`) plus the `ABORT CONTROLLER
LIFECYCLE` map (`createAbortController`, `getAbortSignal`,
  `clearAbortController`, `abortStreamingForTab`, `isTabStreaming`). These own
  their own `Map`/`Set` and never touch `_tabs` — a clean lift with zero
  invariant exposure.
- `tab-state-persistence.service.ts` → `TabStatePersistence` (~130 lines):
  `saveTabState` (debounce), `_doSaveTabState`, `loadTabState`. Serialisation
  format and per-workspace `localStorage` keys are a storage concern, and it
  takes the tab array as an argument rather than reaching for it. Under the
  150 floor, and I am flagging that rather than padding the claim.

Resulting: ≈ **1750**. That is a 15 % reduction for two files' worth of churn on
the repo's most invariant-dense state service. I do not recommend it before
ranks 1-8 are done, and possibly not at all.

**Risk if attempted**: `TabManagerService` is injected by `chat`,
`chat-streaming`, `chat-routing`, `canvas`, `dashboard` and electron surfaces.
The 235-line spec is the **weakest cover-to-size ratio in the partition**
(235 lines of spec for 2069 lines of service) — which is the strongest single
argument for leaving it alone: there is almost nothing to catch a regression.

**Effort**: — (recommend no action). **Rank 16.**

---

## Suggested execution order

1. **Cross-file finding A** — `PointerDragDirective` in `libs/frontend/ui`
   (unblocks and shrinks ranks 1 and 3 together).
2. Rank 1 `chat-view` → `SessionRewindService`.
3. Rank 2 `tasks-store` → `TasksBulkRunner` + `TasksBoardFeed` + types.
4. Ranks 3, 5, 6, 7 in any order (independent libs, all spec-covered).
5. Rank 4 `diff-view` on its own, with a visual pass.
6. Ranks 8-13 as filler batches.
7. Rank 14 only as part of cross-file finding B; rank 15 only after rank 7 and a
   characterisation spec; rank 16 not at all.

**Guardrail compliance note**: across all 16 files this survey proposes **21 new
files**, not 40. Three of them (`monaco-language-detection.ts` ~90,
`palette-dispatch.ts` ~90, `TabStatePersistence` ~130) fall under the 150-line
floor, and each is called out at its own entry with the reason it is still worth
having — rather than silently counted as a win. No proposal pushes a constructor
past ~6 injected dependencies. No proposal crosses the
`libs/frontend` → `libs/backend` boundary, and the only new cross-lib edge
suggested anywhere is `editor` → `@ptah-extension/ui` for the shared drag
directive, which is a permitted frontend-to-frontend primitives edge that
`editor` already uses for its branch-picker overlays.

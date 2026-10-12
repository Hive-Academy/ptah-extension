# Batches - TASK_2026_629_c0b3

Total tasks: 33 (+ BL, B9 placeholders) | Batches: 17 (15 executor batches, BL placeholder, B9 manual) | Complete: 0/17

Root: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5` (written `<root>` below).
Task folder: `<root>\.ptah\specs\TASK_2026_629_c0b3\`.
Sources: implementation-plan.md (wins over parts), plan-part-1.md (steps 1-3), plan-part-2.md
(steps 4-5), plan-part-3.md (steps 6-7), plan-part-4.md (leak; sections 2-6 still TBD), task-description.md.

## Execution defaults (chosen by team-leader, recorded here)

- Plan batches B2, B5, B7, B8 exceed the 6-file / 2-lib cap and are split (B2a/b/c, B5a/b, B7a/b, B8a/b).
  Order and dependencies of plan §7 are kept, with one change: the D8 hunk (optional `tabId` on
  `handlePermissionResponse`) moves from B4 to a new first batch **B0**, because the B2c card
  callout must already pass `tabId` (Plan issue 1).
- Executor for every code batch: `frontend-developer` sub-agent, sequential. Fallback: a fresh
  `frontend-developer` with the batch section and report paths. No batch is parallel: every batch
  edits a shared barrel, token file or a file another batch also edits.
- No commits until the user approves commits. Team-leader commits each batch only after approval.
- Run order: B0 → B1 → B2a → B2b → B2c → B3 → B4 → B5a → B5b → B6 (gate) → B7a → B7b → B8a → B8b →
  BL (after plan-part-4 merge) → [rebase over 628] → B10 → B9 (manual, user).

## Shared-file hunk ownership (edit order = batch order)

| File (under `<root>\libs\frontend\`) | Batches in order | Hunk owner per batch |
|---|---|---|
| `chat-streaming/src/lib/permission-handler.service.ts` (+spec) | B0 | optional `tabId` param, `decidingTabId` at ~:426 |
| `chat/.../compact-session/compact-session-card.component.ts` (+spec) | B1 → B2c | B1: sampler, `equal` fns, `tabId` computed, `summary`. B2c: `laneSummary`, `callout`, Allow/Deny/Show output handlers, optional `SESSION_CARD_ACTIONS` inject. B2c must not touch the sampler. |
| `chat/src/lib/tokens/session-context.token.ts` | B2b → B5a | B2b: `SESSION_CARD_ACTIONS`. B5a: `SESSION_FORCED_CARD` beside `SESSION_FOCUSED` (:42). |
| `chat/src/index.ts` | B2b → B5a | B2b: responder, `SESSION_CARD_ACTIONS`, lane-key builder. B5a: `SESSION_FORCED_CARD` (only if not already exported via the token file export). |
| `chat-ui/src/index.ts` | B2a | lane types export |
| `canvas/src/lib/orchestra-canvas.component.ts` | B3 → B4 → B7b | B3: new-session gate (`:118-129` trigger, `:391-397` effect, `:550-555` `handleCreateSession`), header message signal. B4: `<ptah-canvas-needs-you-queue />` between `ptah-canvas-layout-controls` (:111-116) and the `canAddTile()` block, plus import. B7b: `CanvasDetailService` provider, `detailTabId`, binding `:186-190`, Esc / ←/→ keydown. |
| `canvas/src/lib/orchestra-canvas.component.spec.ts` | B3 → B4 | B3: cap specs. B4: header queue presence. |
| `canvas/src/lib/canvas.store.ts` (+spec) | B3 | 2 computeds + comment `:85-91` |
| `canvas/src/lib/canvas-workspace-grid.component.ts` | B5b → B6 → B7b → BL | B5b: `[autoCard]` binding (template ~:126-130) + protected `isAutoCardTile`. B6: provisional H1-H4 (`detailTabId` input ~:202, below-detail computed near ~:362, detail host after ~:144, styles) — reverted on NO-GO. B7b: `detailOpen` term in the `autoCard` binding (D1) and service wiring. BL: `applyAuthoritativeGeometry` (:717-826), `ngOnDestroy` (:883-886), `creationOptions` (:321-329). No 629 batch except BL edits :717-826. |
| `canvas/src/lib/canvas-workspace-grid.component.spec.ts` | B5b → BL | B5b: AC 1.1-1.5. BL: leak specs. |
| `canvas/src/lib/canvas-tile.component.ts` (+spec) | B5b → B7b → B8b | B5b: `autoCard` input, `SESSION_FORCED_CARD` provider (:616-626). B7b: `SESSION_CARD_ACTIONS` provider, card-mode click/keyboard to detail (AC 4.9). B8b: `HIDE_AGENT_SIDEBAR` provider. Provider list stays an array. |
| `canvas/src/lib/canvas-needs-you-queue.component.ts` | B4 → B7b | B4: create (Open session = `focusTile`). B7b: Open session opens the detail (AC 6.5). |
| `canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts` | B7a → B8a | B7a: create (header, notch, Orchestrator view, details column). B8a: mount lane tabs + lane view. |

Never touch (TASK_2026_628): `compact-session-summary.ts`, `chat-transcript.component.ts`,
`libs/frontend/markdown`, `batched-update.service.ts`, the execution tree builder, the
`AGENT_SUMMARY_CHUNK` handler in `chat-lifecycle.service.ts`, `agent-monitor.store.ts`, agent-card
and agent-card-output files, `tab-manager.service.ts`, `stream-presentation-store.service.ts`,
`apps/ptah-extension-webview/src/styles.css`. Never add `content-visibility`.

## Verification rules (STRICT, CLAUDE.md) — copy into every executor prompt

- Test only changed projects, one at a time:
  `npx nx test @ptah-extension/<project> --parallel=1`, `npx nx typecheck @ptah-extension/<project> --parallel=1`,
  `npx nx lint @ptah-extension/<project> --parallel=1`; or Jest on changed specs:
  `npx jest -c libs/frontend/<lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
  Projects: `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `@ptah-extension/chat-streaming`.
- One heavy check at a time (TASK_2026_628 runs checks on this machine). No workspace-wide runs,
  no `nx run-many` over unchanged projects. No build/serve/dev/e2e/package.
- Filter output (`| tail -40`, `grep`). Do not re-run only to read output. Do not run `npm install`.
- Do not reintroduce `content-visibility`. Do not edit the 628-owned files above. No git commands.
- Every batch starts with its "Check first" list. If a check fails, stop and report; do not invent a workaround.

## Plan validation

Status: PASSED WITH RISKS

Assumptions (verified by team-leader on disk, 2026-10-12):

- `HIDE_AGENT_SIDEBAR` already exists (`chat/src/lib/tokens/session-context.token.ts:20`); B8b only provides it — verified.
- `SESSION_FOCUSED` at `session-context.token.ts:42` — verified. `SESSION_FORCED_CARD` / `SESSION_CARD_ACTIONS` do not exist yet — verified.
- `agentVisibleInSession` at `chat-streaming/src/lib/session-scope.ts:60` — verified; barrel export unverified (B2b checks).
- `handlePermissionResponse(response)` at `permission-handler.service.ts:408`, single param — verified. Also wrapped by `ChatStore.handlePermissionResponse` (`chat/src/lib/services/chat.store.ts:477`) — B0 checks whether the wrapper needs the param.
- `MAX_CANVAS_TILES = 20` at `canvas-layout-intent.ts:13` — verified.
- Part 1 A1-A10, part 2 A1-A6, part 3 A1-A8 — unverified; each is a "Check first" item in its batch.

| Risk | Severity | Mitigation |
|---|---|---|
| Wrong deciding tab for answers from card/queue/lane (D8) | HIGH | B0 lands first; B2c, B4, B8a pass the request's `tabId` |
| `clearPermission(agentId)` without `requestId` drops the wrong entry | HIGH | B2b responder always passes `requestId`; spec in B2b |
| Sampler leaks a timer or delays urgent signals | MEDIUM | B1 specs (fake timers, `getTimerCount() === 0`, permission visible without advancing) |
| Grid geometry changes on focus/detail | HIGH | B5b and B6 specs compare every engine node `{x,y,w,h}` |
| Spike NO-GO | MEDIUM | B6 gate; fallback (c) bottom panel, grid file reverted to its B5b state |
| More than one transcript mounted | HIGH | B7b spec: 6 sessions → 1 transcript host; D1 `detailOpen` term |
| Lane output fork of `ptah-agent-card` | MEDIUM | B8a grep check: no `ptah-agent-card*` selector under `libs/frontend/canvas` |
| Cap start guard lands in the 628 `AGENT_SUMMARY_CHUNK` handler | HIGH | B10 after rebase; guard located in the send path only |
| Detached tile leak (628 hot spot 7) | HIGH | BL, after plan-part-4.md is complete |
| Elapsed time frozen when lanes run but the session stream is quiet | MEDIUM | B2c: tick `now` with one interval only while a lane is running, cleared on destroy (Plan issue 4) |

Edge cases:

- Focused tab id null with > budget tiles → every tile is a card (accepted, part 1) — B5b spec.
- Tile closed while its detail is open → detail closes, no element left — B7b.
- Selected lane key no longer resolves → Orchestrator tab — B8a.
- Unknown agent status → mapped to `running`, never dropped — B2b.
- Null session id (new empty tile) is not running — B3.
- Two sessions with simultaneous permissions; answering one leaves the other — B4.
- Allow/Deny post fails → callout stays (no local clear first) — B2b/B2c.

## Plan issues

Not fixed silently; the defaults chosen are recorded and the architect may overrule.

1. **D8 ordering contradiction.** D8 says the card callout (step 3, plan B2) always passes `tabId`, but
   the optional `tabId` lands in plan B4, after B2. Default: new batch B0 (chat-streaming) runs first.
2. **Batch numbering slip in §6.** "Batches 3 and 7 compare the card zones and the queue popover with
   the prototype" — by §7 these are B2 (step 3) and B4 (step 6). Applied to B2a and B4.
3. **Spike is not spec-only.** Plan §7 lists B6 as spec + note, but the spike asserts (part 2 :56-68)
   need `detailTabId`, the detail host and the `ptah-below-detail` class in the grid, i.e. grid H1-H4.
   Default: B6 adds H1-H4 provisionally; on NO-GO the executor reverts the grid file to its B5b state.
   Spec file name: plan says `canvas-workspace-grid.detail.spec.ts`, part 2 says
   `canvas-detail-row.spike.spec.ts`; the plan name is used.
4. **Elapsed time gap.** Part 1 ticks `now` only on sampler (stream) events; lanes running under a
   quiet session freeze. Default: B2c adds one 1 s interval active only while a lane is running.
5. **Unowned wiring.** No §7 batch owns: the tile `SESSION_CARD_ACTIONS` provider (D4), card click →
   detail, the card `role`/Enter/Space (AC 4.9), or queue "Open session" → detail (AC 6.5, needs B7).
   Part 2 also expects a `data-canvas-card` host and a board-mode signal "from part 1" that part 1
   never defines. Default: all owned by B7b; the card-mode click/keyboard lives on the tile host.
6. **Responder location.** Part 2 puts `agent-permission-responder.ts` in canvas; D3 moves it to
   `chat`. D3 used. Check: `chat` may import `VSCodeService` / `MESSAGE_TYPES` under its Nx tags (B2b).
7. **Grid overlap text is stale in part 2** (says 628 Batch 7 edits the grid lifecycle). Plan §5.4
   moved that to 629 BL. BL owns `:717-826`, `:883-886`, `:321-329`; no other batch edits them.
8. **plan-part-4.md is incomplete** (sections 2-6 TBD). BL is a placeholder.
9. **B10 needs a rebase over 628**, a git operation that needs the user's go-ahead; B9 needs `main`
   after 628 merges and is manual. Neither can run in this worktree today.
10. **AC 3.7 / UI evidence.** Card offsets and the board need screenshots in the task folder; Mode 3
    needs dark + light visual-reviewer screenshots against `prototypes/01-board.html` (path in the
    task folder unverified). Add a visual review to phases A and D.

---

## Phase A — status card (B0, B1, B2a, B2b, B2c) | Phase review: code-logic + style (new public API: responder, `SESSION_CARD_ACTIONS`, lane types) + visual

## Batch B0: deciding tab for permission answers (D8) — IN_PROGRESS

- Recommended executor: frontend-developer (sub-agent) | Fallback: fresh frontend-developer
- Execution mode: sequential | Rationale: one service + spec, one project
- Tasks: 1 | Depends on: none | Phase: A

### Task B0.1: optional `tabId` on `handlePermissionResponse` — IN_PROGRESS

- Files: `<root>\libs\frontend\chat-streaming\src\lib\permission-handler.service.ts`, its `.spec.ts`
- Plan reference: implementation-plan.md:118-133 (D8)
- Check first: `decidingTabId` is set from `tabManager.activeTabId()` near :426; `StreamRouterService`
  (`chat-routing/src/lib/stream-router.service.ts:87-96`) is the only `decisionPulse` reader. Stop if
  `decisionPulse` has another reader.
- Implementation: `handlePermissionResponse(response, tabId?: string)`; `decidingTabId = tabId ?? activeTabId()`.
  Existing callers unchanged. Only if the card will call `ChatStore.handlePermissionResponse` add
  the same optional param there (otherwise do not touch `chat.store.ts`).
- Tests: explicit `tabId` ≠ active tab publishes `decidingTabId = tabId`; no `tabId` → active tab (as today).
- Verify: `npx jest -c libs/frontend/chat-streaming/jest.config.ts <spec> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/chat-streaming --parallel=1`, `npx nx lint @ptah-extension/chat-streaming --parallel=1`.

## Batch B1: sampled card summary (step 2) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 1 | Depends on: none | Phase: A

### Task B1.1: 500 ms sampler in `CompactSessionCardComponent` — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts` (+ `.spec.ts`, modify or create)
- Plan reference: implementation-plan.md:84-89 (D5); plan-part-1.md:79-114
- Check first: A6 (`targetsTab` reads `this.tab()`), A7 (`TabState.streamingState` type name);
  `summarizeLive` has one caller (:122-139). Stop if `compact-session-summary.ts` would need a diff.
- Implementation: `CARD_SUMMARY_SAMPLE_MS = 500` exported; `tabId` computed; immediate parts with
  `equal` fns (status, terminal reason, identity, questions, permissions, metrics); one sampler
  effect; finalized branch via a `messages` computed; `DestroyRef.onDestroy` clears the timer.
  First live event renders at once. Runs for every card (no canvas gate).
- Acceptance: AC 2.1-2.5.
- Tests: fake timers + `jest.spyOn(summarizeLive)`: 100 stream updates in 1 s → ≤ 3 calls; permission /
  question / error / status visible without `advanceTimersByTime`; stream end → `summarizeFinalized`;
  destroy → `jest.getTimerCount() === 0`.
- Verify: Jest on the card spec (`-c libs/frontend/chat/jest.config.ts`), then `nx typecheck` + `nx lint` `@ptah-extension/chat`.

## Batch B2a: lane types and presentational zones (step 3, chat-ui) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 2 | Depends on: none | Phase: A

### Task B2a.1: `compact-lane.types.ts` + barrel — PENDING

- Files: `<root>\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-lane.types.ts` (create), `<root>\libs\frontend\chat-ui\src\index.ts`
- Plan reference: plan-part-1.md:127-132
- Implementation: `CompactLaneKind`, `CompactLaneStatus`, `CompactLaneRow`, `CompactLaneSummary`, `CompactCallout` (permission callout also carries `tabId` for D8).

### Task B2a.2: five-zone `CompactSessionActivityComponent` — PENDING

- Files: `<root>\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts` (+ `.spec.ts`)
- Plan reference: plan-part-1.md:142-149
- Check first: A9 (branch / elapsed in `CompactSessionSummary` or new inputs); A10 + plan issue 2:
  open `prototypes/01-board.html` and `shared.css` for zone order, icons, pill colours before coding.
- Implementation: inputs `lanes`, `callout`, `now`, `branch`, `elapsed`; outputs `allow`, `deny`,
  `showOutput`, `retry`, `laneSelected(laneKey)`. Zones: header → branch · model · elapsed → Now →
  Lanes (summary line + max 3 rows, or callout) → metrics. Fixed min-heights + placeholders. No store
  injection (AC 3.8). Animations only `transform`/`opacity`. No `content-visibility`.
- Acceptance: AC 3.1, 3.3, 3.5 (render side), 3.6, 3.7, 3.8.
- Tests: zone order, placeholders, "+N more lanes", callout replaces rows and keeps the summary line, outputs fire.
- Verify: Jest on the spec (`-c libs/frontend/chat-ui/jest.config.ts`), then `nx typecheck` + `nx lint` `@ptah-extension/chat-ui`.

## Batch B2b: responder, lane rows, card-actions token (step 3, chat) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 3 | Depends on: B0, B2a | Phase: A

### Task B2b.1: `AgentPermissionResponder` — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\services\agent-permission-responder.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:55-68 (D3); plan-part-2.md:283-289
- Check first: A4 (session response method); CLI path `canvas/src/lib/tile-agent-mini-panel.component.ts:125-143`;
  `clearPermission(agentId, requestId?)` signature (`agent-monitor.store.ts:1494-1513`, read only);
  `chat` Nx tags allow `VSCodeService` / `MESSAGE_TYPES`. Stop if a tag rule blocks it.
- Implementation: `respondLane(agentId, requestId, decision, reason?)` posts
  `AGENT_MONITOR_PERMISSION_RESPONSE` then `clearPermission(agentId, requestId)`;
  `respondSession(request, decision, tabId)` calls `handlePermissionResponse(..., tabId)` (B0).
  No new host channel. On post failure do not clear.
- Tests: requestId always passed; second queued entry untouched; tabId forwarded.

### Task B2b.2: `buildLaneSummary` + lane-key builder — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-lane-rows.ts` (+ `.spec.ts`)
- Plan reference: plan-part-1.md:133-136; implementation-plan.md:80-82 (D4 key builder lives here)
- Check first: A3 (`agentsForSession`, `sessionSubagentsForSession`, `permissionQueue`, status strings);
  `agentVisibleInSession` exported from the `chat-streaming` barrel.
- Implementation: pure; scope CLI lanes with `agentVisibleInSession`; sort waiting, error, running,
  done, stopped, then newest; cap 3; `moreCount`; unknown status → `running`; export `laneKey(kind, id)`.
- Acceptance: AC 3.2-3.4. Tests: cap 3, `moreCount`, sort, scope filter, unknown status kept, key format.

### Task B2b.3: `SESSION_CARD_ACTIONS` token + barrel — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\tokens\session-context.token.ts`, `<root>\libs\frontend\chat\src\index.ts`
- Implementation: `SESSION_CARD_ACTIONS: InjectionToken<{ openLane(laneKey: string): void; openSession(): void }>`;
  export it, the responder and `laneKey`.
- Verify (batch): Jest on the two new specs (`-c libs/frontend/chat/jest.config.ts`), then `nx typecheck` + `nx lint` `@ptah-extension/chat`.

## Batch B2c: card wiring (step 3) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 1 | Depends on: B1, B2a, B2b | Phase: A (last batch → phase review)

### Task B2c.1: lane summary, callout and actions in the card — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts` (+ `.spec.ts`)
- Plan reference: plan-part-1.md:137-141; D3, D4
- Check first: A8 (which error states have a retry action today). Do not touch the B1 sampler.
- Implementation: `laneSummary` computed from public store signals; `callout` (session permission →
  CLI permission scoped → error); Allow/Deny via the responder with the request's `tabId`; Show
  output → `expandToFull`; lane row → `SESSION_CARD_ACTIONS.openLane` when injected, else `expandToFull`;
  elapsed `now` ticks with one interval only while a lane runs, cleared on destroy (Plan issue 4).
- Acceptance: AC 3.1-3.6, 3.9.
- Tests: callout swap; Allow/Deny call the responder with the right ids; token absent → `expandToFull`; no timer after destroy.
- Verify: Jest on the card spec, then `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/chat` (one at a time). Screenshot of two cards side by side (AC 3.7) goes in the task folder at phase review.

---

## Phase B — canvas header (B3, B4) | Phase review: code-logic

## Batch B3: running-session cap (step 7) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 3 | Depends on: none | Phase: B

### Task B3.1: `canvas-running-cap.ts` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-running-cap.ts` (+ `.spec.ts`)
- Plan reference: plan-part-3.md:112-138
- Check first: A5 (in-flight `TabState.status` values), A6 (`AgentStatus` terminal values), A7 (`SubagentRecord.status`). Stop if a source has no status.
- Implementation: `MAX_RUNNING_SESSIONS = 9`; pure `countRunningSessions`; a session counts once; null id not running; canvas sessions only (A8).

### Task B3.2: `CanvasStore` computeds + comment — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas.store.ts` (+ spec)
- Implementation: `runningSessionCount`, `canStartRunningSession`; replace the stale comment at :85-91. `MAX_TILES` / `canAddTile()` unchanged.

### Task B3.3: gate the canvas new-session paths — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts` (+ `.spec.ts`)
- Plan reference: plan-part-3.md:147-160
- Implementation: disabled trigger with `title` + `aria-describedby` text "9 sessions are running. Wait for one to finish to start another."; guard in `handleCreateSession` (:550-555) and the `newCanvasSessionRequest` effect (:391-397); header message signal clears when a slot frees. Adopt/open (:497-522) unchanged.
- Acceptance: AC 7.1-7.6. Tests: plan-part-3.md:154-160 items 1-6.
- Verify: Jest on the 3 specs (`-c libs/frontend/canvas/jest.config.ts`), then `nx typecheck` + `nx lint` `@ptah-extension/canvas`.

## Batch B4: needs-you queue (step 6) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 3 | Depends on: B0, B2b, B3 | Phase: B (last → phase review)

### Task B4.1: `buildNeedsYouItems` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-needs-you-queue.ts` (+ `.spec.ts`)
- Plan reference: plan-part-3.md:44-72
- Check first: `routingTargetRevision()` / `targetTabsFor` (`permission-handler.service.ts:61-69,360`); `pendingPermissions` (`agent-monitor.store.ts:985-988`); how the host treats a stale lane `requestId` (part 3 A).
- Implementation: pure merge of session permissions, questions and lane `permissionQueue` entries for canvas tabs; tab from `tabId`, then target tabs, then `sessionId`; read the revision signal first.

### Task B4.2: `CanvasNeedsYouQueueComponent` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-needs-you-queue.component.ts` (+ `.spec.ts`)
- Check first: compare the popover with `prototypes/01-board.html` + `shared.css` (Plan issue 2).
- Implementation: "N need you" / "All clear" button, `ptah-native-popover`; Allow/Deny via the B2b responder with the item's `tabId`; questions: Open session only (`focusTile` now; detail in B7b). Never reorders cards.
- Acceptance: AC 6.1-6.4, 6.6, 6.7 (6.5 completed in B7b).
- Tests: two sessions with simultaneous requests, answering one leaves the other; item leaves after an answer elsewhere.

### Task B4.3: header integration — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts` (+ spec)
- Implementation: element between layout controls (:111-116) and the `canAddTile()` block; import only.
- Verify (batch): Jest on the 3 specs, then `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/canvas` (one at a time).

---

## Phase C — automatic card mode (B5a, B5b) | Phase review: code-logic + style (new token `SESSION_FORCED_CARD`)

## Batch B5a: forced-card token and ChatView gate (step 1, chat) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 2 | Depends on: B1-B4 | Phase: C

### Task B5a.1: `SESSION_FORCED_CARD` — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\tokens\session-context.token.ts`, `<root>\libs\frontend\chat\src\index.ts`
- Check first: A1 (how `SESSION_FOCUSED` is exported).

### Task B5a.2: `showCompactCard` in `ChatViewComponent` — PENDING

- Files: `<root>\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`, `.html`, `.spec.ts`
- Plan reference: implementation-plan.md:23-53 (D1, D2); plan-part-1.md:57, :71
- Check first: A5 — does the agent sidebar block (`chat-view.component.html:268-354`) mount inside a canvas tile? If yes, gate it on `!showCompactCard()` too.
- Implementation: optional inject; `showCompactCard = forced() || isCompactViewMode(resolvedViewMode())`; `@if` at :4. `resolvedViewMode` unchanged; stored mode never written.
- Tests: token true → card, transcript not mounted; token absent → today; existing `:2244` block passes.
- Verify: Jest on chat-view spec, then `nx typecheck` + `nx lint` `@ptah-extension/chat`.

## Batch B5b: live budget in the grid and tile (step 1, canvas) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 3 | Depends on: B5a | Phase: C (last → phase review)

### Task B5b.1: `canvas-live-budget.ts` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-live-budget.ts` (+ `.spec.ts`)
- Implementation: `CANVAS_LIVE_BUDGET = 2`; `isAutoCardTile(tileCount, focused, budget)` (no `detailOpen` term yet, D1). Tests: 1/2/3 tiles × focused/unfocused; budget 3.

### Task B5b.2: tile `autoCard` input + provider — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-tile.component.ts` (+ spec)
- Implementation: `autoCard = input(false)`; `{ provide: SESSION_FORCED_CARD, useValue: this.autoCard }` in `ngOnInit` (:616-626). No `ElementRef` arrays.

### Task B5b.3: grid binding — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts` (+ spec)
- Check first: A2 (grid's own rendered item count; else workspace-scoped `canvasStore.tiles()`).
- Implementation: `[autoCard]` binding (~:126-130) + protected `isAutoCardTile`. No other hunk.
- Acceptance: AC 1.1-1.8. Tests: per-tile bindings; every engine node `{x,y,w,h}` equal across a focus change; stored mode not written.
- Verify: Jest on the 3 specs, then `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/canvas` (one at a time).

---

## Phase D — detail row and lane tabs (B6, B7a, B7b, B8a, B8b) | Phase review: code-logic + style (new canvas components) + visual (dark + light vs prototype)

## Batch B6: Gridstack spike — go/no-go gate (step 4) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 2 | Depends on: B5b | Phase: D

### Task B6.1: spike spec + provisional grid hunks — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-workspace-grid.detail.spec.ts` (create), `<root>\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts` (H1-H4 provisional, Plan issue 3)
- Plan reference: implementation-plan.md:91-101 (D6), :284-286; plan-part-2.md:43-77
- Implementation: 5 asserts (6 tiles, record nodes; open detail + `locked`; nodes equal, host is a sibling of `gridstack`, `ptah-below-detail` on lower rows; forced apply pass; close → no element/class, nodes equal). Overlay option (b) only; no node in `:717-826`.

### Task B6.2: `spike-detail-row.md` — PENDING

- File: `<root>\.ptah\specs\TASK_2026_629_c0b3\spike-detail-row.md`
- Record the result and the option name. The manual webview check (alignment within 8 px, rows below visible, scroll height grows) is done by the user/visual-reviewer; the batch stops there.
- Gate: GO → keep H1-H4, B7 uses (b). NO-GO → revert the grid file to B5b state, B7 uses (c) bottom panel with no grid edit.
- Verify: Jest on the detail spec, then `nx typecheck` + `nx lint` `@ptah-extension/canvas`.

## Batch B7a: detail service and panel components (step 4) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 2 | Depends on: B6 (decision recorded) | Phase: D

### Task B7a.1: `CanvasDetailService` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail.service.ts` (+ spec)
- Implementation: `detailTabId`, `laneKey`, `open(tabId, laneKey?)`, toggle, close, next/prev with wrap in tile order; opening focuses the tab (D1); lane key format = `laneKey()` from chat (D4).

### Task B7a.2: panel, Orchestrator transcript, session details — PENDING

- Files: `canvas-detail\canvas-detail-panel.component.ts`, `canvas-detail\canvas-detail-transcript.component.ts`, `canvas-detail\canvas-session-details.component.ts` (+ spec) under `<root>\libs\frontend\canvas\src\lib\`
- Check first: part 2 A (context-bar and git components exist); the transcript uses `ChatViewComponent` on the normal tab path, no `buildTree`, no cache key.
- Implementation: header + notch + tab strip host + view + 300 px details column (context bar, tokens, cost, turns, todos, git; no agent list); `HIDE_AGENT_SIDEBAR` in the transcript.
- Acceptance: AC 4.5 (component side), 4.6.
- Verify: Jest on the 2 new specs, then `nx typecheck` + `nx lint` `@ptah-extension/canvas`.

## Batch B7b: detail wiring into the canvas (step 4) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 4 | Depends on: B7a | Phase: D

### Task B7b.1: canvas host — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`, `<root>\libs\frontend\canvas\src\lib\orchestra-canvas.detail.spec.ts` (create)
- Implementation: provide `CanvasDetailService`; binding :186-190; Esc closes; ←/→ move with wrap; tile closed while open → close; ≤ budget → no detail.

### Task B7b.2: grid `detailOpen` term — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`
- Implementation: `autoCard = count > budget && (tabId !== focused || detailOpen)` (D1); feed `detailTabId` from the service into H1-H4 (GO) — no grid edit on NO-GO.

### Task B7b.3: tile card actions + keyboard — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\canvas-tile.component.ts` (+ spec)
- Implementation: provide `SESSION_CARD_ACTIONS` → service; card-mode tile host gets `role="button"`, Enter/Space and click toggle the detail (AC 4.9, Plan issue 5).

### Task B7b.4: queue "Open session" → detail — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\canvas-needs-you-queue.component.ts`
- Implementation: closes the popover, opens the detail on the session, on the lane when the requester is a lane (AC 6.5).
- Also (orchestrator addition): the card's question callout (`AskUserQuestion`) gets an "Answer" button that opens the detail on the Orchestrator tab of that session, where the normal question form renders. It goes through `SESSION_CARD_ACTIONS.openSession()`. Outside the canvas (token absent) it uses the card's `expandToFull`. No inline question form on the card or in the queue (task-description.md:80).
- Also (orchestrator addition, user follow-up): the card's permission callout keeps inline Allow/Deny (B2c) and gets an "Open" action for long commands, file edits or options that exist only in the full permission UI. "Open" opens the detail on the session (Orchestrator tab) for a session permission, or on the lane tab for a CLI-lane permission, through `SESSION_CARD_ACTIONS` (`openSession()` / `openLane(laneKey)`). Outside the canvas it uses `expandToFull`. With several pending requests, the callout shows the oldest one plus "+N more".
- Acceptance (batch): AC 4.2-4.5, 4.7-4.9, 6.5. Tests: `x/y/w/h` of all tiles equal before/after open and close; 6 sessions → transcript host count 1; Esc / same-card click close; arrows wrap; tile close removes the detail element.
- Verify: Jest on the changed specs, then `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/canvas` (one at a time).

## Batch B8a: lane tabs and lane view (step 5) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 3 | Depends on: B7b | Phase: D

### Task B8a.1: `CanvasLaneTabsComponent` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.ts` (+ spec)
- Check first: part 2 A5 (`BackgroundAgentStore` session-scoped public signal).
- Implementation: Orchestrator, Sub-agents, CLI lanes, Background; empty hidden; `role="tablist"`; terminal lanes keep their tab; unresolved key → Orchestrator.

### Task B8a.2: `CanvasLaneViewComponent` — PENDING

- Files: `<root>\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.ts` (+ spec)
- Check first: part 2 A6 (output renders only when `agent().expanded`; public store method to expand). Stop if none exists (628 request R2).
- Implementation: one `@switch`; `ptah-agent-card` unchanged; sub-agent pair from the monitor panel; Stop via existing paths (`stopAgent(taskId, ownerSessionId)`); Allow/Deny via the responder with `tabId`.

### Task B8a.3: mount in the panel — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-panel.component.ts`
- Acceptance: AC 5.1-5.6, 5.8. Tests: group order, scope filter, one `ptah-agent-card` at a time, switch destroys previous, stop/permission calls. Grep: no `ptah-agent-card*` selector declared under `libs/frontend/canvas`.
- Verify: Jest on the 2 specs, then `nx typecheck` + `nx lint` `@ptah-extension/canvas`.

## Batch B8b: mini panel responder + tile sidebar hide (step 5) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 2 | Depends on: B8a | Phase: D (last → phase review)

### Task B8b.1: mini panel delegates to the responder — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.ts` (+ existing spec stays green)
- Implementation: `:125-143` call `AgentPermissionResponder` (now passes `requestId`).

### Task B8b.2: `HIDE_AGENT_SIDEBAR` in the tile — PENDING

- File: `<root>\libs\frontend\canvas\src\lib\canvas-tile.component.ts` (+ spec)
- Acceptance: AC 5.7. Test: token resolves `true` inside the tile; single chat view unchanged.
- Verify: Jest on the 2 specs, then `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/canvas` (one at a time).

---

## Phase E — detached tile leak | Phase review: code-logic

## Batch BL: detached canvas tile leak (628 hot spot 7) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 1 | Depends on: B5b | Phase: E
- **Placement (orchestrator decision, overrides the provisional "after B8b"):** run BL right
  after B5b and before the B6 spike, so the spike measures the fixed grid (plan-part-4.md
  batch recommendation). BL edits other regions of the grid file than B5b/B6/B7b.
- Plan reference: plan-part-4.md (all sections), implementation-plan.md §5 item 4.

### Task BL.1: release stale Gridstack nodes without moving live tiles — PENDING

- Files: `canvas-workspace-grid.component.ts` (modify: `applyAuthoritativeGeometry` ~:717-826,
  new private `releaseStaleNodes`, `ngOnDestroy` ~:883-886 adds `creationOptions.clear()`; no
  template/input/computed edits); `canvas-grid-release.ts` (create: pin, unpin, stale-node
  selection); `canvas-grid-release.engine.spec.ts` (create: REAL `GridStackEngine`, no mock);
  `canvas-workspace-grid.component.spec.ts` (modify: `removeWidget` on the mock + unit tests);
  `canvas-render-metrics.service.ts` (modify: `releasedNodes`, `geometryDrift` counters).
- Check first: (1) does any canvas code already set node-level `locked`? (2) does `load()`
  move a locked node on a collision? (the real-engine test settles it). (3) Parent review:
  read `gridstack.js` `load()` — does it update existing nodes in place (keeps `locked`) or
  remove and re-add them (the grid comment at ~:789-792 says it removes matching nodes)? If
  it re-adds, the items passed to `load()` must carry `locked: true` for pinned nodes during
  that apply, then restore. (4) Check that a locked node still accepts the authoritative
  `x/y` from `load()` (some gridstack paths refuse to move a locked node). Stop and report
  if pinning cannot hold row-break gaps, or if (3)/(4) change the design.
- Implementation: pin live engine nodes (`locked = true`, saved values) → release stale
  nodes (found from the intent tile set `this.tiles()`, not from `positioned`) → compute
  `changed` → existing `load(..., false)` → restore the saved `locked` values in the outer
  `finally`. Grid lookup moves above the `positioned.length === 0` return. Release all only
  when the tile SET is empty; a zero-size measurement releases stale nodes only. Skip the
  release while `_gesture !== null`.
- Tests: real-engine row-break gap survives a release, plus the same steps without the pin
  that must show the tile moving up. The real-engine test goes through the real
  `GridStack.load(items, false)` path (not a direct engine call) and asserts both: the
  row-break gap is kept AND every live node equals the derived layout after the outer
  `finally` restores `locked`; mock-grid: release order, ghost node, active gesture,
  zero width, zero height, empty set, `locked` restored when `load` throws, destroy.
- Acceptance (moved from 628): no detached `ptah-canvas-tile` / `gridstack-item` tree after a
  tile closes — manual heap-snapshot steps in plan-part-4.md §5 (from 628 Part B3 §5).
  Risk: gaps that collapsed at every `load()` close now stay; visual check in the phase review.
- Verify: Jest on the 2 changed/new specs (`--coverage=false --maxWorkers=2`), then
  `nx test` + `nx typecheck` + `nx lint` `@ptah-extension/canvas` (`--parallel=1`, one at a time).

---

## Phase F — cap start guard | Phase review: code-logic

## Batch B10: running-cap start guard in the send path (D7) — PENDING

- Executor: frontend-developer | Mode: sequential | Tasks: 1 | Depends on: B3, and the rebase over 628 (Batch 3 merged; user go-ahead) | Phase: F

### Task B10.1: guard the send/start-turn path — PENDING

- File: located by the executor (may be `<root>\libs\frontend\chat\src\lib\services\chat-lifecycle.service.ts`) (+ spec)
- Plan reference: implementation-plan.md:103-116 (D7)
- Check first: locate the exact send path; confirm the guard can read the canvas count without `chat` importing `canvas` (stop and report if it cannot — likely needs an optional token provided by the canvas). Stay out of the `AGENT_SUMMARY_CHUNK` handler (~:186-196).
- Implementation: blocked send keeps the draft, shows the B3 text; counts canvas sessions only; single chat view outside the canvas not capped.
- Tests: 9 running → send to an idle tile refused, draft kept; 8 running → sent; non-canvas chat unaffected.
- Verify: Jest on the spec, then `nx typecheck` + `nx lint` for the changed project.

## Batch B9: performance record — PENDING (manual, user)

- Executor: the user (manual DevTools); no code. Depends on: all batches, rebase onto `main` after 628. Phase review: none (measurement).
- File: `<root>\.ptah\specs\TASK_2026_629_c0b3\perf-before-after.md` (template plan-part-3.md:188-217).
- 6 streaming sessions, 3 runs per build, median: DOM nodes, long tasks > 100 ms, Recalculate Style total/avg, renderer private memory.

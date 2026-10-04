# Batch C2a report — snapshot wiring in `chat` (TASK_2026_610)

## Files

| File | Change |
| --- | --- |
| `libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` | `ptahUiSnapshots` computed (Electron-only, frozen while hidden, identity-stable per turn) + the pure `changeSetForMessage` / `anchoredChangeSetFor` / `assistantRuns` helpers and the per-turn snapshot cache |
| `libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html` | `[ptahUiSnapshot]="ptahUiSnapshots().get(msg.id) ?? null"` on `<ptah-message-bubble>` (line 54, beside `[ptahUiOrderKey]`) |
| `libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts` | `ptahUiSnapshot` input (line 148) threaded into the `ptahUi` context (line 196) |
| `libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` | **No change needed** — B6's existing `[ptahUi]="ptahUiContext()"` (line 109) already forwards the context; the new input arrives through the transcript's template binding |
| `libs\frontend\chat\src\lib\components\organisms\execution\execution-node.component.ts` | `PtahUiNodeContext.snapshot?` (line 63, optional so B6's pre-PR-C context literals keep compiling), identity compare in `samePtahUiContext` (line 77), `[snapshot]="host.snapshot ?? null"` on the deferred host (line 186) |
| `libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.ptah-ui.spec.ts` | New `describe('ChatTranscriptComponent ptah-ui source snapshots')` (line 251) with the five required cases; B7's existing 4 tests untouched |

## How the per-turn snapshot is computed and frozen

`chat-transcript.component.ts:693` (`ptahUiSnapshots = computed<ReadonlyMap<string, TurnSourceSnapshot>>`):

1. **Electron gate** — `!isElectron` returns the frozen empty `NO_PTAH_UI_SNAPSHOTS` (same shape as `turnTestsAnchors`' gate), so VS Code computes nothing and every bubble keeps the input's `null` default.
2. **Hidden freeze** — `!workActive()` returns `_frozenPtahUiSnapshots` (line 667), exactly the `turnTestsAnchors` discipline: a hidden transcript does no grouping and keeps its last placement; reactivation recomputes once.
3. **Turn walk** — `assistantRuns` (line 100) mirrors `groupTurns`' walk: a user message starts a turn, roles other than `user`/`assistant` are skipped, assistant messages before the first user message belong to no turn. A run here is a turn there; `endIndex` gives `finalized = endIndex < streamingBoundary`.
4. **The turn's change set** — per turn, resolved in order (applied to the turn-ENDING message):
   - `changeSetForMessage` (line 137): the `anchorInTurnWindow` window rule generalised to any message — the newest change set whose `(turnStartedAt, turnEndedAt]` window contains the message's `transcriptOrderKey` (decision 12 / plan §4, the item A4 deferred to C2a);
   - `anchoredChangeSetFor` (line 158): fallback to the newest change set the existing anchor join (`changeSetAnchors`) places after that same message — the card's own placement, clock-skew fallback included, so `$diff` and the card cannot disagree about a turn the join already resolved;
   - neither, and it is the newest turn → `'pending'` (A-6: the late `git:turnChangeSet` push may still land);
   - neither, and an older turn → `null` → `unavailable` (its push already had its chance).
5. **One `buildTurnSourceSnapshot` call per turn** (`buildTurnSnapshot`, line 737): `turnMessages` = the turn's assistant messages (roots + incomplete come from them), `blockMessage` = the turn-ending message (`$usage` is the turn-ending message's tokens/cost/duration), `changeSet` from step 4. **Every assistant message of the turn is mapped to that one snapshot object**; user messages get no map entry.
6. **Identity stability** — `_turnSnapshotEntries` (line 671) caches per turn-ending message id; an unchanged turn (same change set, same assistant refs) reuses its snapshot object. An unfinalized turn gets the shared frozen `PENDING_TURN_SNAPSHOT` (line 78, `buildTurnSourceSnapshot`'s unfinalized branch) so a streaming turn's snapshot identity does not churn per delta. This is what makes `samePtahUiContext`'s identity compare (execution-node.component.ts:77) keep blocks updating in place (Req 3.2) instead of re-rendering, and what keeps live blocks from re-running their pipeline on every streaming delta. The cache is cleared when the tab's session id changes.
7. `PtahUiNodeContext.snapshot` is **optional** (`snapshot?: TurnSourceSnapshot | null`) because B6's existing context literal in `execution-node.ptah-ui.spec.ts` predates PR C; production always sets it.

## Forwarding path (file:line)

```
chat-transcript.component.ts:693  ptahUiSnapshots computed (Electron only, frozen, cached)
chat-transcript.component.html:54 [ptahUiSnapshot]="ptahUiSnapshots().get(msg.id) ?? null"
message-bubble.component.ts:148  ptahUiSnapshot input
message-bubble.component.ts:196  snapshot: this.ptathUiSnapshot()  → the B6 ptahUi context (Electron + assistant only)
message-bubble.component.html:109 [ptahUi]="ptahUiContext()"       (B6, unchanged — carries the snapshot now)
execution-node.component.ts:186  [snapshot]="host.snapshot ?? null" (the deferred ptah-ui-message-text host)
execution-node.component.ts:325  @case ('message') forwards the whole context — the snapshot rides INSIDE it,
                                 so it reaches this message's assistant text only; agent (:302), tool (:274) and
                                 SendMessage (:245) recursions never forward it (B6 trust rules unchanged)
```

## Spec cases (`chat-transcript.ptah-ui.spec.ts:251-623`)

- **(a)** `updates the block in place when the late git:turnChangeSet push lands` (line 587): the REAL root-provided `ChangeSetStore` (only the RPC transport is mocked, as `change-set.store.spec.ts` does) + the real bubble → real execution node → real `ptah-ui` host → real block. A `$diff.files` stat shows `pending`; after `store.handleMessage({type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET, payload: {changeSet}})` the same block instance shows the real file count (`2`) — `By.directive(PtahUiBlockComponent)` identity compared before/after.
- **(b)** `reflects the turn's Bash runs…` (line 390): the snapshot passed to the turn-ending bubble has `tests = {kind:'available', runs: [passed jest, failed npm test], summary: 2/1/1/0}`; the user bubble gets `null`. (Fixture note: a stored Bash node carries `isError`, which `outcomeFor` reads — `status` alone is not the outcome.)
- **(c)** `binds $usage to the turn-ending message's tokens and cost, one snapshot per turn` (line 416): a two-assistant-message turn whose mid-turn message has no tokens of its own; both bubbles receive the SAME snapshot object, whose `usage` is the turn-ENDING message's `{input: 11, output: 7, cost: 0.031, durationMs: 4100}`.
- **(d)** `passes no snapshot when the host is not Electron` (line 477): with change sets present (the gate is the host, not the data) and `isElectron=false`, every bubble's `ptahUiSnapshot` is `null` — the map is empty on VS Code.
- **(e)** `resolves the persisted change set of a reloaded session` (line 452): the session-loader fixture shape (stored trees whose Bash nodes keep `toolInput.command` + terminal status, as A4's change-set spec) with the persisted set standing in for the store's load: `diff = {kind:'available', changeSet}`.

## Verification (observed counts)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1` → **both targets ran and passed** (`√ typecheck √ lint`, exit 0; "Nx Cloud … FREE plan" is the known cloud-telemetry notice, not a failure).
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/` against the delivered state (6 files, harness **not** touched): `Test Suites: 5 failed, 22 passed, 27 total; Tests: 48 failed, 283 passed, 331 total` — every failure is `Can't bind to 'ptathUiSnapshot'…` from the harness bubble stub (see Clarifications).
- With the one-line harness stub input applied (temporarily, for verification only — reverted byte-exactly afterwards; `git diff` on the harness shows only B7's pre-existing uncommitted change): **`Test Suites: 27 passed, 27 total; Tests: 331 passed, 331 total`** — all five C2a cases, B7's four and B6's execution-node suite green.

## Clarifications Needed

The new template binding requires a **7th file** I was told not to edit:

`libs\frontend\chat\src\lib\components\organisms\transcript\testing\transcript-spec-harness.ts` — the `TranscriptMessageBubbleStub` must accept the input the transcript template now binds, exactly as it did for B7's `ptahUiOrderKey` (that precedent edit is in this file's current uncommitted diff). Without it, all five harness-based transcript suites (`change-set`, `replay-motion`, `replay-mount`, `ptah-ui`, `component.spec`) fail to compile the transcript template — the 5 failing suites above. I did not edit it; I applied the change temporarily to verify the suite is green with it, then reverted it (the harness's `git diff` is B7's change only).

Required change (2 spots):

```ts
// in the existing import type { … } from '@ptah-extension/shared': add TurnSourceSnapshot

// after the B7 ptahUiOrderKey input in TranscriptMessageBubbleStub:
  // Mirrors MessageBubbleComponent's turn-source snapshot input
  // (TASK_2026_610 C2a): the transcript template binds it, so the stub must
  // accept it.
  @Input() ptathUiSnapshot: TurnSourceSnapshot | null = null;
```

**Q1: How should the harness stub gain the `ptathUiSnapshot` input?**
1. **(Recommended) The team-leader applies the 2-spot change above** — identical to the accepted B7 precedent (`ptahUiOrderKey`); the file is already dirty with B7's uncommitted stub change, so folding it into the B7/C2a commit keeps the harness diff coherent. Verified green: 27/27 suites, 331/331 tests.
2. Re-dispatch the harness edit as an explicit 7th-file addendum to this batch.
3. Drop the `[ptahUiSnapshot]` binding and hold the wiring for a later batch (the batch's purpose would be lost).

## Notes and deviations

- `message-bubble.component.html` is on the file list but needed no change: the input arrives via the transcript's binding and the context already flows through B6's `[ptahUi]`. The context is still built only for an assistant message on Electron, so the snapshot is Electron-only by the same gate.
- `changeSetForMessage` lives as a module-private function in `chat-transcript.component.ts` (not in `transcript-turns.ts`, which is outside this batch's file list); it is covered through the transcript spec cases.
- Pending-vs-unavailable boundary (A-6): newest turn → `pending` until its push; older turns → `unavailable` when nothing covers them. A reloaded session before its persisted load lands briefly shows `pending` for the newest turn and `unavailable` for older ones; the load flips both. No load-completion signal exists on `ChangeSetStore` to do better without a new API.
- Tests/usage on an unfinalized turn read `pending` (the shared frozen constant); `buildTurnSourceSnapshot` itself returns the same shape for `finalized: false`.

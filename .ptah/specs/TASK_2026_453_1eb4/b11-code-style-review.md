# Code Style Review — `TASK_2026_453_1eb4` Batch 11

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 2                                     |
| Files reviewed  | 8 (3 created, 5 modified)              |

Scope: uncommitted diff under `libs/frontend/**` for Batch 11 (C10 `HistoryMessageBuilder`, C11 tab
history-window cursor/prepend). `libs/shared` and Batch 9 files excluded per instructions and
confirmed untouched by `git status`.

## Five style questions

### 1. What breaks in six months?

Nothing structural. `HistoryMessageBuilder.build` keeps the O(E + M) index-then-lookup shape moved
verbatim from `message-finalization.service.ts` (`history-message-builder.service.ts:151-207`), and
the equivalence oracle in `message-finalization.session-history.spec.ts` still runs unedited against
it through the facade, so a future regression to O(M × E) is caught the same way it was before the
extraction. The one soft spot: `HistoryMessageBuilder.accumulate` resolves its five collaborators
through a raw `Injector.get(...)` inside the method body
(`history-message-builder.service.ts:112-119`) instead of field-level `inject()`. Six months from
now, a reader adding a sixth collaborator to `AccumulatorContext` has no field list to extend by
example — they have to notice the `injector.get` block and match its ad-hoc style, which is not
mirrored anywhere else in this file.

### 2. What would a new team member misread?

The `Injector.get` block in `accumulate()` reads as if it exists to avoid eager instantiation of the
five collaborators, but every sibling in the same lib injects the identical set eagerly. A new
contributor who greps for "how does chat-streaming build an `AccumulatorContext`" will land on
`StreamingHandlerService` (`streaming-handler.service.ts:63-82`, `:382`, `:461`) and see five plain
`inject()` fields; the new file does the same job with a sixth pattern nobody else uses, with no
comment explaining why. That mismatch is the finding below.

### 3. What does this cost to maintain?

Low. The extraction itself is close to free: it moves code, does not duplicate it (the old
`indexMessageBoundaries` / `indexTreesById` / `markStreamingAgentsAsInterrupted` /
`markResumableAgentsAsInterrupted` bodies are deleted from `message-finalization.service.ts`, not
copied), and the facade (`finalizeSessionHistory`) keeps its signature and callers untouched. The
`Injector.get` deviation costs a small but real amount: any future review of this file has to
re-derive that the five services are ordinary constructor-shaped dependencies before trusting a
mock-based spec of them (the spec does provide them as `TestBed` providers, so tests are unaffected,
but the code reads as more dynamic than it is).

### 4. Where is this inconsistent with the rest of the repository?

`history-message-builder.service.ts:90-119` is the only place in `libs/frontend/chat-streaming` that
injects `Injector` and calls `.get(...)` for its collaborators; every other consumer of the same five
services (`StreamingHandlerService`, `StreamRouter` per this lib's CLAUDE.md "shared write path"
note) uses field-level `inject()`. The chat-streaming `CLAUDE.md` states the convention explicitly:
"`inject()` exclusively" under Angular Conventions Observed. There is no DI cycle forcing lazy
resolution — `MessageFinalizationService` injects `HistoryMessageBuilder` directly
(`message-finalization.service.ts` diff, `historyBuilder = inject(HistoryMessageBuilder)`), and none
of `StreamingAccumulatorCore` / `SessionManager` / `EventDeduplicationService` /
`BatchedUpdateService` / `BackgroundAgentStore` / `AgentMonitorStore` depends back on
`MessageFinalizationService` or `HistoryMessageBuilder` (checked: only `TurnStateApplier` injects
`MessageFinalizationService`, and it is not itself a dependency of any of the six). See Serious
issue below.

### 5. What would you have done differently, and why is that better rather than merely other?

Inject the five collaborators as ordinary `private readonly` fields with `inject()`, matching
`StreamingHandlerService`'s pattern, and build the `AccumulatorContext` object from those fields
inside `accumulate()`. That is strictly less code (`inject(Injector)` plus five `.get()` calls
becomes five one-line fields), makes the class's real dependency count visible at the top of the
file the way every other service in this lib does, and removes the only DI-resolution-order
question a reviewer has to rule out by hand.

## Blocking issues

None.

## Serious issues

### Lazy `Injector.get` collaborator resolution instead of field-level `inject()`

- File: `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:90`, `:112-119`
- Problem: `HistoryMessageBuilder` injects `Injector` and resolves `StreamingAccumulatorCore`,
  `SessionManager`, `EventDeduplicationService`, `BatchedUpdateService`, `BackgroundAgentStore`, and
  `AgentMonitorStore` via `this.injector.get(...)` inside `accumulate()`, rather than as
  constructor-shaped `inject()` fields. This is the one file in `libs/frontend/chat-streaming` that
  does this; the nearest sibling doing the exact same job — building an `AccumulatorContext` from the
  same five services — is `StreamingHandlerService`, which injects all of them as plain fields
  (`streaming-handler.service.ts:63-82`). The lib's own `CLAUDE.md` documents "`inject()`
  exclusively" as the Angular convention observed here.
- Impact: hides the class's true dependency surface from a reader scanning field declarations (the
  constructor-equivalent list is one `Injector` line, not six services), and invites a second
  divergent style the next time someone needs one more collaborator inside `accumulate()` — nothing
  in the file signals that eager injection was considered and rejected for a reason. No functional
  defect: the five services have no circular dependency on `HistoryMessageBuilder` or
  `MessageFinalizationService`, so eager `inject()` resolves cleanly.
- Fix: replace the `Injector` field and the five `injector.get(...)` calls with `private readonly`
  `inject()` fields for `StreamingAccumulatorCore`, `SessionManager`, `EventDeduplicationService`,
  `BatchedUpdateService`, `BackgroundAgentStore`, and `AgentMonitorStore`, and build the
  `AccumulatorContext` object from those fields in `accumulate()`. If a reason for lazy resolution
  does exist (none is documented in `b11-codex-report.md` or the class doc), state it in a comment
  next to the `Injector` field.

## Minor issues

- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:299-301` — the comment "One
  pass over the events and one over the trees, then the message loop is lookups... made a long
  session's finalization O(M × E)" now sits between the `historyBuilder.build(...)` call and
  `applyFinalizedHistory`, describing work that happens inside `HistoryMessageBuilder.build`, not in
  this method. The identical, better-placed comment already lives at its true location
  (`history-message-builder.service.ts:149-150`, and the CLAUDE.md `Key Files` entry for
  `history-message-builder.service.ts` `build`). Leaving the orphaned copy here costs a future reader
  a few seconds re-deriving that the pass it describes is one call away, not inline. Delete it or
  replace it with a one-line pointer to `HistoryMessageBuilder.build`.
- `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:97-100` — `clearCache`'s
  doc ("Release a scratch cache when accumulation fails before `build` runs") is accurate for its one
  documented caller path but doesn't mention that `build` itself also calls `this.treeBuilder.clearCache`
  directly in its own `finally` (`:222-224`) rather than through this method — a reader relying on the
  doc alone could assume `build` always routes cache release through `clearCache()` and miss the
  duplicated literal `history-page-` prefix check that would need updating in two places if the
  scratch-cache-key convention ever changes.

## File-by-file

### `history-message-builder.service.ts` (created)

Score 7/10 — 0 blocking, 1 serious, 1 minor. Correct extraction of the O(E + M) build loop with the
page/tail cache-key split and `finally`-guarded release the plan requires
(`build`, `:132-226`); the one real issue is the `Injector.get` deviation from the sibling
`StreamingHandlerService` pattern for building `AccumulatorContext` (Serious, above).

### `history-message-builder.service.spec.ts` (created)

Score 8/10 — 0 blocking, 0 serious, 0 minor. Covers page-equals-tail equivalence, no
`scheduleUpdate` during accumulation, idempotent agent/background-agent registration on repeated
events, throwing-event propagation with cache release, and throwing-`buildTree` cache release. Mocks
match the real `AccumulatorContext` shape (`agentMonitorStore`, `backgroundAgentStore` stubs mirror
the real stores' method names), so the mocks would need to move in lockstep with a real interface
change rather than silently drift.

### `message-finalization.service.ts` (modified)

Score 8/10 — 0 blocking, 0 serious, 1 minor. Facade rule applied correctly: `finalizeSessionHistory`
keeps its name, signature (`tabId: string, resumableSubagents?: SubagentRecord[]`), and behaviour
(`:281-305`); the extracted loop, both interrupt-marking helpers, and `indexMessageBoundaries` /
`indexTreesById` are deleted here, not duplicated. `extractTextForMessage` stays as a one-line
delegate to `extractHistoryTextForMessage` (`:503-505`) specifically because
`message-finalization.session-history.spec.ts` calls it unedited — a deliberate, plan-required thin
wrapper, not orphaned code. One stale comment (Minor, above).

### `chat-streaming/src/index.ts` (modified)

Score 10/10 — clean two-line barrel addition (`HistoryMessageBuilder`,
`HistoryMessageBuildOptions`), alphabetically placed beside `MessageFinalizationService`'s existing
export.

### `chat-streaming/CLAUDE.md` (modified)

Score 9/10 — the `Key Files` addition for `history-message-builder.service.ts` `build` correctly
states the O(E + M) invariant and points at the equivalence-oracle spec that pins it; the new
"History message building (TASK_2026_453)" subsection under `State Management Pattern` accurately
describes the facade, scratch-page cache-key convention, and no-scheduled-update rule. No claim in
either addition contradicts the diff.

### `chat-types.ts` (modified)

Score 9/10 — `TabState.olderHistoryCursor?: string | null` (`:544-548`) documents the tri-state
contract inline (`undefined` / `null` / string) exactly as C11 specifies; placed beside `messages`,
the field it windows.

### `tab-manager.service.ts` (modified)

Score 8/10 — `setOlderHistoryCursor` and `prependHistoryMessages` (`:1488-1520`) match the C11
contract: one `updateTabInternal` call per prepend, current-state read at commit time (not at
request time), duplicate-id drop keeping first-seen order, unknown-tab no-op via the
`findTabByIdAcrossWorkspaces` early return, and `applyResumingSession` resetting the cursor to
`undefined` (`:2153`). Neither method writes `status`, `streamingState`, or stats — verified by
reading the `updateTabInternal` call sites, not just the doc comment. No new outbound import — the
lib's "no outbound imports" guideline holds.

### `tab-manager.history-window.spec.ts` (created)

Score 9/10 — five specs cover the required matrix: live-append survival + duplicate drop + one write
(asserted via `jest.spyOn(internal, 'updateTabInternal')`, a reasonable escape hatch for a private
method with no other observable seam), empty-page cursor recording, tri-state cursor plus
unknown-tab no-op, resume reset, and persist/restore round trip through the real
`projectTabForPersist` / `sanitizeRestoredTab` functions (not a hand-rolled substitute).

## Pattern compliance

| Repository rule or nearby convention                                              | Status | Evidence |
| ----------------------------------------------------------------------------------- | ------ | -------- |
| Facade rule: public class keeps name/token/signature, extraction is a collaborator  | PASS   | `message-finalization.service.ts:281-305`; `history-message-builder.service.ts:88-89` `@Injectable({ providedIn: 'root' })` |
| Extracted piece passes nameability test (no helpers/utils/common/misc)              | PASS   | `HistoryMessageBuilder` |
| No file under ~150 lines created to satisfy the size cap                            | PASS   | `history-message-builder.service.ts` 258 lines |
| Facade constructor stays under ~8 injected deps                                     | PASS   | `MessageFinalizationService` gains one field (`historyBuilder`) |
| `inject()` exclusively (chat-streaming CLAUDE.md, Angular Conventions Observed)      | FAIL   | `history-message-builder.service.ts:90`, `:112-119` — `Injector.get` instead |
| chat-state: no outbound imports to chat/chat-streaming/chat-routing/core            | PASS   | `tab-manager.service.ts` diff adds no new import |
| chat-state: immutable updates, one write per mutation                               | PASS   | `prependHistoryMessages` single `updateTabInternal` call |
| Restore rules live in `sanitizeRestoredTab`/`projectTabForPersist`, not a loader     | PASS   | Both already spread `...tab`; no per-field strip needed or added for `olderHistoryCursor` |
| chat-types stays framework-agnostic                                                 | PASS   | `TabState.olderHistoryCursor` is a plain optional field, no Angular import added |
| No TODO/stub/placeholder/V2 copies                                                  | PASS   | Grep of the diff found none; old API deleted, not duplicated |
| File size soft ceiling 700 lines                                                    | PASS   | `message-finalization.service.ts` 507 (down from 726); `history-message-builder.service.ts` 258 |

## Maintenance debt

- Introduced: one new root service (`HistoryMessageBuilder`) with a documented cache-key convention
  (`tab-` persists across calls, `history-page-` releases in `finally`); one new tri-state field on
  `TabState`; two new prepend/cursor methods on `TabManagerService`.
- Retired: ~150 lines of duplicated boundary-indexing/tree-marking logic previously living only in
  `message-finalization.service.ts`, now owned once.
- Net: reduction. The only debt added is the `Injector.get` style deviation (Serious, above), which
  is cheap to fix and does not compound — nothing else in the batch depends on the lazy-resolution
  shape.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `HistoryMessageBuilder.accumulate` resolves its five collaborators through
  `Injector.get` instead of field-level `inject()`, the only place in `chat-streaming` doing so for
  work a sibling (`StreamingHandlerService`) already does eagerly with no cycle to justify the
  difference.
- What a 10/10 version would do differently: inject the five collaborators as plain fields matching
  `StreamingHandlerService`; delete the orphaned O(E + M) comment left behind in
  `message-finalization.service.ts:299-301`.

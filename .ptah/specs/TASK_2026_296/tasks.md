# Development Tasks — TASK_2026_296

**Total Tasks**: 34 | **Batches**: 7 | **Status**: 0/7 complete

**Task split**: B4=4 · B1=6 · B2=5 · B3a=3 · B3b=6 · B5a=3 · B5b=7

**Source of authority**: `implementation-plan.md`. Where this file and the plan
disagree, the plan wins. Where `item-6-consumer-audit.md` and the plan disagree,
the plan wins (that file carries its own correction banner).

**Execution order (from plan §8)**:

```
B4  →  (B1 ‖ B2 ‖ B3a)  →  B3b  →  FULL GATE  →  B5a  →  B5b
```

**CLI delegation is DISABLED for this task** (`context.md` §Orchestration).
Every `Recommended Executor` below is a sub-agent developer. The team-leader is
advisory: the orchestrator spawns.

---

## 0. NORMATIVE — the do-not-delete table (reproduced verbatim from plan §0)

> **`?: string` does NOT make `''` unrepresentable. `''` is a `string`.**
>
> Widening a field removes the **forcing function** — the reason a producer had
> to invent a value for a field it could not fill. It does not remove the value.

These read as "defensive code the type makes impossible". The type does **not**
make them impossible. They sit at boundaries that take a bare `string`, read off
the wire, or read out of SQLite. **No batch in this task may delete any of
them**, and no reviewer may request their deletion on the grounds that "the type
prevents it":

| Guard                                             | Location                                                                                                 | Why it is still load-bearing                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `knownSessionId`                                  | `libs/frontend/chat-streaming/src/lib/session-scope.ts`                                                  | Normalizes at every write boundary; a stored owner must be a real id or `undefined`, never `''`. Pinned by `session-scope.spec.ts`.     |
| `agentVisibleInSession`                           | same file                                                                                                | Models two independent axes (agent owner / viewer session). Three callers previously hand-rolled axis (b) with three different answers. |
| `EventDeduplicationService` guards                | `libs/frontend/chat-streaming/src/lib/event-deduplication.service.ts`                                    | Reads ids off the wire.                                                                                                                 |
| `beginTeardown` empty check                       | `libs/backend/vscode-core/src/services/subagent-registry.service.ts:463` (`if (parentSessionId === '')`) | Bare-`string` parameter.                                                                                                                |
| `resolveHookSessionId` / `resolveFirstPresent`    | `libs/backend/agent-sdk/src/lib/helpers/hook-session-resolver.ts`                                        | Returns `null`, never `''`, so a handler cannot publish "no id" by accident.                                                            |
| `ObservationQueueStore.insert` blank refusal      | `libs/backend/memory-curator/src/lib/observation-queue.store.ts:130`                                     | Un-drainable/un-reapable row prevention. **See item 1 — this guard is why `:31` must NOT be widened.**                                  |
| `SessionRegistry.bindRealSessionId` blank refusal | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:157`               | Set-once discipline.                                                                                                                    |
| `SdkAgentAdapter` init-callback blank refusal     | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:647`                                                | The SDK can report a blank `session_id`.                                                                                                |
| `CompactionHookHandler` null rejection            | `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:182-192`                              | **See item 1 — this is why the port must NOT be widened.**                                                                              |
| `chat:subagent-query` `''` branch                 | `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:143`                                | **See item 2 — this owns semantics Zod must not take over.**                                                                            |
| `SdkPermissionHandler` blank guard                | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:1030`                                          | Bare-`string` boundary.                                                                                                                 |
| `SkillSynthesisService` blank guard               | `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:424`                                    | Bare-`string` boundary.                                                                                                                 |

**Refactor-in-place vs delete.** B3b may rewrite the _inner expression_ of a
listed guard so it calls the shared primitive (`if (!x || x.trim().length === 0)`
→ `if (blankToUndefined(x) === undefined)`) — the guard, its log line and its
early return all survive. B3b may **not** remove a guard. Six of the listed
guards are hard-excluded from B3b entirely; see the B3b disposition table.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS (1 clarification, non-blocking — see end
of file)

### Decisions already taken upstream — do not reopen in any batch

| Decision                                                                                                                                             | Where                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| CLI delegation DISABLED; sub-agent developers only                                                                                                   | `context.md` §Orchestration   |
| Item 5 (branded types) is **NO-GO** — no batch exists for it                                                                                         | plan §5                       |
| Item 1 is **ONE** widening (`memory.ts`), not four. `:31`, `:55` and `compaction-callback.port.ts:4` are evidence-backed REJECTIONS                  | plan §1b/§1c/§1d              |
| Item 6 is **Option A**: B5 split into B5a (prevention) + B5b (reconciliation)                                                                        | plan §Clarifications-RESOLVED |
| Historical SQLite rows are **REAPED by migration 0039, never reconciled** — the tabId→UUID mapping is not persisted, so reconciliation is impossible | plan §6c Q1 USER DECISION     |

### Assumptions verified by the team-leader against the working tree

| #   | Assumption                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MemoryExtractedPayload.sessionId` is at `memory.ts:46`                              | ✅ **Confirmed exact — the plan is right.** ~~The team-leader reported `:45`; that was an off-by-one and is retracted.~~ Verified by the orchestrator against the working tree: `:45` is `export interface MemoryExtractedPayload {`, **`:46` is `readonly sessionId: string;`**. Edit `:46`, the field — NOT `:45`, the interface declaration. Spot-checking is still required everywhere else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | `SessionId.validate` at `branded.types.ts:61`, `safeParse` at `:79`, JSDoc `:76-78`  | ✅ All three confirmed exact. `from()` at `:69` confirmed — do not widen it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | `libs/shared/src/lib/utils/` has no blankness primitive                              | ✅ Confirmed. 14 util modules, none of them a blankness converter. Barrel `index.ts` has 9 export statements, mixing `export *` and named blocks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Migration runner is at 0038, so the new migration is 0039                            | ✅ Confirmed. `migrations/index.ts` last entry is `{ version: 38, name: '0038_gateway_message_turn_state' }`. Every migration since 0034 ships a sibling `.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | The plan's "28 forms 1–4 sites" are all sweepable                                    | ❌ **No — 6 of the 28 are hard-excluded by another normative section of the same plan.** Resolved in the B3b disposition table; recorded as Clarification 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6   | `branded.types.spec.ts:96` asserts `safeParse('')`                                   | ❌ **No — `:96` asserts `safeParse('garbage')`.** There was NO `safeParse('')` assertion in the file; its `''` coverage was only transitive via `validate`'s `INVALID_INPUTS`. B4 added the explicit case rather than treating a wrong citation as licence to skip. Found by the B4 developer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | B3a's `vendor-card` input should become `input<string \| undefined>()` (plan §3b #5) | ❌ **No — that does not compile.** `TribunalStateService.tribunalSessionId` is `computed<string \| null>` and `tribunal-panel` has `strictTemplates: true`. The prescribed type produces TS2322 at both ends of the chain. **Correct form: `input<string \| null>(null)`** — the `(null)` default is load-bearing, since a bare `input<string \| null>()` reads as `string \| null \| undefined` and breaks the forward binding into `AgentMonitorPanelComponent.sessionId`. Verified by the B3a developer by applying the prescribed type and running `ngc`. **Do not "restore" `undefined` here.**                                                                                                                                                                                                                                                                                                                                                        |
| 8   | R8 will fire — `boot-thoth-runtime.spec.ts:143-173` asserts `sessionId: ''`          | ❌ **No — it asserts `sessionId: 's1'`.** Nothing needed inverting; that block was already the paired-isolation sibling. B1 added the absent-id case alongside it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Plan §6a Correction 2 / Task 5a.2: "the hook closure holds `undefined`"              | ❌ **No — it holds the tabId.** Found by the B5a developer, **independently verified by the orchestrator against the working tree**: `createHooks` is `private` with exactly one caller (`sdk-query-options-builder.ts:671`), fed by `session-query-executor.service.ts:245` as `sessionId: sessionId as string` — always present — which for a new session is `trackingId`, i.e. **the tabId** (`sdk-agent-adapter.ts:495` passes `sessionId: trackingId`; `trackingId = tabId as SessionId`). The plan inferred a runtime value from a widened _type_ — the §0 error in mirror image: **`?: string` does not mean the value IS `undefined`, just as it does not make `''` unrepresentable.** `agent-sdk/CLAUDE.md:77` was corrected to say tabId, NOT `undefined`. **B5b must not reassert the `undefined` claim** — and this matters to B5b directly, because a tabId-bearing closure is precisely the residual hook path the rekey exists to reconcile. |

### Risks carried into the batch briefs

| #   | Risk                                                                                                                          | Severity | Mitigation                                                                                                                  | Owning batch |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R2  | Deleting a §0 guard as "dead code" — **the highest-probability regression in this task**                                      | HIGH     | §0 table above is normative and reproduced in every brief. Reviewer rejects on sight.                                       | ALL          |
| R3  | `.min(1)` on `chat:subagent-query.sessionId`, or normalizing `''`→`undefined`, restoring the Wave 1 cross-session resume leak | HIGH     | Task 2.2 states the prohibition; spec 2.4.3 is the regression guard.                                                        | B2           |
| R11 | B3b sweep creeping into the 97 bare `!x` sites (~46 extra files, zero behavioural gain)                                       | HIGH     | Explicit exclusion in the B3b brief + disposition table. Reject any B3b diff touching a bare `!x`.                          | B3b          |
| R12 | B3b changes trim policy at 13 sites that currently do NOT trim — a real behavioural change                                    | MED      | Called out in the B3b brief; one spec per trigger service asserting whitespace-only is now rejected. Do not silently widen. | B3b          |
| R13 | `libs/shared/src/lib/utils/index.ts` barrel conflict between B3b and B4                                                       | MED      | **B3b is sequenced strictly after B4.** Never parallelise them.                                                             | B3b/B4       |
| R4  | B5b rekey clobbering a live UUID entry                                                                                        | MED      | Refuse-overwrite rule mirroring `bindRealSessionId:176-180`.                                                                | B5b          |
| R5  | B5b SQLite backfill colliding with `UNIQUE(session_id, stage)`                                                                | MED      | `UPDATE OR IGNORE` + `DELETE` of the un-migrated remainder.                                                                 | B5b          |
| R6  | Item 6 is the only work that can regress the empty-string gate; a regression in either failure mode blocks the other          | MED      | B5a/B5b sequenced last, behind a verified-green full gate.                                                                  | B5a/B5b      |
| R7  | Widening `SessionId.validate` breaks the `.refine` predicate in `branded.schemas.ts:19`                                       | LOW      | Contravariant; `string` still satisfies `string \| undefined`. Typecheck `shared` first.                                    | B4           |
| R8  | `boot-thoth-runtime.spec.ts:143-173` may assert `sessionId: ''`                                                               | LOW      | **Invert/adapt, never delete.** Wave 2 precedent. Zero specs deleted in this task.                                          | B1           |
| R9  | Unwired `memory:sessionStartInjected` channel tempts deletion                                                                 | LOW      | Message protocol is append-only. Recorded, not removed.                                                                     | B1           |
| R10 | Known flake: one `rpc-handlers` test failed once under parallel load in Wave 1                                                | LOW      | Rerun isolated + `--skip-nx-cache` before treating as a break. Record, do not swallow.                                      | B2           |
| R1  | `libs/frontend/core` coverage floor (statements 85%, lines 85%)                                                               | LOW      | No batch adds frontend code to `core`. Verify before/after. **Never lower the threshold to make a batch pass.**             | ALL          |

### Edge cases that must be handled

- [ ] `MEMORY_EXTRACTED` broadcast with `sessionId: undefined` must emit `undefined`, not `''` → Task 1.2, 1.3, 1.5
- [ ] `agent:resumeCliSession` with `parentSessionId` **absent** must still succeed (paired-isolation sibling) → Task 2.4
- [ ] `chat:subagent-query` with `sessionId: ''` must return `{ subagents: [] }` and must NOT call the unscoped `getResumable()` → Task 2.4
- [ ] `chat:subagent-query` with a wrong-typed `sessionId` must not throw out of the handler → Task 2.4
- [ ] `SessionId.safeParse('')` must still return `null` (existing `''` assertions stay) → Task 4.3
- [ ] Whitespace-only session id becomes _absent_ at the 13 no-trim sites — deliberate, pinned → Task 3b.5
- [ ] A session whose id never resolves must still be torn down correctly under its tabId → Task 5a.3
- [ ] Rekey where `toId` already exists: keep `toId`, discard `fromId`, clear its timer. Never clobber → Task 5b.4
- [ ] Rekey landing mid-curate must not produce a double-curate → Task 5b.6
- [ ] Migration 0039 must not touch processed rows, and must not touch rows inside the retention window → Task 5b.7

---

## Verification — run after EVERY batch

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core
npx nx run-many -t test  -p <same list>
npx nx run-many -t lint  -p <every project touched by the batch>
```

> [!WARNING]
> **`memory-contracts` is invisible to `-t lint`.** It is the ONE project in the
> gate whose only lint target is named `eslint:lint`; every other project listed
> above has both `eslint:lint` and `lint`. So `nx run-many -t lint -p ...,memory-contracts`
> **silently skips it and still reports success** — B1 hit exactly this and it
> looked like a clean 4-project run when only 3 ran. Any batch touching that lib
> must additionally run:
>
> ```
> npx nx run @ptah-extension/memory-contracts:eslint:lint
> ```
>
> Verified by the orchestrator against the project graph, 2026-08-19.

**Baseline that must not drop: 16 projects typecheck, 9,834 tests.** Any drop
explained by name. B5b adds `persistence-sqlite` to the typecheck/test list.

`libs/frontend/core` coverage floor: statements 85%, lines 85%. **Never lower it
to make a batch pass.**

---

## Batch 4 (B4): `SessionId.safeParse` / `validate` accept absence ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: 3 files, ~6 edited lines, purely contravariant. It touches
`libs/shared` (upstream of everything) so it runs **alone and first** — the plan
§8 offers this as the zero-risk ordering and it is the ordering chosen here. The
two `chat-streaming` edits are mechanical ternary deletions inside a service
file, not Angular component/template work; splitting a 6-line change across two
developers costs more than it saves. **This is a deliberate deviation from the
"never mix backend + frontend in one batch" rule, on size grounds.**
**Tasks**: 4 | **Dependencies**: none | **Blocks**: B3b (shared barrel / shared lib)
**Estimated effort**: 1–2h
**Projects touched (lint)**: `shared`, `chat-streaming`, `agent-sdk`

### Task 4.1: Widen `SessionId.validate` and `SessionId.safeParse` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.ts`
**Spec Reference**: implementation-plan.md §4
**Lines** (team-leader verified exact at the current tree):

- `:61` — `validate(id: string): id is SessionId {` → `validate(id: string | undefined): id is SessionId {`, body becomes `return id !== undefined && UUID_REGEX.test(id);`
- `:79` — `safeParse(id: string): SessionId | null {` → `safeParse(id: string | undefined): SessionId | null {`. **Body unchanged** — `validate` now handles `undefined`.

**Quality Requirements**:

- A type predicate requires the asserted type to be assignable to the parameter
  type. `SessionId = string & { __brand }` is assignable to `string | undefined`.
  This is valid — do not add a cast.
- **Do NOT widen `from()` at `:69`.** It throws by contract and every caller
  passes a known-present id. Widening it would invite `SessionId.from(undefined)`
  at sites that are compile-checked today.
- **Do NOT widen the sibling brands** — `MessageId` (`:98`), `CorrelationId`
  (`:135`), `TabId` (`:172`), `JobId` (`:204`), `RunId` (`:228`). No caller passes
  them a possibly-undefined value. The asymmetry is deliberate.

**Validation Notes**:

- R7 — verify `branded.schemas.ts:19`
  (`.refine((id): id is SessionId => SessionId.validate(id))`) still compiles.
  Zod passes `string`, which satisfies `string | undefined`. Typecheck `shared`
  before touching anything else.
- Other callers that must keep working:
  `libs/shared/src/testing/matchers/to-be-session-id.ts:21`,
  `cli-agent-runtime/.../ptah-cli-registry.ts:831`,
  `memory-curator-ui/.../corpus-list.component.ts:413`,
  `rpc-handlers/.../harness-stream-broadcaster.service.spec.ts:119,150`.

---

### Task 4.2: Record the widening asymmetry in JSDoc ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.ts` (`:76-78`, verified exact)
**Dependencies**: Task 4.1

**Quality Requirements**:

- State that `SessionId` is the one brand whose absence is a modelled state after
  Wave 2, and that the five sibling brands are deliberately NOT widened — so a
  future reader does not "restore consistency" by widening five unrelated APIs.

---

### Task 4.3: Extend the branded-types spec ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.spec.ts` (existing block at `:88-100`)
**Dependencies**: Task 4.1

**Quality Requirements**:

- `SessionId.safeParse(undefined)` → `null`
- `SessionId.validate(undefined)` → `false`
- **Keep the existing `''` assertions at `:59` and `:96` untouched.** They are the
  §0 evidence that `''` is still rejected. Deleting them would be exactly the
  "the type prevents it" mistake R2 is about.
- Paired-isolation sibling: a valid UUID still parses to a `SessionId`.

---

### Task 4.4: Delete the three now-redundant ternaries ⏸️ PENDING

**Files**:

| File                                                                                             | Line    | Before → after                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts`   | 132-134 | `event.sessionId ? SessionId.safeParse(event.sessionId) : null` → `SessionId.safeParse(event.sessionId)`                 |
| same                                                                                             | 157     | `(sessionId ? SessionId.safeParse(sessionId) : null) ?? eventSession` → `SessionId.safeParse(sessionId) ?? eventSession` |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` | 647     | `routingId ? SessionId.safeParse(routingId) : null` → `SessionId.safeParse(routingId)`                                   |

**Dependencies**: Task 4.1

**Quality Requirements**:

- **Comment cleanup, not deletion**: `streaming-handler.service.ts:124-131`
  explains the ternary being removed. **Rewrite it** — the `SessionId.from` throw
  hazard it documents is still real. Deleting the comment loses that.
- `sdk-query-options-builder.ts:647` is the F1 site listed in the census; it is
  **not** the `:1164` MCP routing throw. Do not confuse the two.

**Batch 4 Verification**:

- Full typecheck/test list above, green at baseline
- `npx nx run-many -t lint -p shared,chat-streaming,agent-sdk`
- No `from()` signature change; no sibling brand widened
- Existing `''` assertions still present in `branded.types.spec.ts`

**Do-not-touch (B4)**: `SessionId.from` (`:69`); `MessageId`/`CorrelationId`/
`TabId`/`JobId`/`RunId`; `branded.schemas.ts`; `agent-monitor.store.ts` (~1,610
lines — **do not opportunistically split it**, plan §7).

---

## Batch 1 (B1): The third declaration, and its port twin ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: One shared-type widening plus two producer deletions in two
different libs, then two spec adaptations. Tightly coupled through a single type
change — one head must hold it.
**Tasks**: 6 | **Dependencies**: B4 complete (shared-lib serialisation) | **Parallel-safe with**: B2, B3a
**Estimated effort**: 1–2h
**Projects touched (lint)**: `shared`, `cli-engine`, `thoth-runtime`, `memory-contracts`

> **ITEM 1 IS ONE WIDENING, NOT FOUR.** `memory.ts:31`, `memory.ts:55` and
> `compaction-callback.port.ts:4` are evidence-backed REJECTIONS (plan §1b/§1c/
> §1d). Do not create work to "finish" them. A reviewer asking for them is wrong.

### Task 1.1: Widen `MemoryExtractedPayload.sessionId` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\memory.ts`
**Line**: **`:46`** — the plan is correct. An earlier `:45` claim in this file was
an off-by-one and has been retracted; `:45` is the `export interface
MemoryExtractedPayload {` line and editing it would be wrong. Verified against
the working tree: `:46` is `readonly sessionId: string;`. **Spot-check anyway
before editing.**
**Change**: `readonly sessionId: string;` → `readonly sessionId?: string;`
**Spec Reference**: implementation-plan.md §1a

**Quality Requirements**:

- Expected compile fallout: **ZERO outside the two producer files**.
  `MESSAGE_TYPES.MEMORY_EXTRACTED` has no consumer anywhere in the repo — only
  the constant (`message-constants.ts:179`), the payload-map entry
  (`payload-map.ts:315`), the two producers, and one backend spec.
  `libs/frontend` and `apps/ptah-extension-webview` have zero matches.
- If the fallout is larger than that, **stop and report** — it means the tree
  moved and the analysis needs re-running.

**Validation Notes**:

- Do NOT touch `MemoryObservationCapturedPayload.sessionId` (§1b — the non-blank
  guarantee is real and enforced at `observation-queue.store.ts:130`).
- Do NOT touch `MemorySessionStartInjectedPayload.sessionId` (§1c — the channel
  is dead, zero producers and zero consumers; the protocol is append-only, so it
  is recorded and left, **not deleted**). R9.

---

### Task 1.2: Delete the `thoth-runtime` coercion ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.ts` (`:190`)
**Change**: `sessionId: ev.sessionId ?? ''` → drop the `?? ''`, pass
`ev.sessionId` directly.
**Dependencies**: Task 1.1

**Validation Notes**: This is row #1 of the acceptance-criterion table
(census §Acceptance-criterion surface). Do not touch the verbatim
`ObservationCaptureEvent` pass-through at `:203-208`.

---

### Task 1.3: Delete the `cli-engine` coercion ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\bootstrap\wire-thoth-push-bridges.ts` (`:46`)
**Change**: drop `?? ''`, pass `ev.sessionId` directly.
**Dependencies**: Task 1.1

**Validation Notes**: Row #2. Same expression as Task 1.2, duplicated across two
libs — the same `MEMORY_EXTRACTED` broadcast wired twice. Do not touch the
`:69-74` pass-through.

---

### Task 1.4: Document the `ICompactionCallbackRegistry` guarantee ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\memory-contracts\src\lib\compaction-callback.port.ts` (`:4`)
**Change**: **doc comment ONLY. Do not change the signature.**

**Quality Requirements**:

- State that `sessionId` is guaranteed non-blank by `CompactionHookHandler`'s
  null rejection, citing `compaction-hook-handler.ts:182-192`.
- Confirm `compaction-hook-handler.spec.ts` already pins that rejection. **If it
  does, add nothing. If it does not, add that one assertion.**
- This converts an incidental guarantee into a documented + pinned one, which is
  what the stale Wave 1 note actually wanted. It is the _whole_ of the port work.

**Validation Notes**: The port's sole notifier is
`CompactionCallbackRegistry.notifyAll` (`compaction-callback-registry.ts:49`);
its sole caller is `CompactionHookHandler` (`:210-218`), which returns early on
`null` at `:177-192`. Widening the port would force `MemoryCuratorService.start()`
(`memory-curator.service.ts:93-120`) to grow an absence branch for a case its
only producer already rejects.

---

### Task 1.5: Adapt the `thoth-runtime` spec ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.spec.ts` (existing block at `:143`, referenced `:143,173`)
**Dependencies**: Tasks 1.1, 1.2

**Quality Requirements**:

- Assert a `curator-run` event with `sessionId: undefined` broadcasts a payload
  whose `sessionId` is **`undefined`, not `''`**.
- R8 — if the existing block asserts `sessionId: ''`, **invert/adapt it. Do not
  delete it.** Zero specs are deleted in this task (Wave 2 precedent, plan §7 R8).
- Paired-isolation sibling: an event _with_ a real `sessionId` still broadcasts
  that id unchanged.

---

### Task 1.6: Mirror the assertion in a `cli-engine` spec ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\bootstrap\` — locate the existing spec for `wire-thoth-push-bridges.ts`; if none exists, create `wire-thoth-push-bridges.spec.ts`
**Dependencies**: Tasks 1.1, 1.3

**Quality Requirements**: Same two assertions as Task 1.5, for the `cli-engine`
wiring.

**Batch 1 Verification**:

- Full typecheck/test list, green at baseline
- `npx nx run-many -t lint -p shared,cli-engine,thoth-runtime,memory-contracts`
- `memory.ts` diff contains **exactly one** changed line
- `compaction-callback.port.ts` diff contains **zero** signature changes
- Zero spec files deleted

**Do-not-touch (B1)** — lifted from plan §1 "Item 1 do-not-touch list":

- `observation-queue.store.ts:130` blank refusal — the reason `:31` stays required
- `compaction-hook-handler.ts:182-192` null rejection — the reason the port stays required
- `memory.ts:31`, `memory.ts:55`, `compaction-callback.port.ts:4` signature — all stay as-is
- `memory-curator.service.ts:243` — `${input.workspaceRoot ?? ''}::${sessionId}` coerces **workspaceRoot**, not a session id. Out of scope; do not "fix" it.

---

## Batch 2 (B2): Zod at the two unvalidated RPC entry points ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: One new schema file plus a schema addition and two handler parse
insertions in the same lib, then five interlocking specs. Same-lib, coupled
semantics — one head. **This is the single highest-leverage item in the task**
(`context.md` §2) and the one with the sharpest failure mode (R3).
**Tasks**: 5 | **Dependencies**: B4 complete | **Parallel-safe with**: B1, B3a
**Estimated effort**: 3–4h
**Projects touched (lint)**: `rpc-handlers`

> **NO DUAL-REGISTRATION WORK IS REQUIRED** (plan §2b). Compile-time entries
> already exist at `rpc.types.ts:1071` / `:894` with allowlist entries at `:3383`
> / `:3350`; runtime `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:40-86`) already
> contains `'agent:'` at `:61` and `'chat:'` at `:42`. **Do not add entries. Do
> not "fix" the manifest.**

> **NO FRONTEND CHANGE IS REQUIRED** (plan §2a). Traced end to end: the backend
> transport wraps every handler in try/catch and returns
> `{ success: false, error }` (`rpc-handler.ts:166-215`, envelope at `:209-213`);
> the frontend client's `call()` is `new Promise((resolve) => ...)` with **no
> reject path** (`claude-rpc.service.ts:130-146`). An unhandled rejection is
> structurally impossible at both call sites.

### Task 2.1: Create `agent-rpc.schema.ts` and validate `agent:resumeCliSession` ⏸️ PENDING

**Files**:

- **CREATE** `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.schema.ts`
- **MODIFY** `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (`:742-815`; registration `:753`; inline param type `:744-751`; existing `try` opens `:754`; catch `:805-813`)

**Pattern to Follow**: `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (house pattern, including its header-comment style at `:15-18` and `.passthrough()` at `:20-24`)
**Spec Reference**: implementation-plan.md §2c

**Schema shape**:

| Field             | Type                           |
| ----------------- | ------------------------------ |
| `cliSessionId`    | `z.string().min(1)`            |
| `cli`             | enum over `CliType`            |
| `task`            | `z.string().min(1)`            |
| `parentSessionId` | `z.string().min(1).optional()` |
| `ptahCliId`       | `z.string().min(1).optional()` |
| `previousAgentId` | `z.string().min(1).optional()` |

**Quality Requirements**:

- **`.passthrough()`, NOT `.strict()`.** The frontend sends exactly the six keys
  today, but the house rule exists so an outdated webview sending an extra field
  is not rejected.
- **Parse placement: INSIDE the existing `try` at `:754`.** The handler's own
  catch at `:805-813` returns `{ success: false, error: errorMessage }` — exactly
  the shape `agent-monitor.store.ts:1341-1343` already reads — and keeps the
  handler's own logging (`:808-811`) in the path. Specified so two developers do
  not choose differently.
- `.min(1)` **is** correct here: there is no "empty means something" rule on this
  method; the caller already refuses a missing id
  (`agent-monitor.store.ts:1325-1327`, `agent-card.component.ts:225`).

---

### Task 2.2: Add `SubagentQuerySchema` — shape only, NO `.min(1)` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.schema.ts`
**Dependencies**: none (parallel-safe with 2.1 within the batch, but same batch)
**Spec Reference**: implementation-plan.md §2d

**Change**:

```
z.object({ toolCallId: z.string().optional(), sessionId: z.string().optional() }).passthrough()
```

**🚨 NON-NEGOTIABLE (R3)**:

- **NO `.min(1)`.** `chat:subagent-query` has a _deliberate, documented_ answer
  for a present-but-empty `sessionId` (`subagent-rpc.handlers.ts:138-148`, added
  by Wave 1): "A sessionId that is present but empty is a scoped query whose
  scope cannot be resolved — answer with nothing." `.min(1)` would convert that
  deliberate **empty result** into an **error**.
- **NO `.transform()`, NO `.trim()`.** A schema that normalizes `''` → `undefined`
  makes the query fall through to the **unscoped** branch at `:156` — restoring
  exactly the cross-session resume leak Wave 1 fixed. This is the worst outcome
  available in this task.
- Zod's job here is **shape only**: reject non-string / non-object params.

**Also**: update the file header comment at `:3-5` — it currently documents the
_absence_ of a schema for this method and would be false after this change.
**Do not touch the five existing schemas at `:13-52`** — their `.min(1)` is
correct for _their_ methods, which have no "empty means empty result" rule.

---

### Task 2.3: Wire the parse into `subagent-rpc.handlers.ts` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.ts` (`:123-174`)
**Dependencies**: Task 2.2

**Quality Requirements**:

- **Parse placement: INSIDE the existing `try` at `:127`.** The catch at
  `:161-171` returns `{ subagents: [] }` and captures to Sentry. A malformed param
  therefore yields an empty list plus a Sentry event — acceptable, because the
  only in-app caller sends `{}` (`claude-rpc.service.ts:385`).
- **🚨 Keep the `sessionId === ''` branch at `:142-148` EXACTLY as it is.** It is
  on the §0 do-not-delete list. It owns the semantics; Zod must not take them
  over. This is the single line most likely to be wrongly deleted in this task.

---

### Task 2.4: Pin the new boundary behaviour with five specs ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.spec.ts` (new block)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.spec.ts`

**Dependencies**: Tasks 2.1, 2.2, 2.3
**Spec Reference**: implementation-plan.md §2e

| #   | Assertion                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `agent:resumeCliSession` with `cliSessionId: ''` → `{ success: false }`, error names the field; `agentProcessManager.spawn` **not** called                                       |
| 2   | `agent:resumeCliSession` with `parentSessionId: ''` → rejected; with `parentSessionId` **absent** → **succeeds** (paired-isolation sibling)                                      |
| 3   | `chat:subagent-query` with `sessionId: ''` → `{ subagents: [] }` **and** `getResumable()` (unscoped) **not** called — **this is the regression guard for the fall-through leak** |
| 4   | `chat:subagent-query` with `{}` → returns all resumable (unchanged)                                                                                                              |
| 5   | `chat:subagent-query` with `sessionId: 123` (wrong type) → does not throw out of the handler                                                                                     |

**Quality Requirements**: Every "must reject" assertion needs a sibling proving
the legitimate path still works (Wave 1 paired-isolation rule). #2 and #4 are
those siblings; do not drop them to save time.

---

### Task 2.5: Confirm the two out-of-scope findings are recorded, not fixed ⏸️ PENDING

**Dependencies**: Tasks 2.1–2.4

**Quality Requirements** — these are **explicitly out of scope**; record them in
the implementation report as follow-ups and change nothing:

- `agent-card.component.ts:229-236` swallows the RPC result (`await` inside
  `try/finally`, result discarded). It is a **pre-existing** gap — `agent:stop`
  at `:215` does the same. Item 2 does not create it and does not widen it.
  Including it would mix a UX change into a validation batch.
- The 9 `?? undefined` no-ops (census §Latent) — `??` does not collapse `''`, so
  they silently fail to normalize blank input. Latent instances of the same bug.
  Not in scope.

**Batch 2 Verification**:

- Full typecheck/test list, green at baseline
- `npx nx run-many -t lint -p rpc-handlers`
- `grep` the diff: **no `.min(1)` anywhere near `subagent`**; no `.transform(`;
  no `.trim(` in `subagent-rpc.schema.ts`
- `subagent-rpc.handlers.ts:142-148` byte-identical to before
- R10 — if a `rpc-handlers` test flakes under parallel load, rerun isolated with
  `--skip-nx-cache` before treating it as a break. **Record it, do not swallow it.**

**Do-not-touch (B2)** — plan §2 "Item 2 do-not-touch list":

- `subagent-rpc.handlers.ts:142-148` — the `''` branch. Not dead; it is the rule.
- `agent-card.component.ts:229-236` — do not add error handling in this task.
- `ALLOWED_METHOD_PREFIXES`, `rpc.types.ts`, `RPC_HANDLER_MANIFEST` — already correct.
- The five existing schemas in `subagent-rpc.schema.ts:13-52`.

---

## Batch 3a (B3a): The three surviving session-id coercions ⏸️ PENDING

**Recommended Executor**: `backend-developer` **(half A)** + `frontend-developer` **(half B)**
**Fallback Executor**: single `backend-developer` running both halves sequentially
**Execution Mode**: **parallel — two sub-agents on disjoint file sets**
**Rationale**: The two halves are file-disjoint (`cli-agent-runtime` +
`skill-synthesis` vs `tribunal-panel`), have no inter-half dependency, and share
no barrel or config. This satisfies the parallel-eligible checklist and honours
the no-mixing rule by splitting the batch across two specialists rather than
handing frontend work to a backend developer. All three edits are small; **this
is the cheapest batch in the task.**
**Tasks**: 3 | **Dependencies**: B4 complete | **Parallel-safe with**: B1, B2
**Estimated effort**: 1–2h
**Projects touched (lint)**: `cli-agent-runtime`, `skill-synthesis`, `tribunal-panel`

### Half A — backend (`backend-developer`)

#### Task 3a.1: Delete the vestigial `?? ''` and fix its now-false comment ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts` (`:196-206`; the coercion is `:205`)
**Spec Reference**: implementation-plan.md §3b #3

**Change**:

- `:205` — `ownSessionId ?? ''` → `ownSessionId`. One-line deletion.
- `:196-204` — **rewrite the comment.** It currently asserts "`''` is the absent
  marker the handler expects". **That statement is now false** —
  `CompactionHookHandler.createHooks` is already
  `(sessionId: string | undefined, cwd: string | null, …)`
  (`compaction-hook-handler.ts:126-128`). Leaving the comment would mislead the
  next reader into re-adding the coercion.

**Quality Requirements**:

- **Do NOT widen `CompactionHookHandler.createHooks`** — the widening already
  exists. If it does not at the current tree, **stop and report**; the analysis
  moved.
- Note `:178-179` already normalize via `blankToUndefined`, then `:205`
  re-emitted `''` — a round-trip inside a single function. Deleting `:205`'s
  coercion closes it.

---

#### Task 3a.2: Collapse the `skill-candidate.store.ts` round-trip ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts` (`:604-605`)
**Spec Reference**: implementation-plan.md §3b #4

**Change** — two lines become one:

```
// before
const holdout = measurement.holdoutSessionId?.trim() ?? '';
const holdoutSessionId = holdout.length > 0 ? holdout : null;

// after
const holdoutSessionId = measurement.holdoutSessionId?.trim() || null;
```

**Quality Requirements**:

- **Keep the `holdoutSessionId === null` invariant check at `:606-610`
  untouched.**
- This site is **owned by B3a and excluded from B3b's sweep** — the census lists
  `:605` under F3-variant, but B3a resolves it first. B3b must not re-touch it.
  (If B3b runs after and the line already reads `|| null`, that is correct and
  final; the shared primitive is not needed for a one-line `|| null`.)

---

### Half B — frontend (`frontend-developer`)

#### Task 3a.3: Widen the `vendor-card` input and drop the template `?? ''` ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\tribunal-panel\src\lib\components\vendor-card.component.ts` (`:53`, guard at `:58`)
- `D:\projects\ptah-extension\libs\frontend\tribunal-panel\src\lib\tribunal-page.component.ts` (`:182`)

**Spec Reference**: implementation-plan.md §3b #5

**Change**:

- `vendor-card.component.ts:53` — `tribunalSessionId = input.required<string>()` → `input<string | undefined>()`
- `tribunal-page.component.ts:182` — `[tribunalSessionId]="tribunalSessionId() ?? ''"` → `[tribunalSessionId]="tribunalSessionId()"`

**Quality Requirements**:

- **Keep the `:58` guard `if (!this.tribunalSessionId()) return null;` VERBATIM.**
  It is absence-handling and stays correct on a `string | undefined`. It is also
  one of the 97 bare-`!x` form-5 sites — **do not rewrite it to use the
  primitive.**
- The `''` existed _solely_ to satisfy `input.required<string>()`. Removing the
  requirement removes the reason for the coercion.
- `ChangeDetectionStrategy.OnPush` and signal inputs are mandatory — this is an
  existing signal input, keep it one.

**🚨 Do NOT touch** `D:\projects\ptah-extension\libs\frontend\tribunal-panel\src\lib\services\tribunal-progress.service.ts:192`
(`agent.parentSessionId ?? ''`). It is row #6 of the acceptance table and is
**EXCLUDED**: it sits inside a `JSON.stringify` memo-key derivation (`:180-196`)
and coerces for _stable serialization_, not to populate a session-id field.
Changing it alters cache-key semantics for no benefit. This row exists precisely
so nobody "completes" the acceptance criterion by editing it.

**Batch 3a Verification**:

- Full typecheck/test list, green at baseline
- `npx nx run-many -t lint -p cli-agent-runtime,skill-synthesis,tribunal-panel`
- R1 — `libs/frontend/core` coverage floor untouched (this batch does not edit `core`)
- After B3a + B1, **rows #1–#5 of the acceptance-criterion table are all closed**;
  row #6 is a documented exclusion. Record this in the implementation report.

---

## Batch 3b (B3b): The shared blankness primitive + the narrow sweep ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: Mechanical but wide (22 sweep sites across 4 libs, plus a new
shared util and 3 helper rewires). It is a cross-file refactor with a single
consistent rule and a shared barrel edit — parallelising it would produce barrel
conflicts and inconsistent trim decisions. One head, one policy.
**Tasks**: 6 | **Dependencies**: **B4 (hard — shared barrel conflict, R13)**, B1, B2, B3a all green | **Parallel-safe with**: nothing
**Estimated effort**: 4–6h
**Projects touched (lint)**: `shared`, `agent-sdk`, `memory-curator`, `skill-synthesis`, `vscode-core`, `cli-agent-runtime`

> **B3b MUST land after B4.** Both touch
> `libs/shared/src/lib/utils/index.ts`, and `libs/shared` is upstream of
> everything. Serialising them avoids a barrel conflict (R13).

### Task 3b.1: Create the shared primitive ⏸️ PENDING

**File**: **CREATE** `D:\projects\ptah-extension\libs\shared\src\lib\utils\session-id.utils.ts`
**Spec Reference**: implementation-plan.md §3c, §3d
**Pattern to Follow**: `libs/shared/src/lib/utils/assert-never.ts` / `pick-primary-model.ts` — pure, dependency-free single-concern util modules (team-leader verified both exist)

**Two functions, one documented trim policy**:

- `blankToUndefined(value: string | null | undefined): string | undefined` — returns the **trimmed** value or `undefined`
- `blankToNull(value: string | null | undefined): string | null` — a one-line `?? null` wrapper of the above, for SQL binds

**Trim policy (decided once, must be in the JSDoc)**: **trim, and treat
whitespace-only as absent.** This is the majority policy and the only one that
cannot be defeated by a stray space.

**Quality Requirements**:

- Both pure and dependency-free (`libs/shared/CLAUDE.md` guideline 3).
- **The JSDoc must note the deliberate exception**: `knownSessionId`
  (`chat-streaming/.../session-scope.ts:25`) deliberately does **not** trim, and
  that divergence is pinned by `session-scope.spec.ts`. Recording it here makes
  the exception discoverable rather than looking like an oversight.
- **The JSDoc on `blankToNull` must state why `null` exists**: better-sqlite3
  **cannot bind `undefined`** — it throws. `null` is _required_ at the SQL
  boundary, not a style choice (`memory.store.ts:188-189`, whose siblings are all
  `?? null`). `undefined` is the primary because it is the codebase's canonical
  absence (`libs/shared/CLAUDE.md` guideline 1) and `??` needs it to fall through.

---

### Task 3b.2: Export from the utils barrel ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts`
**Dependencies**: Task 3b.1

**Quality Requirements**: Use the **named-export** form
(`export { blankToUndefined, blankToNull } from './session-id.utils';`) — the
barrel's newer entries use named exports, not `export *`. Team-leader verified
the barrel currently has 9 export statements and no blankness primitive.

---

### Task 3b.3: Spec the primitive ⏸️ PENDING

**File**: **CREATE** `D:\projects\ptah-extension\libs\shared\src\lib\utils\session-id.utils.spec.ts`
**Dependencies**: Task 3b.1

**Required cases** (both functions): `undefined` → absent · `null` → absent ·
`''` → absent · `'   '` → **absent** (the policy decision) · `'  abc  '` →
`'abc'` (**trimmed value returned**) · a real UUID → returned unchanged ·
`blankToNull` returns `null` not `undefined` for every absent case (the SQL bind
contract).

**Note**: `blankToUndefined` and `sessionIdOrNull` have **zero** spec coverage
anywhere today (census §F7/§F8). This spec is the first.

---

### Task 3b.4: Rewire the three existing implementations ⏸️ PENDING

**Files**:

| #   | File                                                                                                            | Line                 | Change                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-registry.utils.ts` | 41                   | `blankToUndefined` becomes a one-line re-export/caller of the shared primitive. Its 4 call sites (`ptah-cli-registry.ts:653,654`, `ptah-cli-spawn-options.service.ts:178,179`) keep working unchanged — the behaviour is identical (trims, returns trimmed, `undefined`). |
| 2   | `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.ts`                                | 140 (call at `:188`) | `sessionIdOrNull` becomes `blankToNull`. ⚠️ **Behavioural change**: today it _tests_ the trimmed value but **returns the untrimmed** one. The primitive returns trimmed. Correct, but conscious — state it in the report.                                                 |
| 3   | `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts`                      | 605                  | **Owned by B3a (Task 3a.2).** If B3a landed, this now reads `\|\| null` and needs nothing. Do not re-touch.                                                                                                                                                               |

**Dependencies**: Tasks 3b.1, 3b.2

**Quality Requirements**: Keep `memory.store.ts:188`'s bind-parameter object
shape intact — its siblings (`workspace_root: insert.workspaceRoot ?? null`,
`:189`) are unchanged.

---

### Task 3b.5: Sweep the forms 1–4 sites ⏸️ PENDING

**Dependencies**: Tasks 3b.1, 3b.2
**Spec Reference**: `item-3-blank-id-census.md` §Census by form; implementation-plan.md §3c

The plan says "sweep the 28 forms 1–4 sites". **6 of those 28 are hard-excluded
by another normative section of the same plan** (§0, §2d, §3c, §6d). The
team-leader has resolved the collision below rather than leaving two developers
to guess. See **Clarification 1** at the end of this file.

**Result: 22 sweep sites across 4 libs** — still comfortably past the §3c
threshold of "≥ 8 production call sites across ≥ 4 libs", so the primitive
remains warranted on the plan's own stated criterion.

#### Disposition table — every one of the 28

| Form   | File                                                          | Line(s)                           | Disposition                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1     | `agent-sdk/src/lib/sdk-agent-adapter.ts`                      | 647                               | ✅ SWEEP — but this is the §0 _init-callback blank refusal_. **Refactor the expression only; the guard, its log and its early return survive.**                                                                                                                                                                             |
| F1     | `agent-sdk/src/lib/session-metadata-store.ts`                 | 406                               | ✅ SWEEP                                                                                                                                                                                                                                                                                                                    |
| F1     | `agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`      | 1164                              | ❌ **EXCLUDE** — plan §6d invariant: "MCP URL routing segment; missing id throws `SdkError` … **Untouched**". Do not touch it in B3b or anywhere.                                                                                                                                                                           |
| F1     | `agent-sdk/.../session-lifecycle/session-registry.service.ts` | 157                               | ✅ SWEEP — §0 `bindRealSessionId` blank refusal. **Expression only; set-once discipline and the refusal survive.**                                                                                                                                                                                                          |
| F1-var | `skill-synthesis/src/lib/triggers/skill-trigger.service.ts`   | 190, 225, 305, 347, 457           | ✅ SWEEP — ⚠️ **R12 trim-policy change** (currently `!x \|\| x.length === 0`, no trim)                                                                                                                                                                                                                                      |
| F1-var | `skill-synthesis/src/lib/skill-invocation-recorder.ts`        | 36                                | ✅ SWEEP — ⚠️ R12                                                                                                                                                                                                                                                                                                           |
| F1-var | `memory-curator/src/lib/triggers/memory-trigger.service.ts`   | 225, 256, 282, 319, 344, 398, 452 | ✅ SWEEP — ⚠️ R12                                                                                                                                                                                                                                                                                                           |
| F2     | `agent-sdk/src/lib/sdk-permission-handler.ts`                 | 1030                              | ❌ **EXCLUDE** — §0 do-not-delete, and the **only** site where the tri-state distinction is load-bearing and hand-rolled: `cleanupPendingPermissions(sessionId?)` treats `undefined` as "all sessions" and `''` as "not all sessions". `blankToUndefined` collapses exactly the distinction this site depends on. Leave it. |
| F3     | `memory-curator/src/lib/observation-queue.store.ts`           | 130                               | ✅ SWEEP — §0 blank refusal. **Expression only; the refusal and its `:119-128` doc survive.**                                                                                                                                                                                                                               |
| F3     | `skill-synthesis/src/lib/skill-synthesis.service.ts`          | 424                               | ✅ SWEEP — §0 bare-`string` boundary guard. **Expression only.**                                                                                                                                                                                                                                                            |
| F3-var | `memory-curator/src/lib/memory-curator.service.ts`            | 242                               | ✅ SWEEP — ⚠️ the adjacent `:243` `${workspaceRoot ?? ''}::${sessionId}` coerces **workspaceRoot**, not a session id. **Do not touch `:243`.**                                                                                                                                                                              |
| F3-var | `memory-curator/src/lib/triggers/memory-trigger.service.ts`   | 335                               | ✅ SWEEP                                                                                                                                                                                                                                                                                                                    |
| F3-var | `agent-sdk/src/lib/session-importer.service.ts`               | 240                               | ✅ SWEEP                                                                                                                                                                                                                                                                                                                    |
| F3-var | `agent-sdk/src/lib/helpers/hook-session-resolver.ts`          | 32, 35                            | ❌ **EXCLUDE ×2** — §3c: "Its `null` return and payload-first precedence are a _different_ rule (two-source precedence), not a blankness converter. **Do not fold it in.**" Also §0.                                                                                                                                        |
| F3-var | `skill-synthesis/src/lib/skill-candidate.store.ts`            | 605                               | ❌ **EXCLUDE** — owned by B3a Task 3a.2                                                                                                                                                                                                                                                                                     |
| F4     | `vscode-core/src/services/subagent-registry.service.ts`       | 463                               | ✅ SWEEP — §0 `beginTeardown` empty check. **Expression only; the warn and early return survive.**                                                                                                                                                                                                                          |
| F4     | `rpc-handlers/.../subagent-rpc.handlers.ts`                   | 143                               | ❌ **EXCLUDE** — §0 **and** §2d: "Keep the `sessionId === ''` branch at `:142-148` **exactly as it is**." It owns semantics. B2 also edits this file.                                                                                                                                                                       |

**Totals**: 22 SWEEP · 6 EXCLUDE · 28 accounted for.
**Libs swept**: `agent-sdk` (4), `skill-synthesis` (6), `memory-curator` (10),
`vscode-core` (1) — plus `cli-agent-runtime` via Task 3b.4. ✅ ≥ 4 libs, ≥ 8 sites.

**🚨 EXPLICITLY OUT OF SCOPE — the 97 bare `!x` sites (form 5), across 46 files**
(R11, plan §3c, plan §9 point 4). On a `string | undefined`,
`if (!sessionId) return;` is already correct and idiomatic. Rewriting 97 of them
is large-surface churn with real regression risk and **zero** behavioural gain.
This is 70% of all census hits. **A reviewer must reject any B3b diff that touches
a bare `!x` guard.** Backend: `agent-sdk` 22 (incl. all 12 hook handlers'
`if (!resolvedSessionId)` rejection — the _correct_ published pattern),
`cli-agent-runtime` 10, `vscode-core` 6, `memory-curator` 1. Frontend: `chat` 34,
`chat-streaming` 14, `tribunal-panel` 8, `chat-routing` 3, `harness-builder` 3,
`chat-state` 1, `skill-synthesis-ui` 1, `memory-curator-ui` 1.

**Also out of scope**: `knownSessionId` / `agentVisibleInSession` (§0, frontend,
no-trim policy pinned by `session-scope.spec.ts` — changing its trim behaviour is
a behavioural change needing its own justification); `resolveHookSessionId` /
`resolveFirstPresent`; the F6 sites (6, `x ? x : undefined`); the F5 inline
`sdk-message-transformer.ts:132-133` whose `:124-127` comment explicitly says
"`||` not `??`" because the caller can hand `''`; the 9 `?? undefined` no-ops.

---

### Task 3b.6: Pin the deliberate trim-policy change (R12) ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts`
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.spec.ts`

**Dependencies**: Task 3b.5

**Quality Requirements**:

- **One spec per trigger service** asserting a whitespace-only session id is now
  treated as absent (rejected). The 13 F1-variant sites currently do **not** trim;
  adopting the trim policy is a real behavioural change there — correct, but it
  must be **conscious and pinned, not silent**.
- Paired-isolation sibling for each: a real (non-blank, untrimmed-clean) id is
  still accepted and still arms the timer.

**Batch 3b Verification**:

- Full typecheck/test list, green at baseline
- `npx nx run-many -t lint -p shared,agent-sdk,memory-curator,skill-synthesis,vscode-core,cli-agent-runtime`
- **Diff audit**: zero bare `!x` guards changed; zero §0 guards _removed_ (only
  inner expressions rewritten); `hook-session-resolver.ts`, `session-scope.ts`,
  `sdk-permission-handler.ts`, `sdk-query-options-builder.ts:1164` and
  `subagent-rpc.handlers.ts:143` all untouched
- **Census verdict written into the implementation report** (acceptance criterion
  3): the primitive exists, 22 of 28 forms 1–4 sites adopt it, 6 are excluded with
  the reason each, and the 97 form-5 sites are excluded by policy.

---

## FULL GATE CHECKPOINT — after B3b, before B5a

Items 1–4 are complete at this point. **The empty-string gate must be verified
green before any item-6 work begins** (R6: item 6 is a defect class independent
of the empty string, and a regression in either failure mode blocks the other —
the objection recorded in `context.md` §6).

Run the full typecheck + test + lint sweep. **16 projects typecheck, 9,834 tests.**
Do not start B5a until this is green and the numbers are recorded.

Acceptance criteria satisfied at this checkpoint:

- ✅ No `?? ''` / `|| ''` coercion onto a session-id field remains in `libs/**`
  (rows #1–#5 closed; row #6 documented exclusion)
- ✅ Both RPC entry points validate with Zod, with specs pinning malformed/absent
- ✅ The blank-id audit is written down and a primitive exists with its call sites

---

## Batch 5a (B5a): Item 6 Part A — prevention ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: Architecture-bearing change to the activity emission path inside
one file, with an ordering invariant that must be reasoned about as a whole.
Self-contained to `agent-sdk`, zero consumer changes — and it **delivers most of
the value on its own**, so it is separated from B5b to protect the gate.
**Tasks**: 3 | **Dependencies**: **FULL GATE green** | **Parallel-safe with**: nothing
**Estimated effort**: 2–3h
**Projects touched (lint)**: `agent-sdk`

### Context the developer must read first

A tabId at the current commit is a **UUID v4**
(`tab-manager.service.ts:2066-2068` → `TabId.create()` → `branded.types.ts:165-167`
→ `uuidv4()`). `tab_<ts>_<id>` is the **legacy** format, now rejected at the chat
RPC boundary (`chat-rpc.schema.ts:4-13, 36-41`). Consequences:

- `SessionId.validate(tabId)` returns **true**. A tabId is
  shape-indistinguishable from an SDK session UUID.
- **Canonicalisation by inspection is impossible.** Any "detect a tabId and swap
  it" design is unimplementable.
- **Never write a `LIKE 'tab\_%'` SQL predicate** — it would match only legacy rows.

`item-6-consumer-audit.md` says `tab_N` throughout. **It is wrong on that point
and carries its own correction banner.** Its _mechanism_ and _enumeration_
sections remain correct. The plan wins on every disagreement.

### Task 5a.1: Buffer the pre-init user activity ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md §6c Part A

**The window, precisely**: `:506` calls
`this.notifyActivity(trackingId, 'user', …)` **before** `streamTransformer.transform`
at `:509` consumes the stream. `resolveActivityIds` (`:827-835`) canonicalises via
`rec?.realSessionId ?? (sessionId as string)`, but at `:506` `realSessionId` is
still `null`, so it emits the tabId. **Every later `notifyActivity` emits the
UUID.** `SessionEnd` always canonicalises
(`session-control.service.ts:126` — `rec.realSessionId ?? rec.tabId`, notified
`:168-171`, bulk path `:212`). So state is armed under the tabId and torn down
under the UUID. **It is a first-turn-only window on one call site** — which is
why it is intermittent.

**Change**:

- `:506` — record **pending** user activity for `trackingId` instead of notifying
  immediately.
- The existing resolve path `createSessionIdCallback` (`:637-665`, which already
  calls `bindRealSessionId` at `:661` and `emitSessionIdResolved` at `:664`)
  flushes the buffered activity through `resolveActivityIds` — which now returns
  the UUID.
- **If the session ends without ever resolving, flush under the tabId on
  teardown** — matching `session-control.service.ts:126`'s own
  `realSessionId ?? tabId` rule, so both ends stay consistent.

**Quality Requirements**:

- Emit **once**, under the canonical id. Not twice; not a correction event.
- Zero changes in `skill-synthesis` / `memory-curator`. Zero SQLite work in B5a.
- No row is written under a tabId **in the first place** — this is prevention, not
  repair, and it is the primary fix.

---

### Task 5a.2: Correct the stale `agent-sdk/CLAUDE.md` claim ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md` (`:77`, "Hook session identity")
**Dependencies**: Task 5a.1

**Change**: `:77` states that `SdkQueryOptionsBuilder.createHooks` captures
`sessionId ?? ''` and that the closure therefore holds `''` for a new session.
**That coercion no longer exists.** `sdk-query-options-builder.ts:1226-1232` is
`createHooks(cwd: string, sessionId?: string, …)` and
`compaction-hook-handler.ts:126-128` is `createHooks(sessionId: string | undefined, …)`.
The closure holds `undefined`.

**Quality Requirements**:

- Per the Wave 2 convention, the `''` reference in the same paragraph becomes
  **absent**.
- Leaving it stale invites a developer to re-add exactly the coercion B3a Task
  3a.1 just deleted. This is why the doc fix is pulled forward into B5a rather
  than left in B5b.
- **Do not** change the `registerKey` or MCP-caller-identity rules documented in
  the same file — those invariants hold and are §6d normative.

---

### Task 5a.3: Part A spec ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (or the nearest existing activity-path spec)
**Dependencies**: Task 5a.1
**Spec Reference**: implementation-plan.md §6e spec 1

**Required assertions**:

1. Drive a new session through first prompt → `init` → `SessionEnd`. Assert the
   activity registry emitted the **UUID exactly once** and **never** the tabId,
   and that the trigger-facing state holds **one** entry which `SessionEnd` clears.
2. **Paired-isolation sibling** (Wave 1 rule): a session whose id **never
   resolves** must still be torn down correctly **under its tabId**.

---

**Batch 5a Verification**:

- Full typecheck/test list, green at baseline
- `npx nx run-many -t lint -p agent-sdk`
- Diff audit against the §6d invariant table below

**Do-not-touch (B5a)** — plan §6d + §6f:

| Invariant                                             | Location                                                         | Status        |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| `trackingId = tabId as SessionId`                     | `sdk-agent-adapter.ts:460`                                       | **Untouched** |
| `registerKey = sessionConfig?.tabId ?? sessionId`     | `session-query-executor.service.ts:118`                          | **Untouched** |
| MCP URL routing segment; missing id throws `SdkError` | `sdk-query-options-builder.ts:1153-1184` (throw at `:1164-1172`) | **Untouched** |
| `extractCallerSessionId` parses `[^/?]+`              | `vscode-lm-tools/.../http-server.handler.ts:141-149`             | **Untouched** |
| `resolveHookSessionId` returns `null`, never `''`     | `hook-session-resolver.ts`                                       | **Untouched** |
| `IAgentAdapter.setSessionIdResolvedCallback`          | `agent-adapter.types.ts:253`                                     | **Untouched** |

Also: `teammateIdle` (`sdk-adapter-events.service.ts:69-81`) is **confirmed
intentional aspirational surface with a documented reason for having no
subscriber**. It is **NOT a consumer**. Do not treat it as one and **do not
delete it**.

---

## Batch 5b (B5b): Item 6 Part B — reconciliation, backfill, migration 0039 ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: The largest and highest-risk batch. A new DI-registered registry,
two consumer subscriptions with matching lifecycle, transactional SQLite backfill
with a constraint-collision rule, and a numbered migration — all interdependent
and all requiring architecture decisions. Never parallelise.
**Tasks**: 7 | **Dependencies**: **B5a complete and green** | **Parallel-safe with**: nothing
**Estimated effort**: 6–9h (reduced from the plan's original B5 estimate by the
USER DECISION that historical rows are reaped, not reconciled)
**Projects touched (lint)**: `agent-sdk`, `memory-curator`, `skill-synthesis`, `persistence-sqlite`
**⚠️ Verification lists gain `persistence-sqlite` for this batch.**

> **The audit's proposed fix is REJECTED.** It proposed promoting the single-slot
> `onSessionIdResolved` setter to a fan-out registry. That setter is part of the
> **shared port** — `agent-adapter.types.ts:253` on `IAgentAdapter`, backed by
> `SdkAdapterCallbackRegistry` (`sdk-adapter-callback-registry.ts:10`) and already
> consumed by `cli-agent-runtime` (`wiring/sdk-callbacks.ts:155`). Promoting it is
> a breaking port change for no gain. **Add a twelfth registry alongside it.**

### Task 5b.1: Create `SessionIdResolvedCallbackRegistry` ⏸️ PENDING

**File**: **CREATE** `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-id-resolved-callback-registry.ts` (+ sibling spec)
**Pattern to Follow**: `libs/backend/agent-sdk/src/lib/helpers/compaction-callback-registry.ts` — `Set`, `register()` returning a disposer, `notifyAll` with **per-callback try/catch**. Shape it **exactly** like that.
**Spec Reference**: implementation-plan.md §6c Part B

**Quality Requirements**: This is the established pattern — both trigger services
already consume 8–11 instances of it. Do not invent a new shape.

---

### Task 5b.2: Register the DI token ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts` — add `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts` — register it

**Dependencies**: Task 5b.1

**Quality Requirements**: `Symbol.for(...)`, `UPPER_SNAKE`, per the repo DI
convention. Follow the existing `SDK_COMPACTION_CALLBACK_REGISTRY` entry exactly.

---

### Task 5b.3: Notify from both existing emit sites ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (`:610` resume path, `:664` new-session path)
**Dependencies**: Tasks 5b.1, 5b.2

**🚨 Quality Requirements**:

- Notify the new registry **ALONGSIDE**, never instead of,
  `this.callbacks.emitSessionIdResolved(...)`.
- **The single-slot setter and the `IAgentAdapter` port are untouched.**
  `cli-agent-runtime/wiring/sdk-callbacks.ts:155` must keep working unchanged.
- Both sites, not one — the resume path and the new-session path.

---

### Task 5b.4: Subscribe both trigger services and implement `rekeySession` ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts` (11 registries at `:96-132`, subscribed `:138-170`, disposed `:182-206`)
- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts` (8 registries at `:87-109`)

**Dependencies**: Task 5b.3

**Each service**: inject the registry, subscribe in `start()`, **dispose in
`stop()`**, implement `rekeySession(fromId, toId)`.

**State to migrate**:

| Owner                   | Keyed state                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `MemoryTriggerService`  | `sessions` (+ `idleTimer`), `episodes`, `inFlightCurates`, `lastCurateAt` |
| `MemoryCuratorService`  | `inFlight`, key `` `${workspaceRoot ?? ''}::${sessionId}` `` (`:243`)     |
| `SkillTriggerService`   | `sessions`, `turnCompleteStates`, `editTestStates` (+ 2 timers)           |
| `SkillSynthesisService` | `analyzedSessions`                                                        |

**🚨 Rekey semantics — mirror `bindRealSessionId`'s discipline**
(`session-registry.service.ts:156-180`: set-once, rejects blank, rejects unknown,
idempotent, refuses overwrite):

- Migrate every map entry from `fromId` to `toId`.
- **If `toId` already exists, KEEP IT and discard the `fromId` entry** (clearing
  its timer). **Never clobber.** A missed merge is recoverable; a wrong overwrite
  is not — the same "miss rather than wrongly delete" rule Wave 1 applied to
  `removeSupersededInterrupted`. (R4)
- **Re-arm timers under `toId` with the remaining delay; clear the `fromId`
  timer.** A `setTimeout` closure captures the id it was armed with
  (`skill-trigger.service.ts:203-206` is the worked example) — re-arming is not
  optional.
- **The handler must be SYNCHRONOUS**, and must migrate `inFlightCurates` /
  `lastCurateAt` **BEFORE** `sessions`, so no `await` interleaves between reading
  the old key and writing the new one. (R-Q3)

**Do NOT fold in the three existing tabId→UUID remaps** —
`SessionRegistry.bindRealSessionId`, `SubagentRegistryService.resolveParentSessionId`,
`AgentProcessManager.resolveParentSessionId`. They are already correct.

---

### Task 5b.5: Live in-process SQLite backfill ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\observation-queue.store.ts` — **backfill method only**
- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\queue\skill-queue.store.ts` — **backfill method only**

**Dependencies**: Task 5b.4
**Spec Reference**: implementation-plan.md §6c Q1

**Change**:

- `observation_queue`: `UPDATE observation_queue SET session_id = ? WHERE session_id = ?`,
  **in the same transaction as the map migration**.
- `skill_synthesis_queue`: the `UNIQUE(session_id, stage)` constraint
  (`skill-queue.store.ts:7`, `:197`) means a plain `UPDATE` can **collide and
  throw, aborting the rekey** (R5). Use **`UPDATE OR IGNORE` followed by a
  `DELETE` of the un-migrated remainder**, so the pre-existing `toId` row wins.

**🚨 Quality Requirements**:

- **Never write a `LIKE 'tab\_%'` predicate.** A tabId is a UUID v4; that
  predicate would match only legacy rows (§6a Correction 1).
- **Do not touch `ObservationQueueStore.insert`'s blank refusal at `:130`** — §0.
  (B3b may have rewritten its inner expression; the refusal itself stands.)
- With B5a landed, this backfill should find **zero rows in the common case**. It
  exists for the residual hook path — a hook payload that genuinely lacks
  `session_id` and falls back to the closure — **and it must still be correct.**

---

### Task 5b.6: Part B specs ⏸️ PENDING

**Dependencies**: Tasks 5b.4, 5b.5
**Spec Reference**: implementation-plan.md §6e spec 2, §6c Q3

**Required assertions**:

1. **Rekey + teardown**: register trigger state under the tabId directly
   (simulating the residual hook path), fire the rekey, then fire `SessionEnd`
   under the UUID. Assert the tabId-keyed **timer is cleared** and **no entry
   survives**. _This is the literal `context.md` acceptance criterion._
2. **Refuse-overwrite** (R4): rekey where `toId` already exists → `toId` is kept,
   the `fromId` entry is discarded, its timer cleared, `toId`'s state unchanged.
3. **Double-curate guard** (Q3): start a curate, fire the rekey mid-flight,
   assert **exactly one** curate ran.
4. **Constraint collision** (R5): a `skill_synthesis_queue` rekey where a `toId`
   row already exists for the same stage → no throw, pre-existing row wins,
   remainder deleted.
5. **Paired-isolation sibling**: a session whose id never resolves is still torn
   down correctly under its tabId (may reuse the B5a sibling).

---

### Task 5b.7: Migration 0039 — reap, never reconcile ⏸️ PENDING

**Files**:

- **CREATE** `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0039_<name>.ts`
- **CREATE** `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0039_<name>.spec.ts`
- **MODIFY** `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\index.ts` — append `{ version: 39, name: '0039_<name>', sql: sql0039<Name> }`

**Dependencies**: none within B5b (may be done first)
**Spec Reference**: implementation-plan.md §6c Q1 USER DECISION
**Team-leader verified**: `index.ts` last entry is `{ version: 38, name: '0038_gateway_message_turn_state' }`. **0039 is correct.** Every migration since 0034 ships a sibling `.spec.ts` — follow that.

**🚨 Shape — static SQL, bounded, age-based**:

- Delete **unprocessed** `observation_queue` rows and **un-advanced**
  `skill_synthesis_queue` rows **older than the existing retention window**.
- **No filesystem access. No `LIKE 'tab\_%'` predicate. No id mapping.**
- **Must NOT touch processed rows.**
- **Must NOT touch rows inside the retention window** — a live install upgrading
  mid-session has legitimate unprocessed rows.

**Why reaping, not reconciliation** (this reasoning must survive review):

- The tabId→UUID mapping lives **only** in the in-memory `SessionRegistry` and is
  **never persisted**. Nothing on disk records which tabId belonged to which
  session, so a migration has **nothing to join on**. Reconciliation of historical
  rows is **impossible, not merely deferred.** **Do not attempt one, and do not
  let a reviewer ask for one.**
- The orphaned rows are internal work-queue entries — pending observations to
  curate, pending synthesis stages — **not user data**. Conversations live in the
  SDK's JSONL files and are untouched by any part of this task. The cost is some
  un-curated memories and un-synthesised skills from old sessions.
- `SqliteMigrationRunner` (`persistence-sqlite/src/lib/migration-runner.ts`)
  applies numbered, forward-only migrations **automatically at boot**, atomic per
  migration, idempotent via `schema_migrations`. **There is no manual post-deploy
  step.**
- **`SessionImporterService` is NOT the mechanism.** It scans
  `~/.claude/projects/*.jsonl` and imports session **metadata** for the UI
  (`agent-sdk/src/lib/session-importer.service.ts:1-9`). It never touches
  `observation_queue` or `skill_synthesis_queue`. **Do not wire it into this task.**

**Batch 5b Verification**:

- `npx nx run-many -t typecheck -p <full list>,persistence-sqlite`
- `npx nx run-many -t test -p <full list>,persistence-sqlite`
- `npx nx run-many -t lint -p agent-sdk,memory-curator,skill-synthesis,persistence-sqlite`
- Diff audit against the §6d invariant table (reproduced in B5a)
- `IAgentAdapter` / `agent-adapter.types.ts:253` unchanged;
  `cli-agent-runtime/wiring/sdk-callbacks.ts` unchanged
- No `LIKE 'tab\_%'` anywhere in the diff
- Baseline restored: **16 projects typecheck, 9,834 tests** (plus the new specs)

**Do-not-touch (B5b)** — plan §6f:

- `sdk-agent-adapter.ts:460`, `session-query-executor.service.ts:118`,
  `sdk-query-options-builder.ts:1153-1184` — the three invariants. Changing any of
  these is the "substitution" the brief forbids.
- The single-slot `setSessionIdResolvedCallback` / `SdkAdapterCallbackRegistry`
  and `cli-agent-runtime/wiring/sdk-callbacks.ts` — **add alongside, never replace**.
- The three existing tabId→UUID remaps (`SessionRegistry.bindRealSessionId`,
  `SubagentRegistryService.resolveParentSessionId`,
  `AgentProcessManager.resolveParentSessionId`) — already correct; do not fold
  them into the new registry.
- `sdk-adapter-events.service.ts` `teammateIdle` — **leave it subscriber-less.**

---

## Standing instruction for EVERY batch brief

The orchestrator must include the following in every developer prompt:

1. **Re-read §0 above. No listed guard may be deleted.** This is the
   highest-probability regression in the task (R2). `?: string` does NOT make
   `''` unrepresentable — `''` is a `string`.
2. **Spot-check every line number before editing.** This plan and
   `item-3-blank-id-census.md` were written against a **dirty working tree**.
   Note the one "drift" reported during decomposition (`memory.ts:46` → `:45`)
   was itself an error and has been retracted — the plan's `:46` is correct. So
   spot-check the plan AND spot-check any correction to it; a confident
   correction is not automatically right.
3. **Zero specs deleted.** Where a spec pins removed behaviour, it is
   **inverted/adapted**, never deleted (Wave 2 precedent, R8).
4. **Every "must reject" assertion needs a sibling proving the legitimate path
   still works** (Wave 1 paired-isolation rule).
5. **You do NOT create git commits.** The team-leader owns git.
6. **No stubs, placeholders, TODOs, or hardcoded mock data.**
7. Report file paths and how each validation risk in your batch was addressed.

---

## Follow-ups recorded, deliberately NOT done in this task

| #   | Item                                                                      | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Item 5 — branded / template-literal types** on the three widened fields | NO-GO (plan §5). Item 2 closes both doors; the remaining producers are internal and guarded; a brand on `FlatStreamEvent.sessionId` is a bigger surface than items 1–4 and 6 combined (~25 emit sites); and a brand cannot distinguish a tabId from a session UUID — both are UUID v4 — so it would give **false confidence on exactly the axis item 6 is about**. If revived, it needs its own task and its own gate. |
| 2   | The **9 `?? undefined` no-ops** (census §Latent)                          | `??` does not collapse `''`, so they silently fail to normalize. Latent instances of the same bug. Out of scope.                                                                                                                                                                                                                                                                                                       |
| 3   | `agent-card.component.ts:229-236` swallowing the RPC result               | Pre-existing; `agent:stop` at `:215` does the same. A UX change; would mix into a validation batch.                                                                                                                                                                                                                                                                                                                    |
| 4   | The **97 bare `!x` form-5 sites**                                         | Already correct and idiomatic on `string \| undefined`. Zero behavioural gain, real regression risk.                                                                                                                                                                                                                                                                                                                   |
| 5   | `memory:sessionStartInjected` unwired channel (`memory.ts:55`)            | Zero producers, zero consumers. Protocol is append-only; recorded, not removed.                                                                                                                                                                                                                                                                                                                                        |
| 6   | `agent-monitor.store.ts` (~1,610 lines vs the 700 soft ceiling)           | Real, but a different concern from session identity. Items 4 and 6 both touch files near it — **do not opportunistically split it.**                                                                                                                                                                                                                                                                                   |
| 7   | `knownSessionId`'s no-trim divergence from the new primitive              | Deliberate, pinned by `session-scope.spec.ts`, documented in the primitive's JSDoc. Changing it is a behavioural change needing its own justification.                                                                                                                                                                                                                                                                 |

---

## Follow-ups discovered during implementation — NOT in this task

Each was found by a developer, verified by the orchestrator, and deliberately
left alone. File separately; do not absorb into TASK_2026_296.

### F1. `ptah agent-cli resume` is dead, and B2 makes it fail earlier

`apps/ptah-cli/src/cli/commands/agent-cli.ts:322-326` sends `cli: 'glm'` through
an `as unknown as CliType` cast, plus `task: opts.task ?? ''`. Both are now
rejected by `AgentResumeCliSessionParamsSchema`.

**This is not a regression — the path was already non-functional.** Verified:
`CLI_AGENT_ALLOWLIST = ['glm']` (`agent-cli.ts:48`) is a locked, non-bypassable
allowlist, so `glm` is the ONLY accepted `--cli` value for the whole
`ptah agent-cli` command group — and `glm` is **not** a member of `CliType`
(`agent-process.types.ts:73` = `codex | copilot | cursor | antigravity |
opencode | pi | ptah-cli`). `AgentProcessManager.doSpawn` calls
`cliDetection.getDetection(cli)` (`agent-process-manager.service.ts:323`), which
is `detectAll().find(r => r.cli === cli)` — `glm` matches nothing, so `:335`
throws `"glm CLI is not installed"`. The capability does not regress; the failure
just moves to the boundary and names the field.

**The real fix, for the follow-up task:** GLM is a **ptah-cli provider** (Z.AI
GLM), not a system CLI. `ptah agent-cli resume` should send
`cli: 'ptah-cli'` + the resolved `ptahCliId`, which is what a `glm` agent
actually is. The unit spec at `agent-cli.spec.ts:586` mocks the RPC, so it never
exercised the handler and still passes — the deadness is untested either way.

### F2. Nine `?? undefined` no-ops that silently fail to normalize

`??` does not collapse `''`, so these do nothing:
`sdk-query-options-builder.ts:665`, `sdk-adapter-callback-registry.ts:37`,
`ptah-cli-registry.ts:733`, `message-finalization.service.ts:115,134,244,266`,
`harness-workflow.service.ts:502`. Latent instances of the exact defect the
blankness helpers exist to prevent. Recorded in `item-3-blank-id-census.md`.

### F3. `agent-card.component.ts:229-236` swallows every RPC result

`await` inside `try/finally` with the result discarded; `agent:stop` at `:215`
does the same. Pre-existing, not created or widened by B2. A Zod rejection on
`agent:resumeCliSession` will surface as a silent no-op at this one call site
(the other caller, `agent-monitor.store.ts:1329-1343`, handles it correctly).

### F4. `MEMORY_EXTRACTED` has no consumer anywhere in the repo

After B1 removed both `?? ''` coercions, the absence contract on that channel is
pinned **solely by the two specs B1 touched**. If a consumer ever appears, those
specs are the only thing standing between it and a re-introduced coercion.

---

## Clarifications — RESOLVED 2026-08-19 by the orchestrator

> **Clarification 1: team-leader's resolution UPHELD. 22 sweep sites, 6 hard-excluded.**
> §0's stated rationale is "no batch may **delete** any of them" — that governs a
> guard's _existence_, not its spelling. Refactoring the inner expression while
> the guard, its log line and its early return all survive is precisely what the
> primitive is for. 22 sites across 4 libs still clears §3c's pre-stated
> threshold, so the primitive remains warranted on the criterion written in
> advance rather than one adjusted to fit.
>
> The `sdk-permission-handler:1030` exclusion was independently verified and is
> **load-bearing**. `cleanupPendingPermissions(sessionId?: string)` is a genuine
> tri-state: `undefined` = "all sessions" (deliberate), `''` = a caller that lost
> its id (refuse). Collapsing `''` → `undefined` via the primitive would resolve
> **every** pending permission in the process as deny/systemAbort — the exact
> TASK_2026_295 defect the guard exists to prevent. **Do not sweep it, and do not
> let a reviewer ask for consistency here.**
>
> **Clarification 2: B4's backend/frontend mix ACCEPTED** as a 6-line
> contravariant change assigned to one `backend-developer`. B3a stays split.
>
> Original text retained below for the record.

### 1. The plan's "28 forms 1–4 sites" collides with its own §0 / §2d / §3c / §6d at 9 sites

**The conflict.** Plan §3c instructs B3b to "sweep the **28** forms 1–4 sites".
But 9 of those 28 are named elsewhere in the same plan as untouchable or
already-owned:

- 6 are on the §0 do-not-delete list (`sdk-agent-adapter:647`,
  `session-registry.service:157`, `observation-queue.store:130`,
  `skill-synthesis.service:424`, `subagent-registry.service:463`,
  `sdk-permission-handler:1030`)
- 1 more is on §0 **and** §2d's "keep exactly as it is" (`subagent-rpc.handlers:143`)
- 2 are §3c's own explicit exclusion (`hook-session-resolver:32,:35`)
- 1 is a §6d "Untouched" invariant (`sdk-query-options-builder:1164`)
- 1 is already owned by B3a (`skill-candidate.store:605`)

**The team-leader's resolution, applied in the B3b disposition table:**

- **§0 forbids _deleting_ a guard, not refactoring its inner expression.** Six §0
  sites are swept in-place — the guard, its log line and its early return all
  survive, only `!x || x.trim().length === 0` becomes
  `blankToUndefined(x) === undefined`. This is the _point_ of the primitive: the
  rule stops being re-derived while the guard stays exactly as load-bearing.
- **Six sites are hard-excluded**, each because a _different_ normative section
  overrides §3c: `sdk-query-options-builder:1164` (§6d invariant),
  `sdk-permission-handler:1030` (the primitive collapses the tri-state the site
  depends on — `undefined` = "all sessions", `''` = not), `hook-session-resolver:32,:35`
  (§3c's own words: a different rule, do not fold it in),
  `subagent-rpc.handlers:143` (§2d: "exactly as it is"),
  `skill-candidate.store:605` (B3a owns it).
- **Net: 22 sweep sites across 4 libs** — `agent-sdk` 4, `skill-synthesis` 6,
  `memory-curator` 10, `vscode-core` 1, plus `cli-agent-runtime` via the
  `blankToUndefined` rewire. **Still past §3c's own stated threshold of "≥ 8
  production call sites across ≥ 4 libs", so the primitive remains warranted on
  the criterion the plan wrote down in advance.**

**What would change the answer.** If the orchestrator reads §0 as forbidding
_any_ edit to a listed guard (not just deletion), the sweep drops to **16 sites
across 3 libs** — which falls below §3c's 4-lib threshold and would put the
primitive's justification in question. The team-leader does **not** read it that
way: §0's stated rationale is "these sit at boundaries that take a bare `string`
… no batch may **delete** any of them", which is about the guard's existence, not
its spelling. Overrule here if that reading is wrong.

### 2. Batch sizing — one deliberate deviation from the plan's §8, stated for the record

B4 mixes `libs/shared` (backend-owned) with two `chat-streaming` ternary
deletions, so it violates the "never mix backend + frontend in one batch" rule.
**Kept as one batch anyway**, assigned to a single `backend-developer`, because
it is a 6-line contravariant change and splitting it across two developers costs
more coordination than it saves. B3a, which is genuinely two disjoint halves, **is**
split across two specialists. No other sizing in §8 was re-cut.

# Batch 5a (B5a) — Item 6 Part A: prevention. Implementation report

**Status**: COMPLETE. Full gate green — typecheck 19/19, test 18/18 (**10,332 passed
/ 128 skipped / 0 failed**), lint `agent-sdk` 0 errors.

**Scope honoured**: `agent-sdk` only. Zero changes in `skill-synthesis`,
`memory-curator`, `persistence-sqlite`. No SQLite work, no migration, no new DI
token, no new registry, no consumer subscription. Nothing was committed, staged,
stashed or reverted.

---

## 1. Files created / modified

| File                                                                                  | Change                                                                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`      | +115 / −4. The buffer, its three flush paths, and a `timestamp` parameter on `notifyActivity`.                                                |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` | +226. New `describe('first-turn activity identity (TASK_2026_296)')` block, 4 specs; `activityRegistry` added to the shared `AdapterHarness`. |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`                         | 1 line (`:77`, the "Hook session identity" bullet).                                                                                           |

**Zero files created.** Zero specs deleted. `git status` confirms my diff touches
exactly these three paths inside `agent-sdk`; the other three modified `agent-sdk`
files in the tree (`helpers/session-lifecycle/session-registry.service.ts`,
`session-importer.service.ts`, `session-metadata-store.ts`) are B3b's uncommitted
work and I did not touch them.

---

## 2. The design

### 2.1 Where the pending activity is held

A private `Map<string, PendingUserActivity>` field on `SdkAgentAdapter`
(`pendingUserActivity`), **keyed by tabId** — the adapter's own `trackingId`.
`PendingUserActivity` is a two-field module-level interface: `workspaceRoot` and
`timestamp`.

Keying by tabId (not by the reported id) is the load-bearing choice: the tabId is
the one id that exists for the whole window, and it is also the key
`SessionRegistry.byTabId` uses, so a flush can always resolve the record.

The map is empty except during the window between a new session's first prompt and
its system `init` message.

### 2.2 What arms it

`startChatSession` at the former `:507` (now `:526`):

```
if (config.prompt) {
  this.recordPendingUserActivity(trackingId, resolvedProjectPath);   // was: this.notifyActivity(trackingId, 'user', resolvedProjectPath)
}
```

`recordPendingUserActivity` first calls `flushPendingUserActivity(trackingId)` —
a no-op in the common case — so a second `startChatSession` on the same tab without
an intervening teardown publishes the earlier turn instead of silently dropping it
when the slot is overwritten. Today's code emits both (under the tabId); the buffer
must not turn a double-emit into a lost emit.

### 2.3 What flushes it

Three paths, all funnelling through one method:

1. **Resolve (the common case)** — `createSessionIdCallback`, immediately after
   `this.sessionLifecycle.bindRealSessionId(tabId, realSessionId)` (now `:682`),
   inside the existing `if (tabId)` block. The bind is what makes
   `resolveActivityIds` answer with the UUID, so the flush is placed after it and
   before `emitSessionIdResolved`.

   Placement is deliberately **after** the §0 init-callback blank refusal
   (`blankToUndefined(realSessionId) === undefined`, now `:667`) and after the
   `await metadataStore.create(...)`. If either stops the callback, nothing is
   flushed and the buffered turn falls through to path 3 — the tabId. That is the
   consistent answer, because a rejected/failed bind leaves `rec.realSessionId`
   null, so teardown will also resolve to the tabId.

2. **Single-session teardown** — `flushPendingUserActivityFor(sessionId)`, called
   synchronously at the top of `endSession` (`:544`) and `interruptSession`
   (`:773`), **before** delegating to `sessionLifecycle.endSession`. Callers hold
   whichever id they were given, so this resolves the record and flushes by
   `rec?.tabId ?? sessionId`. It early-returns on an empty map, so the common
   (already-flushed) case costs one `size` read.

3. **Bulk teardown** — `flushAllPendingUserActivity()`, called before
   `sessionLifecycle.disposeAllSessions()` at both call sites: the constructor's
   `onConfigChanged` handler (`:167`) and `dispose()` (`:391`).

The synchronous, before-delegation placement of 2 and 3 is the ordering invariant:
the buffered user activity is published **before** any `SessionEnd` notification
can reach a consumer, so state is never armed after its own teardown.

### 2.4 The never-resolves path

Path 3 above, plus path 2. `resolveActivityIds` on an unresolved record returns
`rec.realSessionId ?? sessionId` = the tabId, which is exactly
`session-control.service.ts:126`'s `rec.realSessionId ?? rec.tabId`. So a session
whose id never resolves is **armed under its tabId and torn down under its tabId** —
both ends agree, which is the whole point. Pinned by spec #2.

### 2.5 How exactly-once is guaranteed

Four mechanisms, in order of importance:

- **Delete-before-emit.** `flushPendingUserActivity` reads the entry, deletes it
  from the map, and only then calls `notifyActivity`. `SessionActivityRegistry`
  dispatches synchronously via eventemitter3, so a subscriber that re-enters the
  adapter (e.g. calls `endSession` from its handler) finds an empty slot. Emission
  is idempotent by construction, not by discipline.
- **One emitter.** All three flush paths call the same private method; there is no
  second place that can publish a buffered activity.
- **No correction/retraction event.** The activity is published once, with its
  original `role`, `workspaceRoot` and `timestamp` — buffering changes _only_ the
  id. This is why `notifyActivity` gained a `timestamp: number = Date.now()`
  parameter rather than the flush stamping "now": consumers see the moment the user
  acted, so the buffer is invisible to them except on the axis being fixed.
- **Flush-before-overwrite** in `recordPendingUserActivity` (§2.2) — the
  once-per-recorded-activity half of the guarantee.

Spec #1 asserts `published` has length 1 after resolve _and_ still 1 after
`SessionEnd`.

### 2.6 What was NOT built

No `LIKE 'tab\_%'` predicate, no id-shape inspection, no "detect a tabId and swap
it" anywhere. A tabId is a UUID v4 (`TabId.create()`), so `SessionId.validate(tabId)`
is true and canonicalisation by inspection is unimplementable. The fix is entirely
at the emitter.

---

## 3. Explicit reasoning on the sites I did NOT change

### 3.1 The resume path (`:608` / `:611`, now `:628` / `:631`) — **no treatment needed**

Two independent reasons, both verified at the tree:

1. **There is no pre-init `notifyActivity` on the resume path at all.**
   `resumeSession` goes straight from `executeQuery` to `streamTransformer.transform`;
   the only activity it produces is `wrapResultStatsForActivity(...)` (role
   `assistant`, fired on the SDK `result` message, i.e. after `init`). There is
   nothing to buffer.
2. **The id it would report is already canonical.** For a resume,
   `SessionQueryExecutor.executeQuery` computes
   `knownRealSessionId = resumeSessionId ? sessionId : undefined` and passes it into
   `registry.register(...)`, which does `bySessionId.set(realSessionId, rec)`
   **at registration time** (`session-registry.service.ts`, `register`). So
   `resolveActivityIds(uuid)` resolves the record and returns the UUID from the
   first instant — `realSessionId` is never null on this path.

Adding a buffer here would introduce a window that does not exist. The
`resumeCallback` at `:628`/`:631` is left byte-identical.

_(Recorded, out of scope, no defect on the item-6 axis: on the resume path the
adapter is given the real UUID while the record is registered under `registerKey =
tabId`, so between registration and `bindRealSessionId` a `find(uuid)` hit comes
from `bySessionId` — which register populated — and therefore works. The id is
always right. I mention it only because I traced it.)_

### 3.2 `notifyActivity(sessionId, 'user')` at `:694` / `:729` (now `:718` / `:753`) — **not buffered**

These are `sendMessageToSession` (follow-up turn) and `executeSlashCommand`. Both
require a session that already exists, and in every realistic ordering the SDK
`init` has landed, so `resolveActivityIds` returns the UUID. They are not the
observed defect.

I could not _demonstrate_ they hit the pre-resolve state, so per the brief I left
them alone — but I will not claim they are unreachable. They are **theoretically**
reachable: a caller that sends a second message in the sub-second gap between the
first prompt and `init` would find `rec.realSessionId === null` and emit the tabId.
Two reasons not to extend Part A to them:

- Buffering them requires a **queue** (N pending activities per tab), not a slot,
  because unlike the first-turn case there is no bound on how many can stack. That
  is materially more machinery than Part A's shape, and it would delay legitimate
  post-init activity in the overwhelmingly common case — pure downside.
- This is precisely the "residual" B5b's rekey exists for: state armed under a
  tabId by a path Part A does not cover is migrated when the id resolves. Part A
  closes the dominant emitter; Part B closes the tail.

**Recorded as a follow-up for B5b's brief**: the `:718` / `:753` call sites are a
second, narrower instance of the same window and should be listed among the paths
the rekey must cover.

### 3.3 `teammateIdle` — left subscriber-less and undeleted

`sdk-adapter-events.service.ts` still declares it (`:92`), emits it (`:136`) and
exposes `onTeammateIdle` (`:194-195`). I did not subscribe to it, did not treat it
as a consumer, and did not delete it. It is confirmed intentional aspirational
surface with a documented reason for having no subscriber.

---

## 4. Diff audit against the §6d invariant table

`git status --porcelain` shows my changes touch three files. Four of the six
invariants live in files I did not open for writing at all; the other two I
verified line by line.

| #   | Invariant                                                            | Location (verified now)                                                   | Status                                                                                                                      |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `const trackingId = tabId as SessionId;`                             | `sdk-agent-adapter.ts:480` (was `:461`; shifted by my +19 lines above it) | **UNTOUCHED.** `git diff` on the file contains no hunk matching `trackingId as SessionId`; the statement is byte-identical. |
| 2   | `const registerKey = sessionConfig?.tabId ?? (sessionId as string);` | `session-query-executor.service.ts:118`                                   | **UNTOUCHED.** File not modified.                                                                                           |
| 3   | MCP URL routing segment; a missing id throws `SdkError`              | `sdk-query-options-builder.ts:1153-1184`                                  | **UNTOUCHED.** File not modified.                                                                                           |
| 4   | `extractCallerSessionId` parses `[^/?]+`                             | `vscode-lm-tools/.../http-server.handler.ts:141-149`                      | **UNTOUCHED.** File not modified.                                                                                           |
| 5   | `resolveHookSessionId` returns `null`, never `''`                    | `agent-sdk/.../hook-session-resolver.ts`                                  | **UNTOUCHED.** File not modified.                                                                                           |
| 6   | `IAgentAdapter.setSessionIdResolvedCallback`                         | `libs/shared/.../agent-adapter.types.ts:253`                              | **UNTOUCHED.** File not modified; still exact at `:253`.                                                                    |

Additional §0 / §6f checks:

- **`SdkAgentAdapter` init-callback blank refusal** (§0) — surviving verbatim at
  `:667`, `blankToUndefined(realSessionId) === undefined` with its log and early
  return intact. My flush is placed _after_ it, so it strengthens rather than
  bypasses the guard, and spec #3 pins that a blank init id publishes nothing.
- **`SessionRegistry.bindRealSessionId` blank refusal** (§0) — not modified by me.
- The single-slot `setSessionIdResolvedCallback` / `SdkAdapterCallbackRegistry` and
  `cli-agent-runtime/wiring/sdk-callbacks.ts` — untouched; nothing added alongside
  (that is B5b).
- `agent-monitor.store.ts` — not opened. Not split, not touched (plan §7).

---

## 5. `CLAUDE.md:77` — exact before / after

Only the **mechanism** clause changed. The `resolveHookSessionId` rule that opens
the bullet, the TASK_2026_293 / TASK_2026_295 narrative, and the closing
"The resolver returns `null`, never `''`…" sentence are all preserved. The
`registerKey` and "MCP caller identity" bullets were not edited.

**BEFORE** (the removed clause, verbatim):

> `SdkQueryOptionsBuilder.createHooks` captures `sessionId ?? ''`, and for a NEW session that id does not exist yet — it arrives later in the system `init` message — so the closure holds `''` for the whole query. PreCompact skipped the resolve and fanned `''` to the memory curator, whose transcript reader rejected it as path traversal and curated a placeholder instead of the conversation (TASK_2026_293).

**AFTER** (verbatim):

> `SdkQueryOptionsBuilder.createHooks` captures whatever `SessionQueryExecutor` handed it as `sessionId` — the `?? ''` coercion this rule was first written against is gone, and both signatures now model absence (`createHooks(cwd: string, sessionId?: string, …)` → `CompactionHookHandler.createHooks(sessionId: string \| undefined, …)`). For a NEW session the captured id is the **tabId**, not the SDK UUID, which arrives later in the system `init` message: the closure holds a real but non-canonical id for the whole query, and since a tabId is itself a UUID v4 no handler can tell the two apart by inspection (TASK_2026_296). That is why the payload comes first. PreCompact skipped the resolve entirely and fanned the unresolved id to the memory curator, whose transcript reader rejected it as path traversal and curated a placeholder instead of the conversation (TASK_2026_293).

### 🚨 The plan's Correction 2 is itself wrong, and I did not copy it

`implementation-plan.md` §6a Correction 2, `tasks.md` Task 5a.2, and my own brief
all state: **"The closure holds `undefined`."** Traced at the tree, it does not.

- `sdk-query-options-builder.ts:1226-1232` — `private createHooks(cwd: string, sessionId?: string, …)` ✅ (signature as documented)
- `compaction-hook-handler.ts:126-128` — `createHooks(sessionId: string | undefined, cwd: string | null, …)` ✅
- **But the only call site is `:671`, `this.createHooks(cwd, sessionId, …)`,** where
  `sessionId` came from `SdkQueryOptionsBuilder.build({ …, sessionId })`, fed by
  `session-query-executor.service.ts:244` as **`sessionId: sessionId as string`** —
  always present, never `undefined`. For a NEW session that value is `trackingId`,
  i.e. **the tabId**. `createHooks` is `private` and has exactly one caller, so
  `undefined` is unreachable.

The plan inferred the runtime value from the widened _type_. That is the §0 error in
mirror image: **`?: string` does not mean the value is `undefined`, just as it does
not make `''` unrepresentable.** Writing "the closure holds `undefined`" into the
doc would have been a fresh, wrong claim replacing a stale one — and it would have
hidden the fact that the closure carries a _tabId_, which is the exact defect
item 6 is about. The corrected text says what is true and makes the bullet
reinforce item 6 instead of contradicting it.

This is the third "confident correction" in this task's documents to be wrong on a
factual point (after the `memory.ts:45` off-by-one and the `branded.types.spec.ts:96`
claim). **Recommend `implementation-plan.md` §6a Correction 2 and `tasks.md` Task
5a.2 be annotated**, so B5b's developer does not re-apply the `undefined` claim.

---

## 6. The Part A specs (Task 5a.3)

Added to the existing `sdk-agent-adapter.spec.ts` (the nearest existing activity-path
spec — the file already constructs a real `SessionActivityRegistry`; I exposed it on
the shared `AdapterHarness`, an additive change no existing test reads).

Two fakes, both faithful to the real contracts they stand in for:

- `wireFakeRegistry` — backs `sessionLifecycle.find` / `bindRealSessionId` /
  `endSession` with two Maps. `find` resolves by either id, `bindRealSessionId` is
  set-once, and `endSession` reports its teardown id as **`realSessionId ?? tabId`**,
  mirroring `session-control.service.ts:126`. The teardown rule under test is the
  real one, not an assumption.
- `makeTriggerConsumer` — stands in for `MemoryTriggerService` /
  `SkillTriggerService`, both of which key their `sessions` map (and its idle timer)
  by the activity payload's id and clear it by the `SessionEnd` id. `agent-sdk` must
  not import either lib, so the contract is modelled in-spec rather than reached for;
  the comment says so.

| #   | Spec                                                                                                | Asserts                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `publishes the first turn once under the SDK UUID, never under the tabId, and SessionEnd clears it` | Nothing is published during the window; after `init` exactly one payload, `{ sessionId: REAL_ID, role: 'user' }`; the consumer holds exactly one armed entry and it is **not** the tabId; after `endSession` the published count is **still 1** (no double-emit) and the teardown id is `REAL_ID`, which clears the entry. **This is §6e spec 1.** |
| 2   | `publishes under the tabId when the session ends without ever resolving`                            | **The paired-isolation sibling (Wave 1 rule).** No `init` ever arrives; teardown publishes `{ sessionId: TAB_ID, role: 'user' }`, the teardown id is `TAB_ID`, and it clears the entry. Both ends on the same key.                                                                                                                                 |
| 3   | `does not publish on a blank SDK init id, and still flushes under the tabId at teardown`            | The §0 init-callback blank refusal stops before the bind (`bindRealSessionId` not called), nothing is published under a blank id, and the buffered turn still reaches the consumer under the tabId at teardown. Pins the buffer's interaction with a §0 guard.                                                                                     |
| 4   | `publishes nothing for a session started without a prompt`                                          | The `if (config.prompt)` condition is preserved — buffering did not start emitting activity for prompt-less starts.                                                                                                                                                                                                                                |

Both ids in the specs are real UUID v4 strings, not `tab_N` — the legacy format is
rejected at the chat RPC boundary and using it would have made the specs pass for
the wrong reason (a shape a consumer could detect).

Verified these four actually execute:
`nx run agent-sdk:test --skip-nx-cache --testPathPatterns=sdk-agent-adapter.spec -t "TASK_2026_296"` →
**4 passed, 35 skipped, 39 total, 1 suite.**

---

## 7. Verification — raw numbers

### Typecheck

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core
```

**`NX Successfully ran target typecheck for 19 projects`** — 19/19, 0 errors.

### Test

```
npx nx run-many -t test -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core
```

**`NX Successfully ran target test for 18 projects`**

**TOTAL: 10,332 passed · 128 skipped · 0 failed · 18 projects.**

| Baseline (post-B3b) | 10,328 passed / 128 skipped / 0 failed |
| ------------------- | -------------------------------------- |
| B5a adds            | +4 (the four new specs)                |
| Expected            | 10,332 / 128 / 0                       |
| **Measured**        | **10,332 / 128 / 0** ✅ exact          |

Nothing dropped; skipped count unchanged at 128. Per-project totals: 1093, 365, 530,
1017 (`agent-sdk`), 241, 402, 327+57sk, 805, 21, 1295+37sk, 329+1sk, 2401+31sk, 112,
845+2sk, 36, 333, 37, 143.

**Flakes: none observed.** Neither of the two known parallel-load flakes
(`chat:test`, `rpc-handlers:test`) fired — `rpc-handlers` reported 2401 passed / 31
skipped and `chat` 1295 passed / 37 skipped on the first attempt, in the full
parallel run. No `--skip-nx-cache` rerun was needed. The whole test gate was run
twice (once to confirm green, once to tally per-project numbers) and was green both
times.

### Lint

```
npx nx run-many -t lint -p agent-sdk
```

**`NX Successfully ran target lint for project @ptah-extension/agent-sdk`** —
**38 problems (0 errors, 38 warnings)**, all pre-existing:

- 37 × `@typescript-eslint/no-non-null-assertion` — all in files I did not touch.
- 1 × `max-lines` on `sdk-agent-adapter.ts`: "File has too many lines (891).
  Maximum allowed is 700." **Pre-existing** — `git show HEAD:` on that file is
  **880 lines**, already over the 700 soft ceiling before this batch. My +115/−4
  takes it 882 → 891. Deliberately **not** split: plan §7 forbids opportunistic
  refactoring in this task, and the added code is one cohesive concern (~55 lines of
  it JSDoc explaining the invariant). See §9 for the follow-up.

`memory-contracts` is not in this batch's touched set, so the
`@ptah-extension/memory-contracts:eslint:lint` special case did not apply.

`libs/frontend/core` coverage floor (statements 85% / lines 85%): `core:test`
passed at 143/143 with no threshold change. **No threshold was lowered anywhere.**

---

## 8. Line-number drift found between the docs and the tree

The brief's re-derived table was correct on every entry I checked. One new
discrepancy, and the post-B5a positions for B5b's benefit:

| What                                                    | Plan / `tasks.md` | Brief's re-derivation | Verified pre-B5a                     | **After B5a**                            |
| ------------------------------------------------------- | ----------------- | --------------------- | ------------------------------------ | ---------------------------------------- |
| `notifyActivity(trackingId, 'user', …)` — the window    | `:506`            | `:507`                | `:507` ✅                            | `:526` (now `recordPendingUserActivity`) |
| `trackingId = tabId as SessionId`                       | `:460`            | `:461`                | `:461` ✅                            | **`:480`**                               |
| `streamTransformer.transform({` (first-prompt)          | `:509`            | `:510`                | `:510` ✅                            | `:529`                                   |
| `private createSessionIdCallback(`                      | `:637`            | `:633`                | `:633` ✅                            | `:653`                                   |
| `bindRealSessionId` (new-session callback)              | `:661`            | `:662`                | `:662` ✅                            | `:682`                                   |
| `emitSessionIdResolved` (new-session callback)          | `:664`            | `:665`                | `:665` ✅                            | `:689`                                   |
| resume `bindRealSessionId` / `emitSessionIdResolved`    | `:610`            | `:608` / `:611`       | `:608` / `:611` ✅                   | `:628` / `:631`                          |
| `private resolveActivityIds(`                           | `:827-835`        | `:828`                | `:828` ✅                            | `:853`                                   |
| `private notifyActivity(`                               | —                 | `:838`                | `:838` ✅                            | `:863`                                   |
| later `notifyActivity(sessionId, 'user')` ×2            | —                 | `:694` / `:729`       | `:694` / `:729` ✅                   | `:718` / `:753`                          |
| §0 init-callback blank refusal                          | `:647`            | —                     | `:648` (B3b `blankToUndefined` form) | `:667`                                   |
| `session-control.service.ts` teardown id                | `:126` / `:212`   | `:126` / `:212`       | ✅ both exact                        | unchanged                                |
| `session-query-executor.service.ts` `registerKey`       | `:118`            | `:118`                | ✅ exact                             | unchanged                                |
| `agent-adapter.types.ts` `setSessionIdResolvedCallback` | `:253`            | `:253`                | ✅ exact                             | unchanged                                |

**New drift**, not a line number but a fact — see §5: the plan's claim that the hook
closure "holds `undefined`" is wrong at the tree; it holds the **tabId**. Documented
in the corrected `CLAUDE.md` bullet and flagged here for annotation.

---

## 9. Deliberately left alone — follow-ups

1. **`sdk-agent-adapter.ts` is 891 lines** against the 700-line soft ceiling
   (warn-level). It was already 880 at HEAD, so this batch did not create the
   condition, and plan §7 forbids opportunistic splitting. If it is ever split, the
   facade rule applies: `SdkAgentAdapter` keeps its name, DI token and method
   signatures, and the activity concern (`resolveActivityIds`, `notifyActivity`,
   the buffer and its three flush paths — ~110 lines, a nameable single concern,
   e.g. `SessionActivityPublisher`) becomes an injected collaborator. Recorded, not
   done.
2. **`:718` / `:753` (`sendMessageToSession`, `executeSlashCommand`)** — the
   narrower second instance of the same window (§3.2). Should be named in B5b's
   brief as a path the rekey must cover.
3. **`implementation-plan.md` §6a Correction 2 and `tasks.md` Task 5a.2** should be
   annotated with §5's finding before B5b starts, so its developer does not reassert
   "the closure holds `undefined`".
4. **`agent-monitor.store.ts` (~1,610 lines)** — not opened, not split (plan §7).
5. Not touched by this batch and still outstanding from earlier batches: the 9
   `?? undefined` no-ops (census §Latent) and `agent-card.component.ts:229-236`
   swallowing its RPC result.

---

## 10. Standing-rules compliance

| Rule                                                                          | Status                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No §0 guard deleted; none deleted on "the type prevents it" grounds           | ✅ The init-callback blank refusal is intact at `:667` and now has a spec asserting the buffer respects it. |
| Every line number spot-checked before editing                                 | ✅ All 14 in §8, read at the tree first. Found one factual error in the docs (§5).                          |
| Zero specs deleted                                                            | ✅ +226 lines added to `sdk-agent-adapter.spec.ts`; no removals.                                            |
| Every "must reject" assertion has a legitimate-path sibling                   | ✅ Spec #2 is the paired-isolation sibling for #1; spec #4 is the sibling for #3.                           |
| No git commits / staging / stashing / reverting                               | ✅ Only read-only `git status` / `git diff --stat` / `git show HEAD:` were run.                             |
| No stubs, placeholders, TODOs, hardcoded mock data                            | ✅                                                                                                          |
| No opportunistic refactoring or file splitting                                | ✅ Recorded in §9 instead.                                                                                  |
| Stayed out of `apps/ptah-cli` and `rpc-handlers/src/index.ts` (TASK_2026_297) | ✅ Neither opened.                                                                                          |

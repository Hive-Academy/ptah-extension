# Implementation Plan — TASK_2026_296

> Architecture specification. Component specs, evidence, and quality requirements.
> The team-leader owns decomposition into atomic tasks (`tasks.md`).
>
> Every line/file reference below was read live at the current commit
> (`1363f486b` + working tree). Where this plan contradicts `context.md` or
> `item-6-consumer-audit.md`, the contradiction is called out explicitly with the
> evidence that produced it.

---

## 0. The constraint that governs every item

**`?: string` does NOT make `''` unrepresentable. `''` is a `string`.**

Wave 2 was briefed on the wrong premise and its implementing agent corrected it
(`../TASK_2026_295/context.md` "The premise of this wave was wrong"). Widening a
field removes the **forcing function** — the reason a producer had to invent a
value for a field it could not fill. It does not remove the value.

### Do-not-delete list (repo-wide, applies to all six items)

These read as "defensive code the type makes impossible". The type does **not**
make them impossible. They sit at boundaries that take a bare `string`, read off
the wire, or read out of SQLite. **No batch in this task may delete any of them**,
and no reviewer may request their deletion on the grounds that "the type prevents
it":

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

---

## 1. The third declaration, and its port twin

### Verdict — the brief asks for four changes; the evidence supports ONE

`context.md` §1 asks to widen `MemoryExtractedPayload.sessionId` and the
`ICompactionCallbackRegistry` port. The orchestrator additionally asked me to
rule on `memory.ts:31` and `:55`. **Ruling: widen `:46` only. Do not touch `:31`,
`:55`, or the port.** Each rejection is evidence-backed below.

Corrected path (context.md says `.../ports/...`, which does not exist):
`libs/backend/memory-contracts/src/lib/compaction-callback.port.ts:4`.

#### 1a. `MemoryExtractedPayload.sessionId` (`libs/shared/src/lib/types/messages/memory.ts:46`) — **WIDEN**

**Evidence for the forcing function.** The producing event declares the field
optional:

- `libs/backend/memory-curator/src/lib/diagnostics.types.ts:26` — `readonly sessionId?: string;`

Two producers therefore coerce:

- `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.ts:46` — `sessionId: ev.sessionId ?? '',`
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:190` — `sessionId: ev.sessionId ?? '',`

This is the textbook forcing function: optional source → required target →
invented value. Identical in shape to the two declarations Wave 2 widened.

**Change shape.** `readonly sessionId?: string;` at `memory.ts:46`. Delete both
`?? ''`, pass `ev.sessionId` directly.

**Expected compile fallout: ZERO outside the two producer files.**

Evidence — `MESSAGE_TYPES.MEMORY_EXTRACTED` has **no consumer anywhere in the
repo**. Grep for `MEMORY_EXTRACTED|memory:extracted` across all `*.ts` returns
only: the constant (`message-constants.ts:179`), the payload-map entry
(`payload-map.ts:315`), the two producers, and one backend spec
(`boot-thoth-runtime.spec.ts:143,173`). `libs/frontend` and
`apps/ptah-extension-webview` have **zero** matches. So widening cannot break a
reader, because there are none.

**Consuming libs to typecheck anyway:** `shared`, `cli-engine`, `thoth-runtime`,
`memory-curator`.

**Spec that pins the new behaviour.** Extend
`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts` (existing block
at `:143`): assert that a `curator-run` event with `sessionId: undefined`
broadcasts a payload whose `sessionId` is **`undefined`, not `''`**. Add the
mirror assertion in a cli-engine spec for `wire-thoth-push-bridges.ts:46`.

#### 1b. `MemoryObservationCapturedPayload.sessionId` (`memory.ts:31`) — **DO NOT WIDEN**

**Reason: the non-blank guarantee is real and enforced at the producer.**

- The wire payload is a **verbatim pass-through** of `ObservationCaptureEvent`
  (`wire-thoth-push-bridges.ts:69-74`, `boot-thoth-runtime.ts:203-208` both pass
  `evt` unchanged). The store's own comment at `observation-queue.store.ts:48-50`
  says it is "designed to be broadcast ... without any further mapping".
- `ObservationCaptureEvent.sessionId` is `readonly sessionId: string`
  (`observation-queue.store.ts:53`) — required, and correctly so.
- `ObservationQueueStore.insert` **refuses a blank sessionId before inserting**
  (`:130-136`), and `emitCapture` only fires after a successful insert. The
  refusal is documented at `:119-128` (un-drainable, un-reapable rows).

There is **no `?? ''`** on this path and **no forcing function**. Widening would
weaken a guarantee that is actually held and would oblige every future consumer
to handle an absence that cannot occur — the opposite of this task's goal.

#### 1c. `MemorySessionStartInjectedPayload.sessionId` (`memory.ts:55`) — **DO NOT WIDEN**

**Reason: the channel is dead. It has zero producers and zero consumers.**

`MESSAGE_TYPES.MEMORY_SESSION_START_INJECTED` (`message-constants.ts:181`) is
referenced **only** by its own declaration and the payload-map entry
(`payload-map.ts:316`). Nothing broadcasts it; nothing handles it. Widening a
type nobody constructs is churn with no defect behind it.

**Do not delete it either.** `libs/shared/CLAUDE.md` guideline 5 makes the
message protocol append-only, and the `memory.ts:13` header documents the
intended channel. Record it as unwired surface (see §7 Risk) and leave it.

#### 1d. `ICompactionCallbackRegistry` port (`compaction-callback.port.ts:4`) — **DO NOT WIDEN**

**This directly contradicts `context.md` §1 and the Wave 1 note in
`../TASK_2026_295/context.md`. Both are now stale — Wave 1 fixed the producer.**

The claim was: "the port permits precisely what `MemoryCuratorService` now has to
tolerate at runtime." That is no longer true.

- The port's **sole notifier** is `CompactionCallbackRegistry.notifyAll`
  (`libs/backend/agent-sdk/src/lib/helpers/compaction-callback-registry.ts:49`).
- Its **sole caller** is `CompactionHookHandler`
  (`compaction-hook-handler.ts:210-218`), which at `:177-192` resolves via
  `resolveHookSessionId` and **returns early on `null`** before ever reaching
  `notifyAll`. The comment at `:183-186` states exactly why.
- `agent-sdk/CLAUDE.md` "Hook session identity" pins this as a binding rule: a
  handler "MUST NOT publish the result until it has rejected `null`".

So `sessionId: string` on the port is a guarantee that **is** held. Widening it
would force `MemoryCuratorService.start()`
(`memory-curator.service.ts:93-120`, which uses `data.sessionId` at `:100`,
`:104`, `:112`, `:114`, `:117`) to grow an absence branch for a case its only
producer already rejects — dead defensive code, and a weakening of a documented
invariant.

**Instead, make the guarantee explicit at ~zero cost:** add a doc comment to
`compaction-callback.port.ts` stating that `sessionId` is guaranteed non-blank by
`CompactionHookHandler`'s null rejection, citing
`compaction-hook-handler.ts:182-192`. Confirm `compaction-hook-handler.spec.ts`
already pins the rejection; if it does not, add that assertion. This converts an
incidental guarantee into a documented + pinned one, which is what the Wave 1
note actually wanted.

### Item 1 do-not-touch list

- `observation-queue.store.ts:130` blank refusal — the reason `:31` stays required.
- `compaction-hook-handler.ts:182-192` null rejection — the reason the port stays required.
- `memory.ts:31`, `memory.ts:55`, `compaction-callback.port.ts:4` — all three stay as-is.
- `memory-curator.service.ts:243` — `${input.workspaceRoot ?? ''}::${sessionId}`. This coerces **workspaceRoot**, not a session id. Out of scope for the acceptance criterion; do not "fix" it.

---

## 2. Zod at the two unvalidated entry points

### 2a. The webview-error trace the brief demanded — answer: **no frontend change is required**

The brief cautioned that boundary rejection replaces a silent degrade and asked
whether the frontend would surface an unhandled rejection or a dead tile. Traced
end to end:

**Backend transport never propagates.**
`libs/backend/vscode-core/src/messaging/rpc-handler.ts:166-215` (`handleMessage`)
wraps every handler call in `try/catch` and returns an envelope
`{ success: false, error: errorObj.message, correlationId }` at `:209-213`. A
thrown `ZodError` becomes a response, never a rejection.

**Frontend client never rejects.**
`libs/frontend/core/src/lib/services/claude-rpc.service.ts:130-146` — `call()`
returns `Promise<RpcResult<...>>` constructed as `new Promise((resolve) => ...)`.
There is no `reject` path; even the abort case _resolves_ with a failed
`RpcResult` (`:138-144`).

**Therefore an unhandled rejection is structurally impossible at both call
sites.** This is already the documented contract — `chat-rpc.schema.ts:15-18`
spells it out for the sibling schemas: "On refine failure the global RPC
dispatcher ... catches the ZodError and returns a `{ success: false, error }`
response to the webview — no crash propagates to the host process or to Sentry."

**Per-call-site behaviour on a failed envelope:**

| Call site                                                                                    | Handling                                                                                  | Verdict                                               |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1329-1343`                      | Checks `!result.isSuccess()` → returns `{ ok: false, error: result.error }` to its caller | **Correct already.** A Zod message surfaces verbatim. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:229-236` | `await` inside `try/finally`, **result discarded**                                        | Silent no-op; spinner clears, nothing happens.        |
| `chat:subagent-query` via `claude-rpc.service.ts:385` (`querySubagents`)                     | Calls with **`{}` — no params at all**                                                    | Cannot produce malformed input from the app.          |

`agent-card.component.ts` is a **pre-existing** gap: it already swallows every
backend failure identically today (`agent:stop` at `:215` does the same). Item 2
does not create it and does not widen it. **Recommendation: out of scope for this
task**; record it for a follow-up. Including it would mix a UX change into a
validation batch, and the acceptance criteria do not ask for it.

### 2b. Dual-registration — **already satisfied for both**

- Compile-time: `libs/shared/src/lib/types/rpc.types.ts:1071` (`agent:resumeCliSession`) and `:894` (`chat:subagent-query`); allowlist entries at `:3383` and `:3350`.
- Runtime: `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:40-86`) contains `'agent:'` at `:61` and `'chat:'` at `:42`.

**No dual-registration work is required.** Do not add entries; do not "fix" the
manifest.

### 2c. `agent:resumeCliSession` — `.min(1)` IS appropriate

Handler: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:742-815`.
Registered at `:753` with an inline TS param type (`:744-751`) and zero runtime
validation.

There is no deliberate "empty means something" rule on this method — the caller
already refuses a missing id before calling
(`agent-monitor.store.ts:1325-1327`, `agent-card.component.ts:225`). Empty is
simply invalid.

**New file** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts`
(the namespace has no schema file today), following the
`chat-rpc.schema.ts` house pattern including `.passthrough()`:

- `cliSessionId`: `z.string().min(1)`
- `cli`: enum over `CliType`
- `task`: `z.string().min(1)`
- `parentSessionId`: `z.string().min(1).optional()`
- `ptahCliId`, `previousAgentId`: `z.string().min(1).optional()`

**Parse placement: INSIDE the existing `try`** (`:754`). The handler's own catch
at `:805-813` returns `{ success: false, error: errorMessage }`, which is exactly
the shape `agent-monitor.store.ts:1341-1343` already reads, and the Zod message
reaches the user. Parsing outside the try would route through the transport
catch to the same envelope shape — equivalent, but the in-try placement keeps the
handler's own logging (`:808-811`) in the path. Either is defensible; specify
in-try so two developers do not choose differently.

**Do NOT use `.strict()`.** The frontend sends exactly the six declared keys
today, but `chat-rpc.schema.ts:20-24` establishes `.passthrough()` as the house
rule precisely so an outdated webview sending an extra field is not rejected.

### 2d. `chat:subagent-query` — `.min(1)` is **WRONG** here; Zod validates shape, the existing guard keeps semantics

Handler: `subagent-rpc.handlers.ts:123-174`. Schema file already exists and
explains its own absence at `subagent-rpc.schema.ts:1-9`.

**The critical asymmetry.** This method has a _deliberate, documented_ answer for
a present-but-empty `sessionId`, added by Wave 1 at
`subagent-rpc.handlers.ts:138-148`:

> "A sessionId that is present but empty is a scoped query whose scope cannot be
> resolved — answer with nothing. Falling through to the unscoped branch offered
> this session the chance to resume another session's interrupted subagents."

A `z.string().min(1).optional()` would convert that deliberate _empty result_
into an _error_, changing a behaviour Wave 1 chose on purpose. Worse, if a
developer instead writes a schema that normalizes `''` → `undefined`, the query
falls through to the **unscoped** branch at `:156` — restoring exactly the
cross-session leak Wave 1 fixed.

**Therefore:**

- Add `SubagentQuerySchema` to the existing `subagent-rpc.schema.ts`:
  `z.object({ toolCallId: z.string().optional(), sessionId: z.string().optional() }).passthrough()`
  — **no `.min(1)`, no `.transform()`, no `.trim()`**.
- Zod's job here is **shape only**: reject non-string / non-object params.
- **Keep the `sessionId === ''` branch at `:142-148` exactly as it is.** It is on
  the §0 do-not-delete list. It owns the semantics.
- Update the file header comment at `subagent-rpc.schema.ts:3-5` — it currently
  documents the absence of a schema for this method.

**Parse placement: INSIDE the existing `try`** (`:127`). The catch at `:161-171`
returns `{ subagents: [] }` and captures to Sentry. Note this means a malformed
param yields an empty list plus a Sentry event — acceptable, because the only
in-app caller sends `{}`.

### 2e. Specs that pin the new behaviour (required by acceptance criteria)

In `agent-rpc.handlers.spec.ts` (new block) and `subagent-rpc.handlers.spec.ts`:

1. `agent:resumeCliSession` with `cliSessionId: ''` → `{ success: false }`, error names the field; `agentProcessManager.spawn` **not** called.
2. `agent:resumeCliSession` with `parentSessionId: ''` → rejected; with `parentSessionId` absent → **succeeds** (the paired-isolation rule from Wave 1: every "must reject" assertion needs a sibling proving the legitimate path still works).
3. `chat:subagent-query` with `sessionId: ''` → `{ subagents: [] }` and `getResumable()` (unscoped) **not** called. This is the regression guard for the fall-through leak.
4. `chat:subagent-query` with `{}` → returns all resumable (unchanged).
5. `chat:subagent-query` with `sessionId: 123` (wrong type) → does not throw out of the handler.

### Item 2 do-not-touch list

- `subagent-rpc.handlers.ts:142-148` — the `''` branch. Not dead; it is the rule.
- `agent-card.component.ts:229-236` — do not add error handling in this task.
- `ALLOWED_METHOD_PREFIXES`, `rpc.types.ts`, `RPC_HANDLER_MANIFEST` — already correct.
- The five existing schemas in `subagent-rpc.schema.ts:13-52` — their `.min(1)` is correct for _their_ methods, which have no "empty means empty result" rule.

---

## 3. Blank-id census, and the primitive decision

### 3a. The census

The full census is persisted alongside this plan and must not be re-derived:
**`.ptah/specs/TASK_2026_296/item-3-blank-id-census.md`** (produced by a
dedicated investigation sweep at the current commit; every `?? ''` / `|| ''` in
`libs/**` was enumerated, 707 occurrences triaged, ~835 skipped as unrelated).

**Headline numbers:**

| Metric                                  | Count                                                    |
| --------------------------------------- | -------------------------------------------------------- |
| Distinct production files               | **79** (49 backend, 30 frontend, **0 in `libs/shared`**) |
| Production hit sites                    | **138**                                                  |
| Independent implementations of the rule | **5**                                                    |
| Distinct return conventions             | **3** (`undefined`, `null`, `boolean`)                   |
| Distinct trim policies                  | **4**                                                    |

**Per form (production):** F1 `!x \|\| x.trim().length===0` = 4 · **F1-variant
`!x \|\| x.length===0` (no trim) = 13** · F2 `x!==undefined && x.trim().length===0`
= 1 · F3 bare `x.trim().length===0` = 2 · **F3-variant bare `x.length===0` /
`x.length>0` = 6** · F4 bare `x===''` = 2 · **F5 bare `!x` = 97** · F6
`x?x:undefined` / `x||undefined` = 6 · F7 `blankToUndefined` = 1 def + 4 calls ·
F8 `sessionIdOrNull` = 1 def + 1 call.

**The five implementations, and how they disagree** (this is the finding that
drives 3c, not the raw count):

| Impl                  | Location                                                  | Trim?                                | Returns     | `'   '` is… |
| --------------------- | --------------------------------------------------------- | ------------------------------------ | ----------- | ----------- |
| `blankToUndefined`    | `cli-agent-runtime/.../ptah-cli-registry.utils.ts:41`     | yes, **returns trimmed**             | `undefined` | absent      |
| `sessionIdOrNull`     | `memory-curator/.../memory.store.ts:140` (module-private) | tests trimmed, **returns untrimmed** | `null`      | absent      |
| `knownSessionId`      | `chat-streaming/.../session-scope.ts:25`                  | **no**                               | `undefined` | **present** |
| `resolveFirstPresent` | `agent-sdk/.../hook-session-resolver.ts:28`               | **no**                               | `null`      | **present** |
| inline                | `skill-synthesis/.../skill-candidate.store.ts:605`        | yes                                  | `null`      | absent      |

**A whitespace-only session id is "absent" to three of them and "a valid id" to
two.** That is a latent defect, not a style inconsistency.

**Two structural findings:**

- **No helper crosses a lib boundary.** `blankToUndefined` is not on its lib barrel; `sessionIdOrNull` is module-private. `libs/shared` — the one lib every other may import, and the owner of branded `SessionId` — has **no** blankness primitive at all.
- **The conventions round-trip inside a single function.** `ptah-cli-spawn-options.service.ts:179` normalizes with `blankToUndefined`, then `:205` re-emits `''`. Same for `skill-candidate.store.ts:604` → `:605`.

**Acceptance-criterion surface — all 6 production `?? ''` / `|| ''` onto a
session-id field:**

| #   | File                                                                   | Line | Expression                                        | Disposition                          |
| --- | ---------------------------------------------------------------------- | ---- | ------------------------------------------------- | ------------------------------------ |
| 1   | `libs/backend/thoth-runtime/.../boot-thoth-runtime.ts`                 | 190  | `sessionId: ev.sessionId ?? ''`                   | **Item 1 (B1)**                      |
| 2   | `libs/backend/cli-engine/.../wire-thoth-push-bridges.ts`               | 46   | `sessionId: ev.sessionId ?? ''`                   | **Item 1 (B1)**                      |
| 3   | `libs/backend/cli-agent-runtime/.../ptah-cli-spawn-options.service.ts` | 205  | `ownSessionId ?? ''`                              | **Item 3 (B3) — vestigial, see 3b**  |
| 4   | `libs/backend/skill-synthesis/.../skill-candidate.store.ts`            | 604  | `measurement.holdoutSessionId?.trim() ?? ''`      | **Item 3 (B3) — see 3b**             |
| 5   | `libs/frontend/tribunal-panel/.../tribunal-page.component.ts`          | 182  | `[tribunalSessionId]="tribunalSessionId() ?? ''"` | **Item 3 (B3) — see 3b**             |
| 6   | `libs/frontend/tribunal-panel/.../tribunal-progress.service.ts`        | 192  | `agent.parentSessionId ?? ''`                     | **EXCLUDE — not a field assignment** |

`tribunal-progress.service.ts:192` sits inside a `JSON.stringify` memo-key
derivation (`:180-196`). It coerces for _stable serialization_, not to populate a
session-id field. Changing it alters cache-key semantics for no benefit. **Do not
touch it**; this row exists so nobody "completes" the acceptance criterion by
editing it.

**Also recorded, not counted: 9 `?? undefined` no-ops** — `?? ` does not collapse
`''`, so these silently fail to normalize blank input
(`sdk-query-options-builder.ts:665`, `sdk-adapter-callback-registry.ts:37`,
`ptah-cli-registry.ts:733`, `message-finalization.service.ts:115,134,244,266`,
`harness-workflow.service.ts:502`). They are latent instances of the exact bug the
helpers exist to prevent. **Not in scope for this task** — flag as follow-up.

### 3b. The three surviving coercion sites — all cheaper than expected

**#3 `ptah-cli-spawn-options.service.ts:205` — VESTIGIAL. One-line deletion.**

My first reading proposed widening `CompactionHookHandler.createHooks`. **That
widening already exists**: `compaction-hook-handler.ts:126-128` is
`createHooks(sessionId: string | undefined, cwd: string | null, …)`. The `?? ''`
is a leftover. **Fix:** delete `?? ''`, pass `ownSessionId` directly. Then rewrite
the comment at `:196-204`, which currently asserts "`''` is the absent marker the
handler expects" — **that statement is now false** and would mislead the next
reader into re-adding the coercion.

**#4 `skill-candidate.store.ts:604-605` — a two-line round-trip. Collapse it.**

```
const holdout = measurement.holdoutSessionId?.trim() ?? '';
const holdoutSessionId = holdout.length > 0 ? holdout : null;
```

Coerces to `''` and immediately collapses back to `null`. **Fix:** one line —
`const holdoutSessionId = measurement.holdoutSessionId?.trim() || null;`. Keep
the `holdoutSessionId === null` invariant check at `:606-610` untouched.

**#5 `tribunal-page.component.ts:182` — widen the child input.**

Binds `tribunalSessionId() ?? ''` into
`VendorCardComponent.tribunalSessionId = input.required<string>()`
(`vendor-card.component.ts:53`), whose own guard at `:58` is
`if (!this.tribunalSessionId()) return null;`. The `''` exists solely to satisfy
`input.required<string>()`. **Fix:** change to `input<string | undefined>()`, drop
the `?? ''`, **keep the `:58` guard verbatim** (it is absence-handling and stays
correct). Frontend work; `tribunal-panel` only.

### 3c. Primitive decision — **YES, minimal and narrowly adopted. Reversed on evidence.**

**The numeric threshold, stated in advance:** a shared primitive in
`libs/shared/src/lib/utils/` is warranted when **≥ 8 production call sites across
≥ 4 libs re-derive the same rule** _and_ **the independent derivations disagree
observably** (not merely stylistically).

My initial reading, against a partial census, said the threshold was not met.
**The full census reverses that**, on the second clause specifically:

- **Sites/libs:** forms 1–4 and their variants total **28 sites across 6 libs**
  (`agent-sdk`, `skill-synthesis`, `memory-curator`, `vscode-core`,
  `rpc-handlers`, `cli-agent-runtime`). Well past 8/4.
- **Observable disagreement:** five implementations, four trim policies. A
  whitespace-only id is absent to three and valid to two. This is a real
  behavioural fork, which is exactly what a shared primitive exists to prevent —
  and it is the concrete form of `context.md`'s "a rule re-derived independently
  in ten places is how the original defect happened."

**What to build.** One file, `libs/shared/src/lib/utils/session-id.utils.ts`,
exported from `libs/shared/src/lib/utils/index.ts`, with **two** functions and
one documented trim policy (**trim, and treat whitespace-only as absent** — the
majority policy, and the only one that cannot be defeated by a stray space):

- `blankToUndefined(value: string | null | undefined): string | undefined` — returns the **trimmed** value or `undefined`.
- `blankToNull(value: string | null | undefined): string | null` — a one-line `?? null` wrapper, for SQL binds.

Both are pure, dependency-free, and satisfy `libs/shared/CLAUDE.md` guideline 3.

**What to adopt — narrowly.** Sweep exactly these:

1. `cli-agent-runtime/.../ptah-cli-registry.utils.ts:41` — becomes a one-line re-export/caller (per `context.md` §3's own prediction).
2. `memory-curator/.../memory.store.ts:140` `sessionIdOrNull` — becomes `blankToNull`.
3. `skill-synthesis/.../skill-candidate.store.ts:605` — the inline copy.
4. The **28 forms 1–4 sites**, where the rule is spelled longhand and the trim policy currently disagrees.

**What NOT to adopt — explicitly out of scope:**

- **The 97 bare `!x` sites (form 5).** On a `string | undefined`, `if (!sessionId) return;` is already correct and idiomatic. Rewriting 97 of them as `if (blankToUndefined(x) === undefined)` is large-surface churn with real regression risk and **zero** behavioural gain. This is 70% of all hits and must be left alone.
- **`knownSessionId` / `agentVisibleInSession`.** They are on the §0 do-not-delete list, they are frontend-scoped, and `knownSessionId`'s no-trim policy is pinned by `session-scope.spec.ts`. Changing its trim behaviour is a behavioural change requiring its own justification. **Leave both as-is** and record the trim divergence as a known, deliberate exception.
- **`resolveHookSessionId` / `resolveFirstPresent`.** §0 do-not-delete. Its `null` return and payload-first precedence are a _different_ rule (two-source precedence), not a blankness converter. Do not fold it in.

**Consequence for batching:** item 3 grows past a single-batch size. See §8 — B3
splits into B3a (the 3 coercion deletions, small) and B3b (the primitive + the
28-site sweep, medium).

### 3d. `blankToUndefined` vs `sessionIdOrNull` — which return type wins

**`undefined` wins as the primitive's return type; `null` survives as a
one-line SQL-boundary adapter.** The disagreement is not arbitrary — it is a
boundary difference:

- `sessionIdOrNull` feeds a **better-sqlite3 bind parameter**
  (`memory.store.ts:188`), in a param object whose siblings are all `?? null`
  (`workspace_root: insert.workspaceRoot ?? null`, `:189`). better-sqlite3
  **cannot bind `undefined`** — it throws. `null` is _required_ there, not a style
  choice; its JSDoc at `:132-139` says so.
- `blankToUndefined` feeds `??` chains and optional fields
  (`ptah-cli-registry.ts:653-654`), where `undefined` is required for `??` to fall
  through.

`undefined` is the codebase's canonical representation of absence (Wave 2's
`?: string` widenings; `libs/shared/CLAUDE.md` guideline 1), so it is the primary.
`blankToNull` exists solely so the SQL boundary does not re-derive the rule a
sixth time.

**The trim policy must be decided once and documented in the primitive's JSDoc:**
trim, whitespace-only is absent. Note in that JSDoc that `knownSessionId`
deliberately does **not** trim, so the exception is discoverable rather than
looking like an oversight.

### 3e. Sequencing

Per the brief the _decision_ is scheduled after items 1–2. The decision above is
made against the current commit, and items 1–2 remove only rows #1 and #2 of the
acceptance table — neither touches a form 1–8 site. **The census is stable across
items 1–2, so it does not need re-running.** B3 may proceed in parallel with B2.

---

## 4. `SessionId.safeParse` / `validate` take a required `string`

**Change** (`libs/shared/src/lib/types/branded.types.ts`):

- `:61` — `validate(id: string | undefined): id is SessionId` → `return id !== undefined && UUID_REGEX.test(id);`
- `:79` — `safeParse(id: string | undefined): SessionId | null` (body unchanged; `validate` now handles `undefined`).

**Type-system check.** A type predicate requires the asserted type to be
assignable to the parameter type. `SessionId = string & { __brand }` is assignable
to `string | undefined`. Valid.

**Do NOT widen `from()`** (`:69`). It throws by contract, and every caller passes a
known-present id. Widening it would invite `SessionId.from(undefined)` at sites
that today are compile-checked.

**Ternaries this deletes** (3, across 2 libs):

| File                                                                  | Line    | Before → after                                                                                                           |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`   | 132-134 | `event.sessionId ? SessionId.safeParse(event.sessionId) : null` → `SessionId.safeParse(event.sessionId)`                 |
| same                                                                  | 157     | `(sessionId ? SessionId.safeParse(sessionId) : null) ?? eventSession` → `SessionId.safeParse(sessionId) ?? eventSession` |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` | 647     | `routingId ? SessionId.safeParse(routingId) : null` → `SessionId.safeParse(routingId)`                                   |

**Expected compile fallout: none.** Widening a parameter is contravariant-safe —
every existing `string` caller still compiles. Verified callers that must keep
working: `branded.schemas.ts:19` (`.refine((id): id is SessionId => SessionId.validate(id))` — Zod passes `string`); `libs/shared/src/testing/matchers/to-be-session-id.ts:21`; `ptah-cli-registry.ts:831`; `memory-curator-ui/.../corpus-list.component.ts:413`; `harness-stream-broadcaster.service.spec.ts:119,150`.

**Do NOT widen the sibling brands.** `MessageId`, `CorrelationId`, `TabId`,
`JobId`, `RunId` have the identical shape (`:98`, `:135`, `:172`, `:204`, `:228`).
No caller passes them a possibly-undefined value, so there is no evidenced need.
The asymmetry is deliberate: `SessionId` is the one brand whose absence is a
modelled state after Wave 2. Record the asymmetry in the JSDoc at `:76-78` so a
future reader does not "restore consistency" by widening five unrelated APIs.

**Spec:** extend `libs/shared/src/lib/types/branded.types.spec.ts` (block at
`:88-100`) — `SessionId.safeParse(undefined)` → `null`;
`SessionId.validate(undefined)` → `false`. Keep the existing `''` assertions at
`:59` and `:96` untouched — they are the §0 evidence that `''` is still rejected.

**Comment cleanup:** `streaming-handler.service.ts:124-131` explains the ternary
being deleted. Rewrite, do not delete — the `SessionId.from` throw hazard it
documents is still real.

---

## 5. Branded / template-literal types — **NO-GO**

**Deciding criterion, written down as required:**

> Adopt branded construction on the three widened fields **only if**, after item 2
> lands, a producer outside a validated RPC boundary can still write `''` into
> `FlatStreamEvent.sessionId`, `SubagentRecord.parentSessionId`, or
> `MemoryExtractedPayload.sessionId` **and** no cheaper guard sits between that
> producer and a consumer that misreads it.

**Measured: NO-GO.** Reasons, in order of weight:

1. **Item 2 closes the two doors the whole TASK_2026_295 sweep traced back to**
   (`context.md` §2). After 2c/2d, the frontend cannot post a blank id into
   either entry point.
2. **The remaining producers are internal and already guarded** — every one of
   the 9 census sites in §3a rejects blank before publishing, and
   `resolveHookSessionId` returns `null` never `''` at the hook boundary.
3. **Cost is the largest in the task by a wide margin.** A brand on
   `FlatStreamEvent.sessionId` touches every construction site in the streaming
   path — the message transformers alone are ~25 emit sites
   (`../TASK_2026_295/context.md` "Wave 2 also revisits the ~25 `|| ''` emit
   sites"). That is a bigger surface than items 1–4 and 6 combined.
4. **It collides with item 6.** A brand cannot distinguish a tabId from a session
   UUID — both are UUID v4 (see §6). Branding would give false confidence on
   exactly the axis item 6 is about.
5. **`libs/shared/CLAUDE.md` already prescribes the cheaper mechanism** —
   guideline 6, Zod schemas next to their types, which is item 2.

**Recommendation: do not do item 5 in this task.** Record it as a standing
follow-up. If it is ever revived, it should be a task of its own with its own
gate, not a batch appended to this one.

---

## 6. The tabId-vs-UUID identity split

### 6a. Two corrections to the brief before any design

**Correction 1 — the ids are UUIDs, not `tab_N`.**
`context.md` §6 and the audit both describe the closure id as `tab_N`. At the
current commit a tabId is a **UUID v4**:

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2066-2068` — `generateTabId() { return TabId.create(); }`
- `libs/shared/src/lib/types/branded.types.ts:165-167` — `TabId.create() { return uuidv4() as TabId; }`

`tab_<ts>_<id>` (e.g. `tab_1778939573732_w43e75q`) is the **legacy** format that
caused Sentry issue NODE-NESTJS-3Y and is now _rejected_ at the chat RPC boundary
(`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:4-13, 36-41`).

**Consequences that change the design space:**

- `SessionId.validate(tabId)` returns **true**. A tabId is shape-indistinguishable from an SDK session UUID.
- **Consumer-side canonicalisation by inspection is impossible.** Any design that says "detect a tabId and swap it" is unimplementable. This eliminates one of the three options the brief asked me to choose between.
- A `LIKE 'tab\_%'` SQL predicate would match only legacy rows. Do not write one.

**Correction 2 — `agent-sdk/CLAUDE.md:77` is STALE, and it is the doc a developer
would read before touching this item.**

It states that "`SdkQueryOptionsBuilder.createHooks` captures `sessionId ?? ''`,
and for a NEW session that id does not exist yet ... so the closure holds `''` for
the whole query." **That coercion no longer exists.**
`sdk-query-options-builder.ts:1226-1232` is now
`createHooks(cwd: string, sessionId?: string, …)`, and
`compaction-hook-handler.ts:126-128` is
`createHooks(sessionId: string | undefined, …)`. The closure holds `undefined`,
not `''`.

**Correcting this doc is in scope for B5** (and the `''` reference in the same
paragraph should become _absent_, per the Wave 2 convention). Leaving it stale
invites a developer to re-add the coercion the census flagged at
`ptah-cli-spawn-options.service.ts:205`.

**Correction 3 — the window is narrower than "the closure holds a tabId".**
Hook handlers call `resolveHookSessionId(input.session_id, closureId)` —
**payload first**. The SDK populates `session_id` on hook payloads, so the closure
(tabId) is only a _fallback_. The dominant emitter of the wrong id is not the hook
path at all:

- `sdk-agent-adapter.ts:506` — `this.notifyActivity(trackingId, 'user', …)`, called **before** `streamTransformer.transform` at `:509` consumes the stream.
- `resolveActivityIds` (`:827-835`) canonicalises via `rec?.realSessionId ?? (sessionId as string)` — but at `:506` `realSessionId` is still `null`, so it emits the tabId.
- Every later `notifyActivity` emits the UUID.
- `SessionEnd` always canonicalises: `session-control.service.ts:126` `rec.realSessionId ?? rec.tabId`, notified at `:168-171` (and `:212` for the bulk path).

**So it is a first-turn-only window on one call site.** That is why it is
intermittent, and it is the whole reason state is armed under the tabId and torn
down under the UUID.

### 6b. Which consumers actually key state by the reported id

Confirmed by reading the injection sites: **exactly two libs subscribe**, both via
SDK callback registries injected by `SDK_TOKENS` —
`MemoryTriggerService` (`memory-trigger.service.ts:96-132`, 11 registries,
subscribed `:138-170`, disposed `:182-206`) and `SkillTriggerService`
(`skill-trigger.service.ts:87-109`, 8 registries).

| Owner                                | State keyed by the reported id                                                                 | Consequence when keyed by a tabId                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `MemoryTriggerService`               | `sessions` (+ `idleTimer`), `episodes`, `inFlightCurates`, `lastCurateAt`                      | Orphan idle timer; never cleared by the UUID `SessionEnd`        |
| `MemoryCuratorService`               | `inFlight`, key `` `${workspaceRoot ?? ''}::${sessionId}` `` (`memory-curator.service.ts:243`) | Duplicate-curate suppression misses                              |
| `ObservationQueueStore` (**SQLite**) | `observation_queue.session_id`                                                                 | Rows un-drainable by a UUID-keyed drain                          |
| `SkillTriggerService`                | `sessions`, `turnCompleteStates`, `editTestStates` (+ 2 timers)                                | Orphan timers                                                    |
| `SkillSynthesisService`              | `analyzedSessions`                                                                             | Turn counts split across two keys                                |
| `SkillQueueStore` (**SQLite**)       | `skill_synthesis_queue.session_id`, `UNIQUE(session_id, stage)`                                | Rows invisible to a UUID drain                                   |
| transcript readers                   | `${sessionsDir}/${sessionId}.jsonl`                                                            | **Hard fail** — the TASK_2026_293 failure mode by a second route |

**`teammateIdle` is NOT a consumer — confirmed intentional.**
`sdk-adapter-events.service.ts:69-81` JSDoc: "A future UI can use this to show
'agent idle, awaiting steering' affordances." It is aspirational surface with a
documented reason for having no subscriber. **Do not treat it as a consumer and
do not delete it.**

### 6c. Design decision — reject the audit's candidate as stated; adopt a two-part fix

The audit proposed promoting the single-slot `onSessionIdResolved` setter to a
fan-out registry. **Reject that specific shape**, for a concrete reason the audit
did not have: the setter is part of the **shared port**.

- `libs/shared/src/lib/types/agent-adapter.types.ts:253` — `setSessionIdResolvedCallback(cb: SessionIdResolvedCallback): void;` on `IAgentAdapter`.
- Backed by `SdkAdapterCallbackRegistry` (`sdk-adapter-callback-registry.ts:10`, single slot) and already consumed by `cli-agent-runtime` (`wiring/sdk-callbacks.ts:155`).

Promoting it would be a breaking change to the adapter port and to
`cli-agent-runtime`'s wiring, for no gain.

**Adopt instead — Part A (prevention) + Part B (reconciliation).**

#### Part A — close the window at its source (`agent-sdk` only, no consumer changes)

The first `notifyActivity` at `sdk-agent-adapter.ts:506` is the only emitter that
reports a non-canonical id. Make the activity path emit **once, under the
canonical id**, by buffering the pre-init user activity and flushing it when
`bindRealSessionId` resolves.

- `:506` records pending user activity for `trackingId` instead of notifying immediately.
- The existing resolve path (`createSessionIdCallback`, `:637-665`, which already calls `bindRealSessionId` at `:661` and `emitSessionIdResolved` at `:664`) flushes the buffered activity through `resolveActivityIds`, which now returns the UUID.
- If the session ends without ever resolving, flush under the tabId on teardown — matching `session-control.service.ts:126`'s own `realSessionId ?? tabId` rule, so both ends stay consistent.

**Why this is the right primary fix:** it _prevents_ the split rather than
repairing it, requires **zero** changes in `skill-synthesis` / `memory-curator`,
writes **no** SQLite row under a tabId in the first place, and touches neither
`trackingId` (`:460`), `registerKey`
(`session-query-executor.service.ts:118`), the MCP routing segment
(`sdk-query-options-builder.ts:1153-1184`), nor `resolveHookSessionId`.

#### Part B — a rekey signal for the residual paths

Part A does not cover a hook payload that genuinely lacks `session_id` and falls
back to the closure. For that residual, and to satisfy the stated acceptance
criterion, add a **twelfth** SDK callback registry — the established pattern both
trigger services already consume 8–11 instances of:

- New `SessionIdResolvedCallbackRegistry` in `agent-sdk/src/lib/helpers/`, shaped exactly like `CompactionCallbackRegistry` (`compaction-callback-registry.ts` — `Set`, `register()` → disposer, `notifyAll` with per-callback try/catch).
- New token `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` (`di/tokens.ts`), registered in `di/register.ts`.
- Notified from **both** existing emit sites: `sdk-agent-adapter.ts:610` (resume) and `:664` (new session) — **alongside**, not instead of, `this.callbacks.emitSessionIdResolved(...)`. The single-slot setter and the port are untouched.
- `MemoryTriggerService` and `SkillTriggerService` each inject it, subscribe in `start()`, dispose in `stop()`, and implement `rekeySession(fromId, toId)`.

**Rekey semantics — mirror `bindRealSessionId`'s discipline**
(`session-registry.service.ts:156-180`: set-once, rejects blank, rejects unknown,
idempotent, refuses overwrite):

- Migrate every map entry from `fromId` to `toId`.
- **If `toId` already exists, keep it and discard the `fromId` entry** (clearing its timer). Never clobber. A missed merge is recoverable; a wrong overwrite is not — the same "miss rather than wrongly delete" rule Wave 1 applied to `removeSupersededInterrupted`.
- Re-arm timers under `toId` with the remaining delay; clear the `fromId` timer.

#### Answers to the three open questions

**Q1 — SQLite rows already on disk under a tabId.**
Answer: **backfill in-process, reap historically, never migrate historically.**

The tabId→UUID mapping lives only in `SessionRegistry` (in-memory). It is **not
persisted**. So a row orphaned by a _previous_ process can never be reconciled —
nothing on disk records which tabId belonged to which session.

- **In-process (live):** the rekey handler issues `UPDATE observation_queue SET session_id = ? WHERE session_id = ?` in the same transaction as the map migration. For `skill_synthesis_queue`, the `UNIQUE(session_id, stage)` constraint means a plain `UPDATE` can collide — use `UPDATE OR IGNORE` followed by `DELETE` of the un-migrated remainder, so the pre-existing `toId` row wins.
- **Historical (pre-fix rows):** do **not** attempt migration. **USER DECISION 2026-08-19 — ship a numbered migration that REAPS.** See the decision block below.
- **Do not** write a `LIKE 'tab\_%'` predicate — see Correction 1.

##### USER DECISION — historical rows are reaped by migration 0039, not reconciled

The user asked whether a post-deploy migration script could absorb the historical
problem so old sessions need not be worried about, and recalled that something
like it already exists. Verified by the orchestrator:

- **The framework exists and is better than a script.** `SqliteMigrationRunner`
  (`persistence-sqlite/src/lib/migration-runner.ts`) applies numbered,
  forward-only, append-only migrations — currently at **0038**
  (`migrations/index.ts`) — **automatically at boot**, atomic per migration,
  idempotent via `schema_migrations`, with `SqliteBackupService` available. So
  this is migration **0039**, with **no manual post-deploy step**. Migrations are
  normally static SQL; `0009_auto_vacuum` exports a `run` function, so a
  procedural migration is an established option if one is ever needed.
- **`SessionImporterService` is NOT the mechanism.** It scans
  `~/.claude/projects/*.jsonl` and imports **session metadata** for the UI
  (`agent-sdk/src/lib/session-importer.service.ts:1-9`). It never touches
  `observation_queue` or `skill_synthesis_queue`. Do not wire it into this task.
- **Reconciliation of historical rows is impossible, not merely deferred.** The
  tabId→UUID mapping lives only in the in-memory `SessionRegistry` and is never
  persisted. Nothing on disk records which tabId belonged to which session, so a
  migration has nothing to join on. Do not attempt one, and do not let a reviewer
  ask for one.
- **Why reaping is acceptable.** The orphaned rows are internal work-queue
  entries — pending observations to curate, pending synthesis stages — **not user
  data**. Conversations live in the SDK's JSONL files and are untouched by any
  part of this task. The cost of reaping is some un-curated memories and
  un-synthesised skills from old sessions.

**Shape of migration 0039:** static SQL, bounded, age-based. Delete unprocessed
`observation_queue` rows and un-advanced `skill_synthesis_queue` rows older than
the existing retention window. **No filesystem access, no `LIKE 'tab\_%'`
predicate, no id mapping.** It must not touch processed rows, and it must not
touch rows inside the retention window — a live install upgrading mid-session
has legitimate unprocessed rows.

**Consequence for batching:** B5b shrinks. The live in-process backfill
(`UPDATE ... WHERE session_id = ?`, plus the `UPDATE OR IGNORE` + delete
remainder for the `UNIQUE(session_id, stage)` collision) is unchanged and still
required. The historical half becomes one migration file plus its spec, which is
the cheapest and best-established pattern in the repo.

With Part A landed, the live backfill should find zero rows in the common case.
It exists for the residual hook path and must still be correct.

**Q2 — `teammateIdle`.** Confirmed intentional. Not a consumer. Documented at
`sdk-adapter-events.service.ts:69-75`. No action.

**Q3 — atomicity vs an in-flight curate.**
`MemoryCuratorService.inFlight` (`:63`) is keyed
`` `${workspaceRoot ?? ''}::${sessionId}` `` (`:243`). A rekey landing mid-curate
would leave the in-flight guard holding the old key, so a second curate could
start under the new key — a double-curate, not corruption.

**Ordering makes this near-impossible but not impossible:** the resolve fires from
the SDK `init` message, i.e. at the very start of turn 1, whereas a curate is
triggered by idle/stop (minutes later) or by `runBootScan`. **Do not rely on
that.** Requirement: the rekey handler must be **synchronous** and must migrate
`inFlightCurates` / `lastCurateAt` **before** `sessions`, so no `await` interleaves
between reading the old key and writing the new one. If a curate is genuinely in
flight, migrating its in-flight key preserves the suppression rather than
defeating it. Pin this with a spec that starts a curate, fires the rekey, and
asserts exactly one curate ran.

### 6d. Invariants that must survive (verify in review, and pin)

| Invariant                                             | Location                                                         | Status under this design              |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `trackingId = tabId as SessionId`                     | `sdk-agent-adapter.ts:460`                                       | **Untouched**                         |
| `registerKey = sessionConfig?.tabId ?? sessionId`     | `session-query-executor.service.ts:118`                          | **Untouched**                         |
| MCP URL routing segment; missing id throws `SdkError` | `sdk-query-options-builder.ts:1153-1184` (throw at `:1164-1172`) | **Untouched**                         |
| `extractCallerSessionId` parses `[^/?]+`              | `vscode-lm-tools/.../http-server.handler.ts:141-149`             | **Untouched**                         |
| `resolveHookSessionId` returns `null`, never `''`     | `hook-session-resolver.ts`                                       | **Untouched**                         |
| `IAgentAdapter.setSessionIdResolvedCallback`          | `agent-adapter.types.ts:253`                                     | **Untouched** (Part B adds alongside) |

### 6e. Required spec (acceptance criterion)

> "a spec proving a `SessionEnd` arriving under the canonical UUID clears state
> registered under `tab_N`"

Two specs, because Part A and Part B satisfy it differently:

1. **Part A spec** — drive a new session through first prompt → `init` → `SessionEnd`; assert the activity registry emitted the **UUID exactly once** and never the tabId, and that the trigger service holds **one** entry which `SessionEnd` clears.
2. **Part B spec** — register trigger state under the tabId directly (simulating the residual hook path), fire the rekey, then fire `SessionEnd` under the UUID; assert the tabId-keyed timer is cleared and no entry survives. Plus the `inFlight` double-curate spec from Q3.

Also add a paired-isolation sibling (Wave 1 rule): a session whose id never
resolves must still be torn down correctly under its tabId.

### 6f. Item 6 do-not-touch list

- `sdk-agent-adapter.ts:460`, `session-query-executor.service.ts:118`, `sdk-query-options-builder.ts:1153-1184` — the three invariants. Changing any of these is the "substitution" the brief forbids.
- The single-slot `setSessionIdResolvedCallback` / `SdkAdapterCallbackRegistry` and `cli-agent-runtime/wiring/sdk-callbacks.ts` — add alongside, never replace.
- The three existing tabId→UUID remaps (`SessionRegistry.bindRealSessionId`, `SubagentRegistryService.resolveParentSessionId`, `AgentProcessManager.resolveParentSessionId`) — already correct; do not fold them into the new registry.
- `sdk-adapter-events.service.ts` `teammateIdle` — leave it subscriber-less.

---

## 7. Risk register

**Baseline that must not drop: 16 projects typecheck, 9,834 tests.**

| #   | Risk                                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **`libs/frontend/core` coverage floor (statements 85%, lines 85%).** Item 2 adds no frontend code, but item 3b edits `tribunal-panel` and item 4 edits `chat-streaming`. Neither is `core` — the floor should be untouched.                                                 | Verify `nx test core` coverage before/after. **Never lower the threshold to make a batch pass.**                                                              |
| R2  | **Deleting a §0 guard as "dead code".** The single highest-probability way this task regresses.                                                                                                                                                                             | §0 table is normative. Any PR deleting a listed guard is rejected on sight.                                                                                   |
| R3  | **Item 2d writing `.min(1)` on `chat:subagent-query`**, converting a deliberate empty-result into an error — or worse, normalizing `''`→`undefined` and restoring the Wave 1 cross-session leak.                                                                            | Spec 2e.3 is the guard. Written explicitly in 2d.                                                                                                             |
| R4  | **Item 6 Part B rekey clobbering a live UUID entry.**                                                                                                                                                                                                                       | Refuse-overwrite rule, mirroring `bindRealSessionId:176-180`.                                                                                                 |
| R5  | **Item 6 SQLite backfill colliding with `UNIQUE(session_id, stage)`.** A naive `UPDATE` throws and aborts the rekey.                                                                                                                                                        | `UPDATE OR IGNORE` + delete remainder, per Q1.                                                                                                                |
| R6  | **Item 6 batches are the only ones that can genuinely regress the empty-string gate**, since a regression in either failure mode blocks the other (the objection recorded in `context.md` §6).                                                                              | Sequenced last; items 1–4 land and are verified green first.                                                                                                  |
| R7  | Widening `SessionId.validate` breaks the `.refine` type predicate in `branded.schemas.ts:19`.                                                                                                                                                                               | Assignability checked in §4; `string` still satisfies `string \| undefined`. Typecheck `shared` first.                                                        |
| R8  | `boot-thoth-runtime.spec.ts:143-173` may assert `sessionId: ''`.                                                                                                                                                                                                            | Item 1 must _adapt_ (invert) it, not delete it — the Wave 2 precedent (two specs were inverted because they pinned the removed coercion). Zero specs deleted. |
| R9  | Unwired `memory:sessionStartInjected` channel (§1c) may tempt a developer to delete it.                                                                                                                                                                                     | Message protocol is append-only (`shared/CLAUDE.md` guideline 5). Recorded, not removed.                                                                      |
| R10 | Known flake: one `rpc-handlers` test failed once under parallel load in Wave 1 and did not reproduce. Batch 2 is rpc-handlers-heavy.                                                                                                                                        | If it recurs, rerun isolated + `--skip-nx-cache` before treating it as a break. Record, do not swallow.                                                       |
| R11 | **B3b sweep creep into the 97 form-5 `!x` sites.** This is the single largest churn risk in the task and would put ~46 extra files in one diff for zero behavioural gain.                                                                                                   | §3c names the exclusion; §9 verification point 4 repeats it. Reject any B3b diff touching a bare `!x` guard.                                                  |
| R12 | **B3b changes trim policy at 13 sites that currently do NOT trim** (form 1-variant, `skill-synthesis` + `memory-curator` trigger services). Adopting the trim-and-treat-whitespace-as-absent policy is a real behavioural change there — correct, but it must be conscious. | Call it out in the batch brief; add one spec per trigger service asserting a whitespace-only id is now rejected. Do **not** silently widen.                   |
| R13 | **`libs/shared/src/lib/utils/index.ts` barrel conflict** between B3b and B4.                                                                                                                                                                                                | B3b is sequenced after B4 (§8). Do not parallelise them.                                                                                                      |

**Out of scope, unchanged:** `agent-monitor.store.ts` (~1,610 lines vs the 700
soft ceiling). Item 4 and item 6 both touch files near it; **do not opportunistically split it.**

---

## 8. Batching

Five batches. Items 1–4 are independent of each other; item 6 is sequenced last
by explicit instruction.

| Batch   | Scope                                                                                                                                                                                                                                                                             | Developer                         | Depends on          | Parallel-safe with |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------- | ------------------ |
| **B1**  | Item 1 — widen `memory.ts:46`; delete coercions #1/#2; port doc comment + spec confirmation; adapt `boot-thoth-runtime.spec.ts`; **explicitly rule out** `:31`, `:55`, port widening                                                                                              | backend                           | —                   | B2, B3a, B3b, B4   |
| **B2**  | Item 2 — new `agent-rpc.schema.ts`; `SubagentQuerySchema` + header rewrite; 5 specs                                                                                                                                                                                               | backend                           | —                   | B1, B3a, B3b, B4   |
| **B3a** | Item 3 coercions — delete #3 (`ptah-cli-spawn-options.ts:205`, vestigial) + rewrite its false comment; collapse #4 (`skill-candidate.store.ts:604-605`); widen `vendor-card` input + #5 (`tribunal-page.ts:182`)                                                                  | backend **+ frontend** (see note) | —                   | B1, B2, B3b, B4    |
| **B3b** | Item 3 primitive — new `libs/shared/.../session-id.utils.ts` (`blankToUndefined` + `blankToNull`) + barrel; rewire `blankToUndefined`, `sessionIdOrNull`, the inline copy; sweep the **28** forms 1–4 sites; specs for the primitive; write the census verdict into the QA report | backend                           | B4 (shared barrel)  | B1, B2, B3a        |
| **B4**  | Item 4 — widen `SessionId.validate`/`safeParse`; delete 3 ternaries; spec; JSDoc asymmetry note                                                                                                                                                                                   | backend + frontend (shared-owned) | —                   | B1, B2, B3a        |
| **B5**  | Item 6 — Part A (activity buffer/flush) + Part B (registry, 2 trigger subscribers, rekey, SQLite policy) + 4 specs + **`agent-sdk/CLAUDE.md:77` staleness fix**                                                                                                                   | backend                           | **B1–B4 all green** | none               |

**Notes on assignment:**

- **B3a is the only split batch.** Its backend half (`cli-agent-runtime`, `skill-synthesis`) and frontend half (`tribunal-panel`) are disjoint file sets — two developers in parallel, or one full-stack developer sequentially. All three edits are small; this batch is the cheapest in the task.
- **B3b is the largest non-item-6 batch** (28 call sites across 6 libs). It is mechanical but wide. It must land **after B4**, because both touch `libs/shared/src/lib/utils/index.ts` and `libs/shared` is upstream of everything — serialising them avoids a barrel conflict.
- **B3b's sweep must not creep into form 5.** The 97 bare `!x` sites are explicitly excluded (§3c). A reviewer should reject any B3b diff that touches them.
- **B4 touches `libs/shared`**, which every project depends on. It is parallel-safe only because it is purely contravariant (widening a parameter). If the team-leader prefers zero risk, run B4 **alone first**, then B1/B2/B3a in parallel.
- **B5 is large.** Split if needed: B5a = Part A + its spec (agent-sdk only, self-contained, delivers most of the value); B5b = Part B + SQLite policy + remaining specs + the doc fix. B5b depends on B5a.

**Recommended execution order:** B4 → (B1 ‖ B2 ‖ B3a) → B3b → verify full gate → B5.

**Verification after every batch** (`context.md` §Verification):

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core
npx nx run-many -t test  -p <same list>
npx nx run-many -t lint  -p <every project touched>
```

---

## 9. Team-leader handoff

**Developer type:** predominantly **backend-developer**. Frontend work is confined
to two small, well-specified edits: `tribunal-panel` (B3) and the
`streaming-handler.service.ts` ternaries (B4).

**Complexity:** MEDIUM overall; item 6 alone is HIGH.
Rough effort — B1 ~1–2h, B2 ~3–4h, B3a ~1–2h, B3b ~4–6h, B4 ~1–2h, B5 ~8–12h.

**Files affected**

_CREATE_

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts`
- `libs/shared/src/lib/utils/session-id.utils.ts` (+ spec)
- `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts` (+ spec)

_MODIFY_

- `libs/shared/src/lib/types/messages/memory.ts` (`:46` only)
- `libs/shared/src/lib/types/branded.types.ts` (`:61`, `:79`, JSDoc `:76-78`)
- `libs/shared/src/lib/utils/index.ts` (barrel)
- `libs/backend/memory-contracts/src/lib/compaction-callback.port.ts` (doc comment only)
- `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.ts` (`:46`)
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts` (`:190`)
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (`:742-815`)
- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.schema.ts` (header + new schema)
- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` (parse only; `:142-148` untouched)
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts` (`:196-206`)
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-registry.utils.ts` (`:41` → caller)
- `libs/backend/memory-curator/src/lib/memory.store.ts` (`:140` → `blankToNull`)
- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (`:604-605`)
- the **28 forms 1–4 sites** listed in `item-3-blank-id-census.md` (B3b sweep)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (`:647`)
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (`:506`, `:610`, `:664`, activity buffer)
- `libs/backend/agent-sdk/src/lib/di/{tokens,register}.ts`
- `libs/backend/agent-sdk/CLAUDE.md` (`:77` — stale `sessionId ?? ''` claim)
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`
- `libs/backend/memory-curator/src/lib/observation-queue.store.ts` (reap only)
- `libs/backend/skill-synthesis/src/lib/queue/skill-queue.store.ts` (backfill only)
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts` (`:124-134`, `:157`)
- `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts` (`:182`)
- `libs/frontend/tribunal-panel/src/lib/components/vendor-card.component.ts` (`:53`)

_DO NOT MODIFY_ — see the per-item do-not-touch lists and §0. In particular:
`compaction-hook-handler.ts` `createHooks` (**already** `string | undefined`),
`session-scope.ts`, `hook-session-resolver.ts`, and the 97 form-5 `!x` sites.

**Critical verification points before implementation:**

1. Re-read §0. No listed guard may be deleted.
2. Item 1 is **one** widening, not four. The three rejections are evidence-backed; do not "complete" them.
3. Item 2d must not put `.min(1)` on `chat:subagent-query.sessionId`.
4. B3b must not touch the 97 bare `!x` sites, `knownSessionId`, or `resolveHookSessionId`.
5. Item 6 must not touch `trackingId`, `registerKey`, or the MCP routing segment.
6. Spot-check every line number before editing — this plan and `item-3-blank-id-census.md` were written against a dirty working tree.

---

## Clarifications — RESOLVED 2026-08-19

**Decision: Option A**, with B5 split into B5a (Part A, prevention) and B5b
(Part B, reconciliation + migration 0039). The user's ruling that historical rows
are reaped rather than reconciled (see §6c Q1) removed the sub-question that made
Option A expensive. B5b is smaller than originally scoped.

The original clarification and its options are retained below for the record.

---

### 1. Item 6 scope: prevention + reconciliation, or prevention only?

The acceptance criterion in `context.md` reads: "a spec proving a `SessionEnd`
arriving under the canonical UUID clears state registered under `tab_N`". That
wording presumes a **reconciliation** design. My investigation found the split is
a first-turn-only window on a **single call site**
(`sdk-agent-adapter.ts:506`), which can be **prevented** outright — in which case
no state is ever registered under a tabId and the criterion becomes vacuous
rather than satisfied.

- **Option A (Recommended) — Part A + Part B, as planned above.** Prevention closes the common case; the rekey registry handles the residual hook path and lets the criterion be met literally. Cost: the full B5, ~8–12h, touching agent-sdk + both trigger services + two SQLite stores.
- **Option B — Part A only.** ~2–3h, agent-sdk only, zero consumer changes, no SQLite work. Eliminates the observed defect. Residual: a hook payload genuinely missing `session_id` can still key state by the tabId, and the acceptance criterion would need rewording to "no state is registered under a non-canonical id".
- **Option C — Part B only** (the audit's original proposal, in my corrected registry form). Satisfies the criterion literally but leaves the defect firing every first turn and repairing afterwards — strictly worse than A, and it still needs the SQLite backfill.

**My recommendation: Option A**, with B5 split into B5a (Part A) and B5b (Part B)
so that if the gate is at risk, B5a alone still delivers the fix.

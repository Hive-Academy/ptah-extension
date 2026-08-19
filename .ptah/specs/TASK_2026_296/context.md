# Context

## Where this came from

Direct continuation of **TASK_2026_295** (`../TASK_2026_295/context.md` — read
its "Wave 1 outcome" and "Wave 2 outcome" sections first). Two commits landed:

| Commit      | What                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| `6c90a4915` | Wave 1 — containment. Every consumer refuses an empty session id. 100 files.        |
| `517c7562a` | Wave 2 — removed the forcing function. Three shared declarations changed, 49 files. |

Both are verified: 16 projects typecheck clean, 9,834 tests passing.

This task is the remainder that Wave 2 deliberately did **not** take, plus one
correction Wave 2 surfaced about its own premise.

## The correction that motivates most of this task

Wave 2 was briefed as "make `''` unrepresentable". **That was wrong, and the
implementing agent said so rather than quietly delivering the framing.**

`?: string` still admits `''` — `''` is a `string`. Widening removed the
_forcing function_ (the reason a producer had to invent a value for a field it
could not fill), not the value itself.

Two consequences that shape this task:

1. **`knownSessionId`, the `EventDeduplicationService` guards and
   `beginTeardown`'s empty check are still load-bearing.** They sit at
   boundaries that take a bare `string` or read off the wire. Do not delete them
   as dead code. Wave 2 widened their signatures to `string | undefined` and
   rewrote their docs to say _absent_ rather than naming the empty string, so
   they read as absence-handling rather than folklore.
2. **Genuine unrepresentability needs a branded or template-literal type**, or
   validation at the door. This task takes the door; the branded type is item 5
   and is optional.

## Work items

### 1. The third declaration, and its port twin

`libs/shared/src/lib/types/messages/memory.ts:46` — `MemoryExtractedPayload.sessionId: string`
is a **third** required declaration of the same shape as the two Wave 2 widened.
It is the last thing in the repo still forcing a `?? ''` coercion, at exactly
two sites:

- `libs/backend/cli-engine/.../wire-thoth-push-bridges.ts:46`
- `libs/backend/thoth-runtime/.../boot-thoth-runtime.ts:190`

It pairs with `libs/backend/memory-contracts/.../compaction-callback.port.ts:4`,
which declares `sessionId: string` with no non-empty guarantee — so the port
permits precisely what `MemoryCuratorService` now has to tolerate at runtime.
Same change, same lib pair, and the two should move together.

**Expected shape:** widen both to optional, delete the two coercions, fix the
compile fallout. Precedent and method are in Wave 2's report — the fallout there
was four production files across two libs, far smaller than expected, because
consumers already handled absence.

### 2. Zod at the two unvalidated entry points — the durable fix

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:743`
  (`agent:resumeCliSession`) — registered with an inline TypeScript param type
  and **zero runtime validation**.
- `chat:subagent-query` — `subagent-rpc.schema.ts` explicitly notes it "uses
  static TypeScript types and trivial presence checks".

`rpc-handlers/CLAUDE.md` states Zod schemas are mandatory. Both are exempt in
practice, and **both are doors an empty session id came through from the
frontend** — they are the two entry points the whole TASK_2026_295 sweep traced
back to.

A `z.string().min(1).optional()` here makes the class unrepresentable at the
boundary rather than caught by twenty guards downstream. This is the single
highest-leverage item in the task.

**Caution:** adding a schema changes RPC error behaviour for malformed input —
a rejection at the boundary instead of a silent degrade. Check what the webview
does with an RPC error on those two methods before landing it, and pin the new
behaviour with a spec.

### 3. Re-audit the hand-rolled blank-id checks, THEN decide on a primitive

The style review of Wave 1 found "a blank id means absent" hand-rolled **eight
ways across ten files**: `!x || x.trim().length === 0`, `x !== undefined &&
x.trim().length === 0`, bare `x.trim().length === 0`, bare `x === ''`, bare
`!x`, `x ? x : undefined`, plus two named helpers that disagree on return type
(`blankToUndefined` → `undefined`, `sessionIdOrNull` → `null`).

Each is individually correct and individually tested. The concern is structural:
a rule re-derived independently in ten places is how the original defect
happened.

**Do the audit before writing the primitive.** Wave 2 was expected to make
several of these unreachable, and items 1 and 2 above will remove more. Writing
a shared helper and sweeping call sites that are about to be deleted is wasted
churn. If a real surface remains, `libs/shared/src/lib/utils/` is the right home
per `libs/shared/CLAUDE.md`, and `blankToUndefined` / `sessionIdOrNull` become
one-line callers of it.

### 4. `SessionId.safeParse` / `validate` take a required `string`

`libs/shared/src/lib/types/branded.types.ts:61,79`. Widening to `string |
undefined` (returning `null` for absent) would delete a ternary Wave 2 had to
add at `chat-streaming/.../streaming-handler.service.ts:126` and would have made
a harness-broadcaster spec restructure unnecessary. Small, contained, broadly
useful — every caller currently has to null-check before calling a function
whose entire job is to answer "is this a valid id".

### 5. Optional — branded or template-literal types

Only if genuine unrepresentability is wanted on the three widened fields
(`FlatStreamEvent.sessionId`, `SubagentRecord.parentSessionId`, and item 1's
`MemoryExtractedPayload.sessionId`). This is the only mechanism that actually
makes `''` inexpressible in the type system.

Weigh it against item 2: validating at the two doors may make this unnecessary,
and it is the larger change by far — it would touch every construction site in
the streaming path. **Decide after items 1–2 land, not before.**

### 6. The tabId-vs-UUID identity split — folded in by user decision

**Scope decision, 2026-08-19.** This item was written above as explicitly out of
scope and was offered as its own task. The user chose to fold it into 296
instead. Recording the objection so the reasoning survives: this is a defect
class **independent of the empty string**, so 296's gate now covers two
unrelated failure modes and a regression in either blocks the other. Proceeding
as directed.

On the chat path the hook closure holds a **tabId**, not the canonical SDK UUID,
so one turn emits some hook payloads keyed `tab_N` and others by the real UUID.
Consumers that key state by the reported id can hold two live entries for one
session, and an idle timer registered under `tab_N` is never cleared by the
`SessionEnd` arriving under the UUID.

**Critical constraint — do not "fix" this by swapping in the UUID.**
`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:460` sets
`const trackingId = tabId as SessionId`, and `agent-sdk/CLAUDE.md` documents that
choice as deliberate under **MCP caller identity**: for a NEW session the tabId
is the only id that exists, because the SDK UUID arrives later in the system
`init` message. The same doc pins `registerKey` to `sessionConfig.tabId ??
sessionId` so the MCP consumer's `resolveSessionId` can `find()` it, and makes a
missing routing id throw `SdkError`. Any change here must keep those two
invariants and the `resolveHookSessionId` contract (payload first, closure
second, `''` from either source treated as absent, publish only after rejecting
`null`) intact.

So the real problem is **reconciliation, not substitution**: when the `init`
message delivers the canonical UUID, consumers holding `tab_N` state need to be
told the two ids denote one session. The architect owns choosing between an
aliasing map, a rekey-on-init event, or a consumer-side canonicalisation step —
and owns saying which consumers actually key by the reported id today.

**Ordering:** this lands **after** items 1–4. It is independent of them, and
sequencing it last keeps a regression in the identity work from masking the
empty-string gate.

## Explicitly out of scope

- **`agent-monitor.store.ts` is ~1,610 lines** against the 700 soft ceiling and
  owns three responsibilities (background agents, workflow subagents, active-tab
  filtering) that would pass the facade-rule nameability test if split. Real, but
  a different concern from session identity. Recorded in
  `../TASK_2026_295/context.md` for whoever next touches that file.

## Orchestration decisions

- **CLI delegation: disabled.** Checkpoint 0.1 run 2026-08-19; codex installed,
  claude-cli and ollama-cloud available via ptah-cli. Sub-agents only — item 3's
  audit needs one head holding the whole call-site map, and items 1–2 change the
  compile surface later items depend on.
- **Workflow depth: Partial.** project-manager skipped; this file is already a
  superset of `task-description.md`. Flow is architect → team-leader → developers
  → QA.

## Acceptance criteria

- No `?? ''` or `|| ''` coercion onto a session-id field remains anywhere in
  `libs/**`.
- `agent:resumeCliSession` and `chat:subagent-query` validate their input with
  Zod, and a spec pins what each does with a malformed or absent id.
- The blank-id audit is written down — either a shared primitive exists and the
  surviving call sites use it, or the report states how many sites remained after
  items 1–2 and why a primitive was not warranted.
- Full gate green at or above the current baseline: 16 projects typecheck, 9,834
  tests. Any drop explained by name.
- No guard deleted on the grounds that "the type prevents it" without first
  confirming the type actually does — see the correction at the top of this file.
- **Item 6:** the two ids for one session are reconciled, with a spec proving a
  `SessionEnd` arriving under the canonical UUID clears state registered under
  `tab_N`. The `registerKey` / MCP-routing-segment invariants in
  `agent-sdk/CLAUDE.md` still hold, and `resolveHookSessionId` still returns
  `null` rather than `''`.

## Verification

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,canvas,tribunal-panel,chat-execution-tree,core
npx nx run-many -t test  -p <same list>
npx nx run-many -t lint  -p <every project touched>
```

`libs/frontend/core` has a coverage floor (statements 85%, lines 85%) — do not
lower it.

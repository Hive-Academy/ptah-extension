# Context

## Where this came from

TASK_2026_293 fixed one symptom — `PreCompact` fanning an empty session id to
the memory curator. When that fix was reported as complete, the user pushed
back:

> "i think allowing having empty string, is causing lots of issue in routing,
> specially when we have interrupted subagents and other parts"

That was correct, and the original TASK_2026_293 analysis was too narrow. Two
audit sweeps (backend and frontend) turned up roughly 35 sites. This is the
parent task for the remediation.

## Why `''` should not exist

Three independent parts of the codebase already say so:

- `AgentProcessInfo.parentSessionId?: string` (`shared/.../agent-process.types.ts:91`)
  and `MonitoredAgent.parentSessionId?: string` — **optional**, so the designed
  representation of "no parent" is `undefined`.
- The branded `SessionId` (`shared/.../branded.types.ts:50-82`) validates against
  a UUID regex; `SessionId.safeParse('')` returns `null` and `SessionId.from('')`
  throws.
- `SessionIdSchema` (`shared/.../branded.schemas.ts:16`) is `z.string().uuid()`.
- `libs/shared/CLAUDE.md` guideline 1: _"Use branded IDs at every boundary —
  never accept bare `string` for a domain ID."_

`''` satisfies none of these and is excluded by all of them. It exists only
because two declarations make it the sole expressible "not known yet":

| Declaration                                                                     | Problem  |
| ------------------------------------------------------------------------------- | -------- |
| `shared/.../execution/stream.ts:68` — `readonly sessionId: string`              | required |
| `shared/.../subagent-registry.types.ts:74` — `readonly parentSessionId: string` | required |

## The two failure grammars

Nearly every finding is one of these:

**1. `''` read as "no filter, apply to all."** `if (!sessionId) { /* global */ }`
is correct for `undefined` and catastrophic for `''`.

**2. `??` treats `''` as present, then truthiness discards it.** `const sid = a ??
b; if (!sid) fail;` — `''` suppresses the fallback _and_ then fails the guard,
so the code takes neither branch it was written for.

Grammar 2 is the direct cause of the user's reported symptom.

## Confirmed origins

| Site                                                          | Note                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `cli-agent-runtime/.../ptah-cli-spawn-options.service.ts:152` | hardcoded literal `createHooks('', cwd)` — human-verified. This produced the log the user reported. |
| `cli-agent-runtime/.../ptah-cli-spawn-options.service.ts:148` | `createHooks(cwd)` with no `parentSessionId` at all                                                 |
| `agent-sdk/.../sdk-query-runner.service.ts:426`               | same omission for `InternalQueryService` one-shots                                                  |
| `vscode-lm-tools/.../stdio-mcp-server.service.ts:310`         | `process.env['PTAH_MCP_HOST_SESSION_ID']` is `''`, not `undefined`, when set-but-empty              |

`sdk-query-options-builder.ts:1199` (`sessionId ?? ''`) was originally blamed and
is **not** a producer — its one caller always passes a non-empty string. See the
correction block in `../TASK_2026_293/context.md`. It does, however, pass a
**tabId** rather than the canonical SDK UUID, so handlers that fall back to the
closure report a different identity than handlers reading `input.session_id`.

## Highest-blast-radius findings

1. **`rpc-handlers/.../chat-ptah-cli.service.ts:243` + `chat-subagent-context-injector.service.ts:122-131`.**
   `path.join(dir, '', file)` collapses silently; the probe returns `false`; the
   caller reads that as "transcript absent" and calls `markAsInjected` +
   `remove`. `markAsInjected` also poisons `clearedToolCallIds`, so history
   re-registration refuses it forever. One bad id on one `chat:continue` makes an
   interrupted subagent unrecoverable for the life of the workspace, with a
   `warn` and no user-visible error.
2. **`cli-agent-runtime/.../sdk-callbacks.ts:161-173`** (human-verified). The
   subagent-registry tabId→UUID remap is nested inside
   `isRegistered(AGENT_PROCESS_MANAGER)` — an unrelated service. Where that is
   absent, every `SubagentRecord` keeps `parentSessionId = tab_N` while
   `chat:resume` queries by UUID. This alone explains "interrupted subagents are
   never offered for resume."
3. **`agent-sdk/.../subagent-hook-handler.ts:205`.** Registration is gated on the
   stale closure id while the authoritative `input.session_id` sits on the same
   object three lines below. A falsy closure drops the registration with a
   `debug` log, killing send-message, stop, background listing and resumption
   for that subagent.
4. **`chat-streaming/.../agent-monitor.store.ts:1321 / :1400 / :1475`**
   (human-verified). Grammar 2. Steering or stopping an interrupted subagent
   fails with "No active session" while a valid session is active.
5. **`chat-streaming/.../agent-monitor.store.ts:904-913` `findReplacementCard`**
   (human-verified). Interrupted card carries `''`, resume spawn carries the real
   UUID, no match, so a **second** card is created and the interrupted one is
   never retired. Same shape as the tribunal tile duplication in TASK_2026_292.
6. **`agent-sdk/.../sdk-permission-handler.ts:974`.**
   `cleanupPendingPermissions('')` takes the global branch and denies every
   pending permission process-wide, delivering a spurious user-refusal to
   unrelated live sessions.

## Plan

**Wave 1 — behavioural fixes, five disjoint file sets, in parallel.** Semantics
first: make every consumer state whether "no id" means all, none, or fall back —
explicitly, not as a side effect of falsiness. Regression spec per fix.

| Owner | Boundary                                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | `libs/backend/agent-sdk/**` — hook-handler resolution, the registration gate, permission cleanup, transformer precedence, metadata store guard              |
| B     | `libs/backend/cli-agent-runtime/**` — the two literal origins, the nested remap guard, registry permission routing, persistence drop                        |
| C     | `libs/backend/rpc-handlers/**`, `vscode-core/**`, `vscode-lm-tools/**` — the destructive resume-state loss, the "`''` = all" filters, MCP spawn attribution |
| D     | `libs/frontend/**` — the `??` guards, the `??` downgrades, `findReplacementCard`, the contradictory predicates, the `SessionId.from` throw, the leaks       |
| E     | `libs/backend/memory-curator/**`, `skill-synthesis/**` — coalescing-key collision, un-drainable rows, trigger guards                                        |

**Wave 2 — remove the reason to mint `''`.** (Originally written as "make `''`
unrepresentable". That was wrong and is corrected in the Wave 2 outcome below:
`?: string` still admits `''`. What it removes is the forcing function.) Widen
`FlatStreamEvent.sessionId` and
`SubagentRecord.parentSessionId` to `?: string`. Deliberately sequenced _after_
Wave 1: doing it first would put five agents into the same compile-error surface
at once, and by the time consumers already handle absence the type change is a
simplification rather than a rewrite. The compiler then becomes the regression
test for the whole class.

Wave 2 also revisits the ~25 `|| ''` emit sites in the message transformers,
which cannot be cleaned while the target field is a required `string`.

Added to Wave 2 scope during Wave 1:

- `memory-contracts/.../compaction-callback.port.ts:4` declares `sessionId:
string` with no non-empty guarantee, so the port permits exactly what the
  curator now has to tolerate at runtime. Tightening it makes the guarantee
  explicit instead of incidental, and is the same shape of change as the two
  declarations above.
- The `skillSynthesis` RPC entry points want the `.min(1)` + reserved-id check
  that `MemoryRunNowParamsSchema` already applies on the memory side.

## Wave 1 outcome

Five agents, disjoint file boundaries, one working tree. Consolidated
verification run by the coordinator after all five reported:

| Gate                      | Result                               |
| ------------------------- | ------------------------------------ |
| `typecheck` × 16 projects | clean                                |
| `lint` × 15 projects      | 0 errors (warnings all pre-existing) |
| backend tests             | 6,570 passing across 7 libs          |
| frontend + shared tests   | 3,008 passing across 8 libs          |

One rpc-handlers test failed on the first parallel sweep and did not reproduce
in either an isolated rerun or a second `--skip-nx-cache` parallel run. Treated
as worker-contention flake, not a cross-batch break — but recorded here rather
than swallowed.

### Instructions from the brief that turned out to be wrong

Four of the five agents pushed back on something the coordinator specified, and
in each case they were right. Recorded because the corrections are more durable
than the fixes:

1. **"Pass the parent session id into `createHooks('', cwd)`"** — wrong. That
   parameter names a **transcript file** (`memory-curator.service.ts:100` →
   `path.join(sessionsDir, sessionId + '.jsonl')`). The parent's id would make
   the curator read the _parent's_ conversation and curate it as the child's:
   silent wrong data, worse than warn-and-skip. What the parameter wants is the
   agent's **own** session id — known on resume, genuinely unknowable on a fresh
   spawn.
2. **"The SDK payload id is authoritative"** — only sometimes. For harness and
   wizard streams the caller id is a `HarnessStreamId` / `WizardPhaseId`, the
   routing key the frontend subscribed with, which no SDK payload carries.
   Following the instruction would have misrouted those surfaces. The real
   defect was `activeIds[0]` sitting second instead of last.
3. **"`stop-hook-handler` is an already-correct twin"** — no. Its guard sat
   _between_ two fan-outs, so the bus emit was gated and
   `StopCallbackRegistry.notifyAll` was not. Two existing specs were pinning
   the leaky behaviour.
4. **"`TrajectoryExtractor.extract('')` mitigates the queue collision"** — no.
   `extract` short-circuits on `transcriptPath` and never reads `sessionId` on
   that branch, so `''` reached `queue.enqueue`. The `UNIQUE(session_id, stage)`
   collision was live, not latent.
5. **"`extractCallerSessionId` can yield `''`"** — refuted. `[^/?]+` requires at
   least one character. The misattribution half was real, but belonged to the
   producer (`sdk-query-options-builder.ts:1138`), not the consumer.

### Design decisions worth keeping

- **`hook-session-resolver.ts`** (agent-sdk) — one definition of the rule for
  twelve handlers. It returns `null`, never `''`, so a caller cannot publish
  "no id" by accident; it has to write an `if`. The table-driven spec drives all
  seven previously-unguarded handler classes through it, so a handler added
  without the rule fails there.
- **`session-scope.ts`** (frontend) — `knownSessionId` at every write boundary,
  `agentVisibleInSession` at every session-scoped read. An **absent** owner is
  visible everywhere, because an unattributed agent that renders nowhere is an
  agent nobody can steer or stop. Destructive per-session operations
  deliberately stay on strict equality: "visible here" must not mean "deletable
  from here".
- **Tri-state transcript probe** (rpc-handlers) — `'present' | 'absent' |
'indeterminate'`, because the errors are asymmetric: `'absent'` is permanent
  (it sets the `markInjected` poison flag) and `'indeterminate'` self-heals.
  `'indeterminate'` also does not consume an injection attempt, so the retry cap
  cannot burn a record that was never verifiable.
- **Paired isolation specs** (rpc-handlers) — every "empty id must not act on all
  sessions" assertion has a sibling asserting the legitimate path still works, so
  no guard can later be "fixed" by making the method inert.
- **`removeSupersededInterrupted` now matches on parent too**, choosing to miss a
  supersede rather than risk a wrong delete: a missed supersede is retired by the
  attempt cap, a wrong delete is permanent.

### Found along the way, unrelated to this task

`libs/frontend/chat/jest.config.ts` allowed only `.mjs` through
`transformIgnorePatterns`. `marked` ships ESM from a `.js` file, so it was never
transformed and **no component reaching `ngx-markdown` could be rendered in a
spec at all** — which is why the agent-monitor panel had only pure-function
coverage. Fixed as part of writing the panel scope specs.

## Wave 2 outcome

Single owner, because the compile fallout crosses lib boundaries by design.
Verified independently by the coordinator: 16 projects typecheck clean, 16 test
suites pass — 6,571 backend and 3,263 frontend + shared, **9,834 passing**.

(The Wave 1 figure of 3,008 for frontend + shared recorded above was a
coordinator error: it omitted `chat-state`'s 241 from a truncated output tail.
Nothing was lost between the waves.)

### The premise of this wave was wrong, and the correction is load-bearing

**`?: string` does not make `''` unrepresentable.** `''` is a `string` and
remains assignable. What the widening removes is the _forcing function_ — the
reason a producer had to invent a value for a field it could not fill.

This matters operationally: `knownSessionId`, the `EventDeduplicationService`
guards and `beginTeardown`'s empty check are **still load-bearing** and must not
be deleted as dead code in a future tidy-up. They sit at boundaries the type
still admits `''` through — bare-`string` parameters and values off the wire.
Their signatures were widened to `string | undefined` and their docs rewritten
to say _absent_ rather than _`''`_, so they read as absence-handling rather than
empty-string folklore.

Genuine unrepresentability needs a branded or template-literal type on those
fields. Recorded as follow-up, not done here.

### Three declarations changed, not two

The third was `SubagentRecord.sessionId` (`subagent-registry.types.ts:44`), and
it was **deleted rather than widened**. It carried an `@deprecated … redundant`
note; a read-site audit found exactly one read repo-wide — a log line that
prints `parentSessionId` on the following line. It was also actively harmful:
`resolveParentSessionId` rewrites `parentSessionId` when a tabId is swapped for
the resolved UUID and deliberately leaves `sessionId` stale, making the field a
live stale-identity trap of the kind this task exists to remove.

Compile fallout from the two prescribed widenings was **4 production files in 2
libs** — small precisely because Wave 1 had already taught every consumer to
handle absence. Total surface across all Wave 2 work: 47 files.

### A live defect found inside the Wave 1 fix

`system-message.transformer.ts` (×4) had
`sessionId ?? (msg.session_id as SessionId)`. `SdkMessageTransformer.transform`
already resolves the id off that same object and correctly rejects `''` — and
this `??` pulled the rejected payload id straight back in. Failure grammar 2,
surviving inside the fix for failure grammar 2.

Two further reads had genuinely no id available and were made explicit rather
than given an invented fallback: `routeBackgroundEvent` (looked a background tab
up _by_ session id with no session id — now returns "not routed" so the caller
warns and drops) and `isInTeardown` (a record with no known parent cannot be in
a specific session's teardown window — `false` is the answer, not a gap).

### Two review findings were partly refuted, with a better diagnosis

Both reviewers reported that `agent-monitor-panel` never calls
`agentVisibleInSession` and that `chat-view.component.ts:483` bypasses it. Both
are wrong: the panel calls it via `store.workflowSubagentsForSession`, and the
comment at `chat-view:473-476` concerns the _agent's owner_, which is routed
through the helper one line later.

The real defect: **`agentVisibleInSession` modelled one of two axes.** It took
the agent's owner but its viewer parameter was a required `string`, so it could
not express "this tile's own session is unresolved" — and three callers
hand-rolled three different answers for that axis. The fix folds the viewer axis
into the single definition (`sessionId: string | null | undefined`), deleting
all three hand-rolled pre-checks. `onClearCompleted` deliberately stays on
strict equality, per the Wave 1 destructive-operations rule.

### The permission-timeout regression

Wave 1 made a CLI-agent-routed permission request _routable_, which was correct
— but routability also selected the timeout window (`timeoutAt = isRoutable ? 0
: …`), so those requests went from a bounded 60s auto-deny to an **unbounded**
wait. The only surviving net caught transport failure, not the application-level
drop in `AgentMonitorStore._pendingPermissionBuffer`, which has no TTL.

Fixed structurally rather than by bolting on a second rule — a second rule is
how route and window drifted apart in the first place. `isRoutablePermissionRequest`
became `classifyPermissionRoute`, returning route **and** window together:
webview unbounded (unchanged), CLI-agent bounded at 10 minutes, none 60s
(unchanged). The Wave 1 invariant that 60s must not auto-deny a CLI prompt is
still pinned, and a new spec pins the bug itself.

### Specs

Zero deleted. Four adapted, two of them _inverted_ because they pinned the exact
coercion this wave removed — one carried a comment saying it held only "until
that type is widened (Wave 2)". Three added, including `session-scope.spec.ts`
pinning both axes at the definition.

## Remaining follow-up

1. **`MemoryExtractedPayload.sessionId: string`** (`shared/.../messages/memory.ts:46`)
   is a _third_ required declaration of the same shape, and the last thing
   forcing `?? ''` anywhere in the repo (`cli-engine/.../wire-thoth-push-bridges.ts:46`,
   `thoth-runtime/.../boot-thoth-runtime.ts:190`). Pairs with the
   `memory-contracts/compaction-callback.port.ts:4` item below — same change,
   same lib pair.
2. **Zod at the two unvalidated entry points** — `agent:resumeCliSession`
   (`agent-rpc.handlers.ts:743`) and `chat:subagent-query`. Both take input from
   the frontend with no runtime validation, despite `rpc-handlers/CLAUDE.md`
   requiring it. This is the durable boundary fix: it makes the class
   unrepresentable at the door rather than caught by twenty guards downstream.
3. **A shared blank-id primitive.** The style review found "blank means absent"
   hand-rolled 8 ways across 10 files. Deliberately deferred past Wave 2 because
   the widening was expected to shrink that surface; re-audit before sweeping.
4. **`SessionId.safeParse` / `validate` take a required `string`.** Widening to
   `string | undefined` returning `null` would delete a ternary at
   `streaming-handler.service.ts:126`. Small and broadly useful.
5. **Branded or template-literal types** on the three widened fields, if genuine
   unrepresentability is wanted.
6. `agent-monitor.store.ts` is now ~1,610 lines against a 700 soft ceiling and
   owns three responsibilities that would pass the facade-rule nameability test
   if split. For whoever next touches that file.

## Open question deferred to Wave 2

The chat-path closure id is a **tabId**, not the canonical SDK session id, so a
single turn emits some hook payloads keyed by `tab_N` and others by the SDK
UUID. Consumers that key state by the reported id (skill-synthesis `sessions` /
`turnCompleteStates`, memory-curator `sessions` / `episodes`) can hold two live
entries for one session, and an idle timer registered under `tab_N` is never
cleared by the `SessionEnd` payload arriving under the UUID. This is a real
identity bug independent of `''` and is not in Wave 1's scope.

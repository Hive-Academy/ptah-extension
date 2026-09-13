# Code Style Review — `TASK_2026_433` Batch B4b

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 2                                     |
| Minor issues    | 2                                     |
| Files reviewed  | 4 (2 modified prod, 1 modified spec, 1 new spec) |

Scope: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (+`.spec.ts`), `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`, `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.list-rows.spec.ts`. Verified against `batches.md` Batch B4b (Tasks 4b.1, 4b.2) and `implementation-plan.md:174-190`. Both affected projects' filtered test runs are green (rpc-handlers: 1 suite/3 tests; cli-agent-runtime: 4 suites/136 tests, `--skip-nx-cache`).

## Five style questions

### 1. What breaks in six months?

The `roleChannel: 'system-prompt'` literal for ptah-cli list rows
(`agent-rpc.handlers.ts:846`) has no single source of truth — it is typed by
hand here, and `batches.md:397` already plans a SECOND independent
`roleChannel: 'system-prompt'` literal at the B5a namespace-builder call site.
When B8 (native role delivery, deferred) changes how ptah-cli delivers a role,
or a future ptah-cli variant gets its own channel, there is no compiler or
grep-one-place mechanism forcing both sites to move together — only tribal
knowledge of "grep for `'system-prompt'`".

### 2. What would a new team member misread?

`spawnFromSdkHandle`'s three independent `meta.role !== undefined` /
`meta.roleDelivery !== undefined` / `meta.roleChannel !== undefined` spreads
(`agent-process-manager.service.ts:611-617`) read as if the three fields are
independently optional, but the domain invariant (established by `doSpawnSdk`'s
single `roleDefinition ? {...} : {}` guard at `:493-499`) is that they are
always set or unset TOGETHER — a role name implies a delivery and a channel.
A reader skimming `spawnFromSdkHandle` in isolation has no way to know that
"role without roleChannel" is not a valid state the type system happens to
allow.

### 3. What does this cost to maintain?

Every future caller of `spawnFromSdkHandle` (there is already one more planned
in B5a) must remember to pass all three role fields together by convention;
nothing enforces it. `doSpawnSdk`'s growing positional-parameter list (now 9,
with `roleChannel` wedged in at position 7) also costs a re-count of positions
at every future signature change, where the sibling method in the same class
already solved the same problem with a `meta` options object.

### 4. Where is this inconsistent with the rest of the repository?

- Every other `roleChannel` value in the diff and its neighbors is read from a
  single owning source: `adapter.roleChannel` on the six `CliAdapter`
  implementers (`cli-detection.service.ts:105,132`, `agent-process-manager.service.ts:453`).
  `agent-rpc.handlers.ts:846` breaks that pattern because ptah-cli has no
  `CliAdapter` instance to own the constant — it is a `PtahCliRegistry`
  concept, not a `cli-adapters/**` one — so the literal is hand-typed instead.
- `doSpawnSdk`'s positional-parameter growth vs. `spawnFromSdkHandle`'s `meta`
  object, both in the same class (`agent-process-manager.service.ts:463-473`
  vs. `:558-588`).
- The three-separate-conditional field copy in `spawnFromSdkHandle`
  (`:611-617`) and in `trackSdkHandle`'s `spawnResult` (`:756-762`) vs. the
  single bundled conditional in `doSpawnSdk`'s `info` (`:493-499`) — the same
  "copy these three related optional fields" problem solved two different ways
  15-250 lines apart in one file.

### 5. What would you have done differently, and why is that better rather than merely other?

Export one `PTAH_CLI_ROLE_CHANNEL: AgentRoleChannel = 'system-prompt'` constant
(e.g. from `cli-agent-runtime`'s `roles/index.ts` or a `ptah-cli` barrel) and
import it at both the B4b list-row site and the B5a namespace-builder site,
rather than typing the string literal twice. This is strictly better than a
second hand-typed literal because it makes "ptah-cli's channel is
system-prompt" a fact stated once, checked by the compiler at every read site,
and it costs nothing here — the batch already imports
`AgentRoleChannel`/`AgentRoleDelivery` as types from `@ptah-extension/shared`,
so a sibling value constant is a one-line addition, not a new dependency.

## Blocking issues

None.

## Serious issues

### No single source for the ptah-cli `roleChannel` literal

- File: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:845-846`
- Problem: `roleDelivery: 'preamble', roleChannel: 'system-prompt'` are typed
  literals with no shared constant behind them. Confirmed by search: no
  `PTAH_CLI_ROLE_CHANNEL`-style export exists anywhere in
  `cli-agent-runtime`, `rpc-handlers`, or `vscode-lm-tools`
  (`grep -rn "'system-prompt'"` finds only this line plus its own spec
  assertion and the two spec fixtures added by this batch). `batches.md:397`
  (B5a, PENDING) plans a THIRD, independently hand-typed occurrence of the
  same literal at `agent-namespace.builder.ts`.
- Tradeoff: today this is harmless — it exactly matches the plan's contract
  (`implementation-plan.md:181`, `batches.md:371`) and the actual delivery
  channel (`ptah-cli-spawn-options.service.ts` appends the role block to the
  system prompt, per Task 4a.2). But two hand-typed copies of a fact that must
  stay true together is exactly the shape that drifts silently: nothing fails
  loudly if B5a's copy is typed `'task-prompt'` by a slip, since both are
  valid members of the same union.
- Recommendation: before or alongside B5a, add one exported constant for
  ptah-cli's role channel and import it at both call sites. Not blocking for
  B4b alone since it matches the plan exactly, but it should not ship a third
  time in B5a without this fix — flag it now while there is still only one
  occurrence to consolidate from.

### Inconsistent conditional-spread idiom for the same three-field copy

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:493-499` vs. `:611-617` and `:756-762`
- Problem: `doSpawnSdk`'s `info` literal gates all three role fields behind
  ONE conditional (`...(roleDefinition ? { role: ..., roleDelivery: 'preamble' as const, roleChannel } : {})`),
  making "all three or none" a structural guarantee. `spawnFromSdkHandle`'s
  `info` literal and `trackSdkHandle`'s `spawnResult` literal instead gate
  each of the three fields independently
  (`meta.role !== undefined ? {...} : {}`, `meta.roleDelivery !== undefined ? {...} : {}`,
  `meta.roleChannel !== undefined ? {...} : {}`), which types-permit (and
  silently accept) a caller passing e.g. `roleChannel` without `role`.
- Tradeoff: the independent-conditional style is defensible when copying from
  an already-stamped `AgentProcessInfo` (`trackSdkHandle`, `:756-762`), where
  the three fields were already stamped atomically upstream and per-field
  checks are just null-safety. It is not defensible for `spawnFromSdkHandle`'s
  `meta` parameter (`:585-587`), which is a fresh call-site-supplied object
  with three independently optional properties and no type-level tie between
  them — exactly what B5a's next caller (`batches.md:397`) will construct
  by hand.
- Recommendation: narrow `spawnFromSdkHandle`'s `meta` role fields to a single
  optional nested shape (e.g. `role?: { name: string; roleDelivery: AgentRoleDelivery; roleChannel: AgentRoleChannel }`)
  or an `AgentRoleDefinition`-driven parameter mirroring `doSpawnSdk`, so the
  three-fields-together invariant is enforced by the type checker instead of
  by convention. Worth doing before B5a adds its own caller of this method.

## Minor issues

- `doSpawnSdk`'s positional parameter list grows from 8 to 9
  (`agent-process-manager.service.ts:463-473`), with the new required
  `roleChannel` wedged before the two trailing optional parameters
  (`binaryPath?`, `mcpPort?`) — TypeScript requires this ordering, so the
  insertion point itself isn't a choice, but the method is now long enough
  (and has same-type neighbors like `displayName`/`binaryPath`, both bare
  `string`) that its own sibling `spawnFromSdkHandle` (`:558-588`) already
  shows the better pattern (one `meta` object) for the same class. Single
  call site (`doSpawn`, `:446-456`), so the refactor is low-risk whenever it
  is taken up — not blocking for a field-only plumbing batch.
- `AgentProcessManager` (`agent-process-manager.service.ts`) is now 2366
  lines (`wc -l`), up from a pre-batch ~2334 already flagged in
  `batches.md:58` as a LOW, accepted risk ("manager adds fields only, no new
  methods"). That holds here — this diff adds zero new methods, only
  parameters/fields, consistent with the plan's stated mitigation. A
  facade-rule extraction is not warranted by this batch alone; it is a
  separate task if and when the file gains actual new methods rather than
  fields.

## File-by-file

### agent-process-manager.service.ts

Score 7/10 — 0 blocking, 2 serious (shared with rpc-handlers/spec above), 1
minor. Field additions are precisely typed (`AgentRoleChannel`,
`AgentRoleDelivery` imported as types, never widened to `string`), no adapter
branches on CLI name, `wiring/agent-events.ts` correctly untouched, zero new
explanatory comments. The two serious findings are both about internal
consistency of the copy idiom, not correctness (confirmed by 136/136 green
tests in the filtered run).

### agent-process-manager.service.spec.ts

Score 8/10 — 0/0/0. New `describe('role plumbing', ...)` block matches the
file's existing per-feature `describe` convention, exercises `doSpawn`,
`spawnFromSdkHandle`, the `agent:spawned` event payload, and the result
object; role-less spawns are asserted to carry none of the three fields via
`not.toHaveProperty`, which is the right check for optional-field-omission
(a `toMatchObject` would not have caught an accidental `undefined`-valued
key). The `roleChannel: 'developer-instructions'` literal added to
`createSdkAdapter`'s fake (line 227) matches Task 4b.1's own validation note.

### agent-rpc.handlers.ts

Score 6/10 — 0 blocking, 1 serious (the `'system-prompt'` literal, above), 0
minor beyond it. List-row stamping only, as the batch contract requires — no
new RPC method, no `rpc.types.ts` or `ALLOWED_METHOD_PREFIXES` touch. The
stray blank-line removal before the closing brace (diff hunk at end of file)
is a no-op formatting tidy, not a content change.

### agent-rpc.handlers.list-rows.spec.ts

Score 8/10 — 0/0/0. Naming (`agent-rpc.handlers.list-rows.spec.ts`) matches
the sibling `agent-rpc.handlers.resume-parent-session.spec.ts` convention
exactly. Harness construction (three `jest.mock` calls for
`cli-agent-runtime`/`agent-sdk`/`auth-providers`, `createMockRpcHandler`,
`createMockLogger`, direct `new AgentRpcHandlers(...)` with the same
constructor argument order) is a faithful copy of the sibling harness — this
per-file harness duplication is this codebase's established convention, not
new debt. Three cases cover: role fields stamped on ptah-cli rows,
system-CLI rows passed through `toEqual` (proving no accidental extra
fields), and disabled/keyless agents omitted. Confirmed green:
`nx run @ptah-extension/rpc-handlers:test --testPathPatterns="agent-rpc.handlers.list-rows" --skip-nx-cache` → 1 suite / 3 tests passed.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No branching on CLI name for role wiring | PASS | No new `if (cli === ...)` / `switch (cli)` added in either prod file; `mergePtahCliAgents` enriches an already-ptah-cli-only array, not a name branch |
| `roleChannel` sourced from `adapter.roleChannel` where an adapter exists | PASS (adapters) / FAIL (ptah-cli) | `agent-process-manager.service.ts:453` reads `adapter.roleChannel`; `agent-rpc.handlers.ts:846` hand-types the literal because no adapter object exists for ptah-cli — see Serious finding |
| `AgentRoleChannel`/`AgentRoleDelivery` not widened to `string` | PASS | `agent-process-manager.service.ts:51-52` imports both as types from `@ptah-extension/shared`; every field declared with the literal union type, never `string` |
| Zero explanatory comments (repo-wide convention) | PASS | No new comment lines in the diff; pre-existing docblocks (e.g. the TASK_2026_402 `agentId` note) are unmodified context, not additions |
| `wiring/agent-events.ts` untouched (batch default, `batches.md:16`) | PASS | Not present in `git diff --stat`; event payload reaches the webview unchanged per the pre-existing whole-object broadcast |
| Spec file naming matches sibling per-feature `.spec.ts` files | PASS | `agent-rpc.handlers.list-rows.spec.ts` matches `agent-rpc.handlers.resume-parent-session.spec.ts` |
| `catch (error: unknown)` at boundaries | PASS | `mergePtahCliAgents`'s existing bare `catch {}` (unchanged by this diff) degrades to `cliResults` per D8's contract; no new catch blocks added |
| File-size soft ceiling (700 lines, facade rule past 1000) | NOT_APPLICABLE (this batch) | `agent-process-manager.service.ts` is 2366 lines; batch adds fields only, no new methods — consistent with the accepted risk in `batches.md:58` |

## Maintenance debt

- Introduced: three role fields threaded through two more copy points
  (`spawnFromSdkHandle`, `trackSdkHandle`'s `spawnResult`) using a
  looser-than-necessary independent-optional idiom; one more hand-typed
  `'system-prompt'` literal with a second one already planned in B5a.
- Retired: nothing.
- Net: small negative — the batch is functionally correct and narrowly
  scoped as instructed, but it grows the number of places that must agree on
  ptah-cli's role channel from one (none existed before) to two occurrences
  with a third already planned, without adding the constant that would keep
  them in sync.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the `'system-prompt'` literal duplication has no compiler-enforced
  tie between its (soon to be three) occurrences, and `spawnFromSdkHandle`'s
  independent per-field optionality lets a future caller construct an
  incoherent partial-role record that `doSpawnSdk`'s stricter pattern in the
  same class already prevents.
- What a 10/10 version would do differently: (1) a single exported
  `AgentRoleChannel` constant for ptah-cli, imported wherever the literal is
  needed instead of retyped; (2) `spawnFromSdkHandle`'s `meta` role fields
  expressed as one optional nested object (or reuse `AgentRoleDefinition` +
  `roleChannel`) so "all three or none" is a type-level guarantee matching
  `doSpawnSdk`'s existing pattern in the same file.

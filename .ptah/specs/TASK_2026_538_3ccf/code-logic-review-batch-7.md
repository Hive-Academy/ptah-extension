# Code Logic Review — `TASK_2026_538_3ccf` Batch 7

Scope: Tasks 7.1-7.3 (`SURFACE_UPDATED` constant, `SurfaceUpdatedPayload` + `MessagePayloadMap` entry, `'surface:'`
prefix in `ALLOWED_METHOD_PREFIXES`), risk R1, and the team-leader's open point about the `DASHBOARD_SPEC_PROPOSED`
doc comment. Implemented by CLI lane codex (`batch-7-report.md`).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment           | APPROVED                             |
| Blocking issues      | 0                                    |
| Serious issues       | 0                                    |
| Moderate issues      | 1                                    |
| Failure modes found  | 0 (pure contract batch; see below)   |

## Five logic questions

### 1. How does this fail silently?

Nothing in this batch is wired to a runtime path yet — it is three additive, non-executable contract changes (a
string constant, a plain interface, one array entry). There is no code here that can produce a success-looking
result from a failure, because nothing yet calls `RpcHandler.registerMethod('surface:...', ...)` or constructs a
`SurfaceUpdatedPayload` at runtime. The one place a silent-failure risk could hide — the widened
`ALLOWED_METHOD_PREFIXES` accidentally letting an unregistered `surface:*` call through — does not apply: traced
`rpc-handler.ts:194-209`, `handleMessage` looks up `this.handlers.get(method)` and returns an explicit
`{ success: false, error: 'Method not found: <method>' }` when nothing is registered. The prefix array
(`rpc-handler.ts:44-91`) gates only `registerMethod`, not `handleMessage`. A `surface:*` RPC call today gets a loud,
explicit "Method not found" error, not a silent no-op or a false success. Confirmed empirically:
`rpc-allowlist.spec.ts` (rpc-handlers project) passed 8/8 with the new prefix present and no registry/manifest
entries added, which is exactly the asymmetry the spec is built to allow (it only checks that every *registered*
method's prefix is present in the array, never the reverse).

The one comment-level "silent" issue is documentation, not logic: `message-constants.ts:170-172`'s new
`DASHBOARD_SPEC_PROPOSED` doc says the message is "No longer posted to webviews since TASK_2026_538" and
`message-constants.ts:175`'s `SURFACE_UPDATED` doc says it is "the one push for surface changes, v1 proposals
included." Both are false right now: `dashboard-namespace.builder.ts:247` still calls
`broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {...})` and no code path emits `SURFACE_UPDATED` yet. See
Moderate issues below — this cannot cause a runtime failure (it is a comment), but it can mislead a later batch's
author into believing dead code exists where live code still runs.

### 2. What user action produces unexpected behaviour?

None reachable from this batch's changes. No UI, RPC handler, or MCP tool consumes `SURFACE_UPDATED` or
`SurfaceUpdatedPayload` yet, and the `'surface:'` prefix has no registered handler behind it, so no user-triggered
call path changes behaviour. The only visible-to-a-developer change is that `RpcHandler.registerMethod` will no
longer throw for a `surface:`-prefixed name in a later batch — correct and intended per R1's plan.

### 3. What input data produces a wrong answer?

Not applicable — no function in this batch parses, transforms or branches on data. The types are structural only.

### 4. What happens when a dependency fails?

Not applicable — no dependency call exists in this batch's diff.

### 5. What is missing that the requirements never mentioned?

Nothing is silently missing: Req 9.1 requires the RPC methods to be declared in `RpcMethodRegistry` and
`RPC_METHOD_ENTRIES` in addition to the `ALLOWED_METHOD_PREFIXES` entry, and Batch 7 deliberately implements only
the third piece, per R1's mitigation (all three plus the manifest land together in Batch 11 to avoid the red window
the risk table describes). That gap is tracked, not silent. The task-description's Req 5.6 ("a receiver that sees a
gap in revisions can then detect it and re-read the state") is satisfied by the payload shape already: see Data flow
below.

## Failure modes

None found that originate in this batch. The batch is non-executable contract surface with no new control flow,
so there is no dependency call, timer, subscription, or async boundary to fail. The residual risk is the
misleading doc comment covered under Moderate issues, which is a maintainability/trust concern rather than a
runtime failure mode.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### `DASHBOARD_SPEC_PROPOSED` / `SURFACE_UPDATED` doc comments assert a fact that is false at this commit

- File: `libs/shared/src/lib/types/messages/message-constants.ts:170-172` (`DASHBOARD_SPEC_PROPOSED`) and `:175`
  (`SURFACE_UPDATED`).
- The `DASHBOARD_SPEC_PROPOSED` comment states, present tense, unqualified: "No longer posted to webviews since
  TASK_2026_538." The `SURFACE_UPDATED` comment states: "the one push for surface changes, v1 proposals included."
  Both describe the Batch 13 end state (task-description.md Req 8.7: "a delivered v1 spec from a caller with a
  routing id shall be recorded in the same store and reach the UI through the same surface push as v2"), not the
  current one.
- Verified the claim is false today: `dashboard-namespace.builder.ts:247` still does
  `broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {...})`, and grepping `libs/backend/vscode-lm-tools/src`,
  `libs/backend/rpc-handlers/src` and `apps` for `SURFACE_UPDATED` outside spec files returns nothing — no
  production code emits it yet. `dashboard-namespace.builder.spec.ts`'s existing assertions on this push are
  unedited and green (per batches.md Batch 2 and Batch 7 verification notes), so the comment and the tested
  behaviour actively disagree for the batches in between (8 through 12 at minimum).
- Impact: low today (nothing in the codebase treats a doc comment as an instruction), but real for a future
  reader — a batch author, reviewer or agent skimming `message-constants.ts` mid-task could conclude
  `DASHBOARD_SPEC_PROPOSED` webview delivery is already dead and skip verifying it, or treat a `SURFACE_UPDATED`
  absence as a defect before Batch 13 lands. Team-leader explicitly asked the reviewer to decide whether it needs
  a qualifier or can stand because the task ships as a whole.
- Recommendation: it should not stand as-is. The task's own batches.md already carries forward-looking language
  correctly elsewhere by naming the batch that will make something true (for example R1's mitigation text). The
  same pattern applies here: reword to something like "No longer posted to webviews once Batch 13 wires the v1
  bridge (until then, `dashboard-namespace.builder.ts` still pushes this message directly); v1 proposals then
  arrive as `surface:updated`." This is a one-sentence fix and does not block Batch 7's acceptance — it is a
  documentation-accuracy finding, not a logic defect, so it is Moderate rather than Serious. Fix in Batch 7's own
  delta (cheapest now) or explicitly hand it to Batch 13 as a cleanup item; either is acceptable, but leaving the
  unqualified wording for 5+ more batches is not.

## Data flow

1. `MESSAGE_TYPES.SURFACE_UPDATED` is defined as the literal `'surface:updated'`
   (`message-constants.ts:176`) — OK, matches `SurfaceUpdatedPayload`'s map key exactly
   (`payload-map.ts:386`).
2. `SurfaceUpdatedPayload` (`payload-map.ts:248-264`) is a plain interface with `routingId`, `surfaceId`,
   `revision`, `origin`, `change: SurfaceChange`, `toolCallId?`, `operationId?` — OK, matches
   implementation-plan.md Component 8 field-for-field, and every field carries a doc comment.
3. `SurfaceChange` is imported with `import type` (`payload-map.ts:130`) from
   `../../../mcp-apps-contracts/surface.types` — OK, erased at compile time, so it adds no runtime import
   regardless of what `surface.types.ts` itself imports.
4. `surface.types.ts` is one of the two entry points the zod-free guard
   (`libs/shared/src/index.zod-free.spec.ts:51-62`) walks by following every relative import and re-export,
   including type-only edges — OK by construction; not re-verified line-by-line here beyond confirming the guard
   test targets this exact file and the batch report records it green.
5. `MessagePayloadMap['surface:updated']` is added beside the sibling `dashboard:spec-proposed` entry
   (`payload-map.ts:386`) — OK, same pattern as `DashboardSpecProposedPayload`.
6. Barrel reachability: `payload-map.ts` → `messages/index.ts:10` (`export * from './payload-map'`) →
   `libs/shared/src/index.ts:10` (`export * from './lib/types/messages'`) — OK, verified by reading both files;
   `SurfaceUpdatedPayload` is reachable from `@ptah-extension/shared` through the same two-hop chain as
   `DashboardSpecProposedPayload`, with no barrel edit needed (both files were already exporting the right
   subpaths before this batch).
7. `'surface:'` is appended to `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:90`) — OK. This array is read only by
   `isValidMethodName` (`rpc-handler.ts:328-330`), called only from `registerMethod` (`rpc-handler.ts:160`).
   `handleMessage` (`rpc-handler.ts:194-209`), the actual per-call dispatch path, never consults this array — it
   looks up a `Map` populated by prior `registerMethod` calls and returns an explicit "Method not found" error
   when nothing is registered. Since nothing in this batch or preceding batches calls
   `registerMethod('surface:...', ...)`, a `surface:*` call today is rejected with a named error, not silently
   accepted or silently dropped. This is the correct, intentional half-step R1 asks for.
8. `rpc-allowlist.spec.ts` (rpc-handlers project) exercises the array from the other side: it asserts every
   *registered* manifest/registry method's prefix is present in `ALLOWED_METHOD_PREFIXES`, never that every array
   entry has a registered method. Ran it directly against this diff: 8/8 pass, confirming the addition is
   inert until Batch 11 adds the registry and manifest entries.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Component 8 (`message-constants.ts`, `payload-map.ts`): `SURFACE_UPDATED` constant and `SurfaceUpdatedPayload` | COMPLETE | Doc-comment accuracy issue above; no functional gap |
| Req 5.6 (push carries routing id, surface id, new revision; gap-detectable) | COMPLETE | `SurfaceUpdatedPayload.routingId/surfaceId/revision` plus `SurfaceChange`'s `ops` variant carrying `fromRevision` (`surface.types.ts:236-243`) together let a receiver compare `fromRevision` to its last known revision and detect a gap, or apply a full `snapshot` state, or handle `deleted`. Nothing further is required of a pure-contract batch |
| Req 9.1 (`surface:*` registered in `RpcMethodRegistry`/`RPC_METHOD_ENTRIES`; `'surface:'` in `ALLOWED_METHOD_PREFIXES`) | PARTIAL (by design) | Only the prefix half is in scope for Batch 7; registry/manifest wiring is explicitly deferred to Batch 11 per R1, and the deferral is verified safe (see Data flow 7-8) |
| R1 (prefix-only in Batch 7; no registry/manifest entry; no `rpc-surface.types.ts`) | COMPLETE | None found — grepped for `RpcMethodRegistry`/`RPC_METHOD_ENTRIES` additions and `rpc-surface.types.ts`; neither exists on this branch yet |

Implicit requirements not addressed: none found beyond the doc-comment issue already raised.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `surface:*` RPC call made before any handler is registered (current state) | YES | `handleMessage` returns explicit `Method not found` error | None — correct fail-loud behaviour |
| Future `registerMethod('surface:foo', ...)` call | YES | `isValidMethodName` now accepts the prefix | Deferred to Batch 11; not this batch's concern |
| `SurfaceChange` reachability without pulling zod into the main barrel | YES | `import type` + zod-free guard on `surface.types.ts` | None — verified by data-flow trace and existing green guard |
| Gap detection on a revision jump | YES | `change.kind === 'ops'` carries `fromRevision`; mismatch vs. receiver's known revision signals a gap | None — contract-level only, no renderer exists yet to consume it |
| `DASHBOARD_SPEC_PROPOSED` doc claim vs. actual runtime behaviour | NO | Comment says "no longer posted"; `dashboard-namespace.builder.ts:247` still posts it | Moderate — see above |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the two stale doc comments in `message-constants.ts` could mislead a future batch author about which
  code path is live; it is a documentation-accuracy defect, not a functional one, and does not block this batch.
- What a robust implementation would add: qualify both doc comments with the batch that makes them true (Batch 13),
  as recommended above; otherwise this batch is exactly the narrow, well-scoped contract addition the plan and R1
  called for, and it is verified safe against the exact mechanism (`ALLOWED_METHOD_PREFIXES` vs. `handleMessage`)
  that would have made a premature prefix addition dangerous.

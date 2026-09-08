# Batch 1, lane C — Task 1.6 report (components 8 + 14c)

**Status**: complete. All work is inside `libs/shared`. Nothing committed.

## Files changed

All paths are in the worktree
`D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.

| Action       | Path                                                        | What it does                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFIED     | `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts`      | Adds `BootPhase`, `BOOT_PHASE_VALUES` (`as const satisfies readonly BootPhase[]`), `isBootPhase`; widens `BootReadinessChangedPayload` with `phase`, optional `detail`, `startedAt`; adds `BootGetReadinessResult = BootReadinessChangedPayload`. Rewrites the payload doc comment so it states `phase`/`detail` are display-only labels with no consumer semantics and the message stays edge-triggered. |
| MODIFIED     | `libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts` | Adds `isBootPhase` accept/near-miss cases, a tuple-completeness assertion, and two payload cases that compile the widened shape against `MessagePayloadMap['boot:readinessChanged']` and assign it to `BootGetReadinessResult`.                                                                                                                                                                           |
| CREATED      | `libs/shared/src/lib/types/rpc/rpc-activity.types.ts`       | `ActivitySource` (10 members), `ACTIVITY_SOURCE_VALUES`, `isActivitySource`, `ActivityLevel = 'info' \| 'warn'`, `ACTIVITY_LEVEL_VALUES`, `isActivityLevel`, `ActivityEventPayload`, `isActivityEventPayload`. File header documents why there is no `'error'` level.                                                                                                                                     |
| CREATED      | `libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts`  | Guard specs: every source accepted, near-misses rejected, `'error'` rejected as a level, minimal valid payload accepted, and rejection of unknown source, missing/non-string summary, missing kind, NaN/Infinity/string timestamp, `level: 'error'`, and non-objects. Also compiles the payload against `MessagePayloadMap['activity:event']`.                                                            |
| MODIFIED     | `libs/shared/src/lib/types/messages/message-constants.ts`   | Rewrites the `BOOT_READINESS_CHANGED` doc comment to match the widened payload; adds `ACTIVITY_EVENT: 'activity:event'` beside `SKILL_SYNTHESIS_EVENT`, with a comment pointing at the no-`error` rationale.                                                                                                                                                                                              |
| MODIFIED     | `libs/shared/src/lib/types/messages/message-type.ts`        | Adds `'activity:event'` to `StrictMessageType`.                                                                                                                                                                                                                                                                                                                                                           |
| MODIFIED     | `libs/shared/src/lib/types/messages/payload-map.ts`         | Imports `ActivityEventPayload`; maps `'activity:event'` to it. `'boot:readinessChanged'` mapping is unchanged (the payload interface widened underneath it).                                                                                                                                                                                                                                              |
| ~~MODIFIED~~ | ~~`libs/shared/src/lib/types/rpc.types.ts`~~                | **Reverted — deferred to Batch 3 Task 3.2. See "Deferred to Batch 3" below.** `git diff` on this file is empty.                                                                                                                                                                                                                                                                                           |
| MODIFIED     | `libs/shared/src/index.ts`                                  | `export * from './lib/types/rpc/rpc-activity.types';` beside the readiness export.                                                                                                                                                                                                                                                                                                                        |

## Naming and idiom decisions

- `ACTIVITY_EVENT: 'activity:event'` matches the `namespace:event` shape of its
  neighbours `SKILL_SYNTHESIS_EVENT: 'skillSynthesis:event'` and
  `HARNESS_HEALTH_CHANGED: 'harness:healthChanged'`.
- `index.ts` uses `export *`, not `export type`, matching the adjacent
  `rpc-readiness.types` line — the module exports value tuples and guards
  alongside its types, so a type-only re-export would drop them.
- `'boot:getReadiness'` uses `params: Record<string, never>`, which is what the
  three other no-argument methods in the file (`db:reloadVec`,
  `db:openBindingFolder`) use.

## Deferred to Batch 3 (Task 3.2) — `rpc.types.ts` reverted

The `'boot:getReadiness'` registration was implemented, then **reverted on the
coordinator's instruction**. `git diff libs/shared/src/lib/types/rpc.types.ts` is
empty; the file is back at its committed state.

**Why.** Adding the method to `RpcMethodRegistry` grows `RPC_METHOD_NAMES`, and
`register-rpc-surface.ts:140-142` asserts the RPC manifest is a **total, disjoint
partition** of that set. With no handler, no manifest entry and no `'boot:'` in
`ALLOWED_METHOD_PREFIXES`, the shared-side entry alone breaks two things:
`libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` fails twice ("RPC
manifest is missing an owner for 1 method(s): boot:getReadiness", and the missing
prefix), and the same assertion fires at dev boot. All four sites must land in
one commit, which is Task 3.2's scope.

**What Task 3.2 must re-add.** Three hunks in
`libs/shared/src/lib/types/rpc.types.ts`, verbatim:

1. The import, after the `./rpc/rpc-persistence.types` import block (~`:527`):

   ```ts
   import type { BootGetReadinessResult } from './rpc/rpc-readiness.types';
   ```

2. The `RpcMethodRegistry` entry, immediately above `'db:health'` (~`:2030`):

   ```ts
   /**
    * Pull the current boot readiness. Same shape as the
    * `boot:readinessChanged` push, because a renderer that missed the push —
    * Angular installs its message listener after `did-finish-load`, and a
    * renderer reload gets no replay — must not need a second consumer path.
    */
   'boot:getReadiness': {
     params: Record<string, never>;
     result: BootGetReadinessResult;
   };
   ```

3. The `RPC_METHOD_ENTRIES` key, immediately above `'db:health': true` (~`:3743`):

   ```ts
   'boot:getReadiness': true,
   ```

`BootGetReadinessResult` itself is **already exported** from
`rpc-readiness.types.ts` and from `libs/shared/src/index.ts`, so Task 3.2 needs
no new type — only the registration. Nothing else in this lane depends on
`rpc.types.ts`; the specs that assign to `BootGetReadinessResult` import it from
`rpc-readiness.types.ts` and still compile.

### `RPC_METHOD_NAMES` derivation (verified while the entry was in place)

`RPC_METHOD_NAMES` is `Object.keys(RPC_METHOD_ENTRIES)`, and the file's
`_MissingRpcMethodNames` assertion is a compile-time check that
`RpcMethodName` ⊆ `(typeof RPC_METHOD_NAMES)[number]`. With both hunks present,
`tsc` on the lib was clean — so the pair above is sufficient and the derivation
picks the method up. Task 3.2 does not need to touch `RPC_METHOD_NAMES` itself.

## Deviations from the plan

1. **`ACTIVITY_LEVEL_VALUES` and `isActivityLevel` added** — not named in the
   plan. `isActivityEventPayload` has to validate the optional `level`, and doing
   it inline would have duplicated the tuple that the `'error'`-is-absent
   decision depends on. The tuple also gives the spec a direct assertion that
   `'error'` is not a legal level.
2. **`isActivityEventPayload` admits an _empty-string_ `summary`.** The plan's
   acceptance says it rejects a _missing_ summary, which it does (`typeof
candidate.summary === 'string'` fails for `undefined`). But `batches.md`'s
   edge-case list says "an empty `summary` falls back to the `source` label —
   Task 4.3, 4.4". Rejecting `''` at the gate would make that fallback
   unreachable, so the guard requires the field to be a string and leaves
   emptiness to the renderer. Documented in the guard's doc comment and pinned by
   a spec case. **Task 4.4's owner should keep that fallback.**
3. `kind` is likewise checked as `typeof === 'string'` with no minimum length,
   for consistency with `summary`.

## Verification run

- `npx jest --config libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts`
  → **2 suites passed, 83 tests passed**.
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` → **clean, no output**.
- Both re-run after the `rpc.types.ts` revert: still **83 tests passed** and
  `tsc` still clean.
- Not run, per the lane brief (two other agents share this worktree; the
  team-leader verifies once): `nx`, `npm run typecheck:all`, `npm run lint:all`.
  Nothing was committed and no file outside `libs/shared` was touched.

## Open questions / handoff notes

1. **`'boot:getReadiness'` does not exist anywhere after this batch** — see
   "Deferred to Batch 3" above. Task 3.2 owns all four sites in one commit: the
   two `rpc.types.ts` hunks quoted there, the handler + `static METHODS`, the
   `manifest.ts` partition entry, and `'boot:'` in `ALLOWED_METHOD_PREFIXES`
   (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:44`). Landing any
   subset breaks `rpc-allowlist.spec.ts` and the dev-boot partition assertion.
2. **`startedAt` is required, not optional.** Every producer must supply it,
   including the pull answer for a boot that has already settled — component 9's
   port and component 10's broadcaster need a boot-start instant to read. If no
   host can supply one, the field would have to become optional, which is a
   contract change I did not make unilaterally.
3. **`phase` is required too.** A producer with nothing better to say emits
   `'starting'` (before heavy work) or `'settled'` (after). There is no
   "unknown" member on purpose — a renderer that receives a phase it does not
   recognise degrades via `isBootPhase` returning `false`, which is Task 4.2's
   covered case.

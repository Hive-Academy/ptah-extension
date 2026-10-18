# Batch 2 (AB1) report — shared contracts

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing` (branch
`feat/decision-model-routing`). No git commands were run; no Nx or Jest command was run
(decision #53) — verification belongs to the team-leader.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\lane-outcome.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\utils\lane-family.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\utils\lane-family.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\rpc\rpc-lane-outcome.types.ts`

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\agent-process.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\rpc.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\utils\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\index.ts`

Not touched (owned by other batches): `tsconfig.base.json` (A2/B4 own the alias edits;
AB1 lives entirely inside `libs/shared`, which is already an importable lib),
`.commitlintrc.json` (Batch 1 R-3), any rpc-handlers file (B7 owns the handler, the
manifest entry and `rpc-allowlist.spec.ts`).

## Task 2.1 evidence — lane family and outcome contracts

`lane-outcome.types.ts` (plan SC-1 :77-138, SC-2 :143-155, SC-4 :181-198; part B §1 :120-173
as the canonical field set):

- Const tuples `OUTCOME_TASK_KINDS`, `LANE_FAILURE_CLASSES`, `OUTCOME_ROUTING_SOURCES` and
  their derived types `OutcomeTaskKind`, `LaneFailureClass`, `OutcomeRoutingSource`, plus
  `OutcomeExecutorKind`, `OutcomeFinalReview`, `OutcomeTelemetryJoin`.
- `SUBAGENT_LANE_ID = 'subagent'` and `LANE_DEFAULT_MODEL = 'lane-default'`.
- `LaneOutcomeRecord` with all part B §1 fields, `family: string` **non-null** (decision I2;
  header comment records the split: the SQLite row keeps `family TEXT` nullable, the
  lane-outcomes write-edge Zod schema requires non-empty) and `deliverablesDeclaredAt`
  (finding 4) present.
- `LaneOutcomeSummary = Pick<LaneOutcomeRecord, …>` with the 14 fields named at
  implementation-plan.md:124-126.
- `OutcomeRatio` and `AgentOutcomeSignals` (part B §1 comments preserved: runCount 0 →
  "no data yet", delivered denominator 0 → "no verified runs", reviewPass denominator 0 →
  "not reviewed yet", avgReviseRounds null rule, topFailureClass tie rule).
- SC-2 port `LaneOutcomeReader { recentOutcomes(laneId, window), isPersistent() }` with the
  plan's contract comments (never rejects, [] on failure/unknown lane, 200 ms target,
  readable-store semantics).
- SC-4 port `LaneFailureClassificationInput` (ids/enums/numbers only) and
  `LaneFailureClassifier { classify }` (never rejects; unset decision model → null with
  zero requests; at most one request per call).

`lane-family.ts` (plan SC-5 :216-232): `LaneFamilyInput { cli, ptahCliId?, providerId? }`,
`SUBAGENT_FAMILY = 'claude'`, and `laneFamilyOf` implementing the plan's rule —
providerId for `cli === 'ptah-cli'` (fallback `'ptah-cli:' + ptahCliId`, then `'ptah-cli'`);
else `cli`.

`lane-family.spec.ts`: table-driven `it.each` with a named-tuple `Row` type (house pattern
from `subagent-prompt-cache-ttl.spec.ts:6-14`), 7 rows covering: system cli → itself;
ptah-cli with provider → provider; without provider → `ptah-cli:<id>`; neither → `ptah-cli`;
blank `''` providerId → id fallback; blank `''` ptahCliId → `ptah-cli`. Two more cases pass
`CliDetectionResult` values straight into `laneFamilyOf`, which both proves the SC-5
structural claim ("`CliDetectionResult` satisfies the interface", plan :231) at compile time
and pins the runtime result. One case pins `SUBAGENT_FAMILY`.

`agent-process.types.ts`:

- New type-only import of `OutcomeRoutingSource` / `OutcomeTaskKind` from
  `./lane-outcome.types`.
- `CliDetectionResult.family?: string` — the lane family of the row, computed by the row
  builder (A1b), stamped on outcome records (SC-5).
- `AgentProcessInfo.taskKind?: OutcomeTaskKind` and
  `AgentProcessInfo.routingSource?: Exclude<OutcomeRoutingSource, 'not-routed'>` (SC-6,
  plan :242-246 names both `SpawnAgentRequest` and `AgentProcessInfo`).
- `SpawnAgentRequest.taskKind?` / `SpawnAgentRequest.routingSource?` with the same types;
  the request-side comment records that `routingSource` is never forwarded to the CLI
  (plan SC-6 :240).

Barrels: `lib/utils/index.ts` gains a named export block
(`laneFamilyOf`, `SUBAGENT_FAMILY`, `type LaneFamilyInput`) matching the curated list style
of that file; `src/index.ts` gains
`export * from './lib/types/lane-outcome.types';` beside `agent-process.types`.

## Task 2.2 evidence — outcome-signals RPC types

`rpc/rpc-lane-outcome.types.ts` (plan SC-8 :368-374; part B :175-178): follows the
`rpc/rpc-lane-plan-limits.types.ts` domain-file pattern — a header stating the privacy rule,
a section banner, then params/result.

- `AgentOutcomeSignalsParams { slugs: string[] }` — the `.strict()` Zod schema and the
  ≤ 500 slugs × ≤ 200 chars limits are handler-side concerns (B7), documented in JSDoc;
  shared stays types-only (part B :106 "types only plus the RPC registry entries. No
  logic.").
- `AgentOutcomeSignalsResult { signals: Record<string, AgentOutcomeSignals>; windowDays:
  number; persistent: boolean }` — slug-absent-means-no-data rule and the W = 30-day window
  documented per part B :175-178.

`rpc.types.ts` (following the `agent:getLanePlanLimits` pattern exactly):

- `export * from './rpc/rpc-lane-outcome.types';` beside the existing
  `rpc-lane-plan-limits` re-export (pattern at rpc.types.ts:44 pre-edit).
- `import type { AgentOutcomeSignalsParams, AgentOutcomeSignalsResult }` beside the
  lane-plan-limits import (rpc.types.ts:46-49 pre-edit).
- Registry entry `'agent:outcomeSignals': { params; result }` directly after
  `'agent:getLanePlanLimits'` (rpc.types.ts:1372-1375 pre-edit).
- `'agent:outcomeSignals': true` in `RPC_METHOD_ENTRIES` directly after
  `'agent:getLanePlanLimits': true` (rpc.types.ts:3872 pre-edit).

`AgentOutcomeSignals` is imported from `../lane-outcome.types`, so the RPC result and the
record share one definition (part B :107 "one definition … used by backend and webview").

## Assumptions resolved

- A1 — "capability map" means `RPC_METHOD_ENTRIES`. The plan's cite
  (`rpc.types.ts:4058`, part B :108) is stale; the `'agent:getLanePlanLimits'` pattern has
  exactly two sites today: the registry entry (rpc.types.ts:1372) and the
  `RPC_METHOD_ENTRIES: Record<RpcMethodName, true>` map (rpc.types.ts:3729 declaration,
  entry at :3872), whose own comment (rpc.types.ts:3713-3721) says every registry key must
  appear there. There is no other per-method capability map in shared (method gating lives
  in the rpc-handlers manifest). Result: both sites edited, nothing else.
- A2 — which barrel(s): part B :187-189 says "implementer confirms which". Confirmed:
  `src/index.ts` re-exports `lib/types/*` files directly (:25 `agent-process.types`) and
  `rpc.types` (:16), which itself re-exports the `rpc/` domain files (:44 pattern);
  `lib/utils/index.ts` is a curated named-export list, so `lane-family` needed an explicit
  block there and is then reachable through `src/index.ts:60` (`export * from './lib/utils'`).
- A3 — `windowDays` is typed `number`, not the literal `30`. Part B :176 declares
  `windowDays: number`; the batch text's "`windowDays: 30`" is the semantic value the B7
  handler returns (W = 30 days, part B :177), documented in the result JSDoc. Same reading
  for `signals`: plain `Record<string, AgentOutcomeSignals>` per part B :176.
- A4 — blank strings count as unset in `laneFamilyOf` (see Decision D1).
- A5 — `slugs: string[]` keeps the plan's element type with a `readonly` property modifier,
  matching the house style of `readonly` fields across the RPC type files.
- A6 — the type-only import cycle (`agent-process.types` ⇄ `lane-outcome.types`) is safe:
  both directions use `import type`, so nothing survives to runtime and no module cycle
  exists; scoped compiler diagnostics (below) confirm 0 errors.
- Symbol-collision check: grep over `libs/shared/src` for every new exported name
  (`OUTCOME_TASK_KINDS`, `SUBAGENT_LANE_ID`, `laneFamilyOf`, `AgentOutcomeSignals`, …)
  found no prior use, so the two `export *` barrels cannot shadow or be shadowed.

## Validation notes handled

- Decision I2 (part B field set canonical, `family` non-null): applied — the record takes
  part B §1's full field set with the integrated plan's changes (const tuples, non-null
  `family`, the two constants, the two ports moved in), because the integrated plan wins
  (batches.md:5, part B :111-119).
- No runtime dependencies beyond shared: `lane-family.ts` imports nothing;
  `lane-outcome.types.ts` imports only types from `agent-process.types`;
  `rpc-lane-outcome.types.ts` imports only a type. Every new runtime value
  (const tuples, `SUBAGENT_LANE_ID`, `LANE_DEFAULT_MODEL`, `SUBAGENT_FAMILY`, `laneFamilyOf`)
  lives in shared itself.
- SC-8 host-source guard: `'agent:outcomeSignals'` matches none of the baseline patterns
  `/turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage/i`
  (`host-source-registry.contract.spec.ts:17-21`, applied to `RPC_METHOD_NAMES` at :50-54),
  so no baseline edit and no TASK_2026_610 exception — as the plan states
  (implementation-plan.md:373). Verified by reading the pattern list; no edit made.
- Strict TypeScript: no `any`, no `@ts-ignore`, no `as unknown as` in any file written.
- In-lane verification (allowed — not an Nx/Jest command): scoped TypeScript diagnostics
  over the six changed source files: **0 errors, 0 warnings, coverage clean**.

## Guard-spec list edits: NONE — rule 8 stop-and-report

The R-5 note anticipated two branches; static analysis settles which one applies:

- `deriveRpcSurface` iterates `RPC_HANDLER_MANIFEST`, not `RPC_METHOD_NAMES`
  (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:58-71`). Until
  B7 adds the handler's manifest entry, `'agent:outcomeSignals'` is in `RPC_METHOD_NAMES`
  but in **neither** `registered` nor `excluded`.
- Therefore, after AB1 and until B7 lands:
  - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` — the exact-equality test
    (:206-208) still passes (the derived excluded set is unchanged), but the partition test
    (:210-216, registered + excluded = `RPC_METHOD_NAMES.length`) fails by exactly one
    method. Adding the method to `VSCODE_EXPECTED_ABSENT_METHODS` (:34) would not fix the
    partition test and would break the equality test, so **no list edit is correct**.
  - `apps/ptah-electron/src/di/rpc-surface.spec.ts` — :38 (`registered.length` =
    `RPC_METHOD_NAMES.length`) and :40 (deep equality with sorted `RPC_METHOD_NAMES`) fail
    the same way.
  - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` — the partition test
    (:64-65) fails the same way; its equality test (:60) still passes.
  - The three `surface-composition.spec.ts` files reference no RPC method lists (grep for
    `RPC_METHOD_NAMES`/`registered`/`excluded` hits nothing in them) and AB1 registers no DI
    services, so they are unaffected.
- This is exactly the "spec fails only because no handler exists yet" branch: the dependency
  is registered by batch B7. Per rule 8 and the Task 2.2 note: STOP and report, do not edit
  around it. No guard spec, no manifest, no `expected-resolvable.ts` was touched.
- For the team-leader: run Batch 2's R-5 guard specs **after B7** (or accept the three
  known partition failures in the interim). When B7 adds the manifest entry, the
  served-vs-absent list moves for whichever hosts its `requires` capability switches off —
  that edit belongs to B7's rule-8 pass, not AB1. The same gap makes the manifest totality
  invariant go red until B7 (manifest.ts:14-21 "the union of all entries is exactly
  `RPC_METHOD_NAMES`", asserted in `manifest.spec.ts` and at dev-boot via
  `assertManifestInvariants`, register-rpc-surface.ts:141-143); B7's scoped
  rpc-handlers verify covers those.

## Decisions

- D1 — `laneFamilyOf` treats an empty string as unset for both `providerId` and `ptahCliId`.
  Options: (a) truthy check, `''` falls through to the next key (chosen); (b) `!= null`
  check, `''` becomes a family key (`''` or `'ptah-cli:'`). Evidence: provider ids are
  non-empty when set (`agent-process.types.ts` `providerId` doc, "e.g., 'moonshot',
  'z-ai'"); a `''` family key would silently split a provider's history into a junk group.
  Reversible: one predicate plus two spec rows.

## Verdict

Both tasks implemented in full; shared compiles clean over the changed files; no guard-spec
edit was possible or correct, and the three rpc-surface partition/equality failures that
exist between AB1 and B7 are reported above for the team-leader to schedule with B7.
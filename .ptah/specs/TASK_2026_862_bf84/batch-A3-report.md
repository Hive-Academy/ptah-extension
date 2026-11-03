# Batch A3 report — plan batches 8, 9, 11

Status: COMPLETE (all code and spec edits written; no verification runs — the lane
brief forbids `npm run verify`, `nx`, builds and tests while other lanes change shared
exports. Scoped typecheck/test lands with the team-leader after batches 13/14.)

## Files changed

Batch 8 (lane policy and catalog):
1. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models.ts` — removed `CODEX_LANE_DEFAULT_MODEL`, `CODEX_LANE_FALLBACK_MODELS` and `markCodexLaneDefault`; `codexLaneModels` now maps any server `model/list` entry (relaxed Zod schema: `id`, `model`, optional `displayName`/`isDefault`/`description`/`supportedEfforts`) to `CliModelInfo`, labeling the server default `"(Codex default)"`.
2. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.ts` — removed the dead `case 'ptah-default':` from `modelAdvice`; every source now gets the same advice naming the setting and the spawn request.
3. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-rejection.spec.ts` — new test: no source names "Ptah's lane default" any more.
4. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` — `resolveLaneModel` has no Codex branch: request, then setting, then `{ model: undefined, source: 'cli-default' }`. Signature (incl. `cli`) unchanged for its caller.
5. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.spec.ts` — replaced the "falls back to Ptah's default" test with "passes no model when the request and setting name none" plus a "future model id passes through unchanged" test.
6. `libs/backend/cli-agent-runtime/src/index.ts` — removed the `CODEX_LANE_DEFAULT_MODEL` re-export (was line 51).
7. `libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts` — comment no longer claims a shipped Codex model list; names the app-server `model/list` as the catalog.

Batch 9 (provider entry and discovery):
8. `libs/shared/src/lib/providers/entries/codex-provider-entry.ts` — removed `CODEX_STATIC_MODELS` (7 IDs), the `codexModel()` helper and the `staticModels` field; kept `CODEX_DEFAULT_TIERS` and `pricingModel: 'subscription'` with a dynamic-discovery-only doc.
9. `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts` — imports `CODEX_MIN_SUPPORTED_VERSION` from `@ptah-extension/codex-runtime` as the `/models` client-version floor (newer cached value still wins); removed the `.filter((m) => /codex|gpt-5/i.test(m.id))` — every account model ID now passes through.
10. `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts` — 3 new tests (floor precedence via `models_cache.json`; future ID returned; future visible ID kept in the chat-catalog shape).
11. `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts` — `registerCodexDynamicFetcher` is a cascade: app-server adapter `listModels()` first, account API second, explicit `[]` third (info log). Removed the platform `getCodexModels` step, the static-ID filter and the `staticModels` fallback.
12. `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts` — 3 new tests (adapter catalog incl. future ID; account fallback on empty; empty list when both dynamic sources fail, never a static fallback).

Batch 11 (pricing reason taxonomy and UI):
13. `libs/shared/src/lib/types/rpc/rpc-session.types.ts` — new exported `SessionCostUnavailableReason = 'billing-unknown' | 'rate-missing' | 'usage-incomplete'`; optional `costUnavailableReason` on `SessionStatsEntry` (re-exported through the rpc types barrel).
14. `libs/shared/src/lib/utils/pricing.utils.ts` — `ExactCostResult` gains optional `costUnavailableReason`; every null-cost path now carries one narrow reason (billing-unknown / rate-missing / usage-incomplete); priced results carry none.
15. `libs/shared/src/lib/utils/pricing.utils.spec.ts` — unknown-model expectation updated; new test covers each reason and that a priced result stays undefined.
16. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts` — `sessionStats` carries `costUnavailableReason: 'rate-missing'` only when the lifetime total is null, lifetime coverage is 'none' and the current turn price is null with reason 'rate-missing' (conservative; documented in-code).
17. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts` — removed the `CodexParityGate`/`CodexDevRouteOverride` imports and `scope.register` blocks and the parity `platform` port field; `setup()` lost its `override` parameter.
18. `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts` — new `costUnavailableReason` input; the null-cost branch splits into `data-testid="cost-not-priced"` ("not priced", title: no published rate) vs the original "cost unavailable".
19. `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.spec.ts` — new "not priced" test plus an `it.each` keeping "cost unavailable" for billing-unknown / usage-incomplete / absent.
20. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` — new public `costUnavailableReason` computed from the snapshot (for the template binding another batch owns).
21. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts` — new test pinning the computed passes `rate-missing` through.
22. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts` — new `NOT_PRICED` and `nullCostLabel()`; the compact cost metric's aria label and the inspector tooltip say "Not priced" only for null cost + `rate-missing`.
23. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.spec.ts` — 2 new tests: "Not priced" only for `rate-missing`; "Cost unavailable" kept for `usage-incomplete`.

## Files deleted

1. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-catalog.ts` (alternate `codex debug models` parser; no production caller).
2. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-catalog.spec.ts`.

## Behavior changes

- A Codex lane with no requested model and no setting passes no model to the CLI;
  the CLI picks its own default. A model ID not known to Ptah passes through
  unchanged (request and setting paths) and is never replaced or rejected by a
  Ptah-side list.
- Provider discovery for Codex uses only dynamic sources (app-server `model/list`,
  then the account API). Discovery failure yields an explicit empty list, never a
  seven-ID hardcoded fallback. No name pattern filters future OpenAI model IDs.
- The account `/models` request pins `client_version` to the shared
  `CODEX_MIN_SUPPORTED_VERSION` (0.165.0); a newer cached value still lifts it.
- A null session cost now carries one narrow backend reason. A model that ran
  without a published rate shows "not priced" / "Not priced"; every other null-cost
  cause keeps "cost unavailable" / "Cost unavailable". Tokens always show.

## Tests added or updated

- `lane-spawn-policy.spec.ts`: omitted-model resolution, future-ID pass-through.
- `codex-model-rejection.spec.ts`: no source names a Ptah lane default.
- `codex-home-auth.service.spec.ts`: floor precedence, future-ID pass-through,
  future visible ID in the chat-catalog shape.
- `provider-rpc.handlers.spec.ts`: adapter catalog incl. future ID, account
  fallback, explicit empty on double failure.
- `pricing.utils.spec.ts`: one-reason-per-null-cost taxonomy test.
- `cost-badge.component.spec.ts`: "not priced" vs other reasons.
- `session-stats-summary.component.spec.ts`: computed reason pass-through.
- `session-stats-view.spec.ts`: "Not priced" / "Cost unavailable" split.
- The plan's unit-test ask is covered: future model ID through lane policy and
  provider discovery; omitted lane model → `undefined` (`cli-default`); unknown-model
  pricing → null cost with tokens kept, coverage 'none', reason 'rate-missing' →
  UI "Not priced".

## Remaining references to removed symbols

None in files this lane owns (verified by sweep). Remaining references in other
lanes' files:

- `CODEX_LANE_DEFAULT_MODEL` / `CODEX_LANE_FALLBACK_MODELS` / `markCodexLaneDefault`
  (removed from `codex-app-server-lane-models.ts` and the runtime index):
  - `apps/ptah-electron/src/di/codex-lane-composition.ts:13,183`
  - `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:11,364,400`
  - `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:14,187`
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:56,57,59,206,229`
- `CodexParityGate` / `CodexDevRouteOverride` registrations (removed by the
  codex-runtime lane; this lane cleaned only its own spec):
  - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:9,12,122-126`
- `CODEX_PROVIDER_ENTRY.staticModels` (field removed):
  - `libs/shared/src/lib/providers/entries/codex-provider-entry.spec.ts:5,27,63-64`
    and the seven-ID assertions in that spec (compiles — the field is optional on
    the registry type — but fails at runtime).
  - `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:339`
    reads the field; it now resolves to `undefined` (see open issues).
- `codex-model-catalog` module: no code references remain; only `.ptah/specs/`
  historical documents mention it.
- `CODEX_STATIC_MODELS` and the `codexModel()` helper: no references remain.

## Decisions

- auth-providers imports `CODEX_MIN_SUPPORTED_VERSION` from
  `@ptah-extension/codex-runtime` (alias-only import rule kept). Evidence: the two
  libs already share imports; batch 13 publishes the symbol; the plan names 0.165.0
  as one shared floor. Reversible: the floor is one constant alias.
- `resolveLaneModel` keeps its `cli` parameter. Its only production caller
  (`agent-spawn-environment.service.ts`, not this lane's file) passes it; ESLint
  `args: 'after-used'` does not flag the unused leading parameter.
- `codexLaneModels` stays (not deleted): the lane adapter (batch 7) consumes it and
  its signature is unchanged; only its default/fallback inputs were removed.
  Its per-entry Zod schema is relaxed so any server `model/list` shape maps.
- `CODEX_DEFAULT_TIERS` / `defaultTiers` stay on the Codex entry: unowned consumers
  rely on them (`workspace-provider-profile-resolver.ts:337,343`,
  `tools/mcp-bench/src/memory-skills/labelling/model-panel.ts:16,260-261`,
  `libs/shared/src/lib/providers/index.ts:21`,
  `libs/backend/auth-providers/src/index.ts:114`,
  `codex-provider-entry.spec.ts:76`). The static ID list was the only removed part.
- The dynamic fetcher cascade drops the platform (`modelDiscovery.getCodexModels`)
  step entirely: it would leak other vendors' Codex-named models and re-introduce a
  release-time list; the plan's "Empty catalog on discovery failure" decision makes
  `[]` the honest third step.
- Three narrow null-cost reasons with `rate-missing` winning over cache ambiguity:
  a model with no rate is "not priced" even if the cache tier is also unverified;
  mislabeling that as "usage-incomplete" would hide the missing rate.
- The session-level reason is published conservatively (all-unpriced session and
  current turn `rate-missing`), so a mixed-cause session keeps "Cost unavailable"
  instead of a wrong "Not priced". `SessionStatsEntry.costUnavailableReason` is
  optional, so older producers and snapshots stay valid; the reason survives the
  live-payload parser and the snapshot validator (both verified read-only).
- No dedicated spec for `codex-app-server-lane-models.ts` was created: the file list
  is fixed and the mapping is covered through the fetcher and adapter specs. A
  small unit spec is a cheap follow-up for whoever owns that file next.

## Open issues for other lanes

1. Badge template binding missing (file not in this lane's list):
   `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html:103,315`
   render `<ptah-cost-badge [cost]="totalCost()" [costBasis]="costBasis()" />`.
   Add `[costUnavailableReason]="costUnavailableReason()"` so the in-panel badge
   shows "not priced". The component computed exists and is tested; the compact
   metrics and tooltips already say "Not priced" without the binding.
2. Batch 6/7 must replace `CODEX_LANE_DEFAULT_MODEL` / fallback usage (references
   listed above) with an omitted model, per the plan.
3. `codex-chat-adapter.spec.ts:9,12,122-126` still registers ParityGate /
   DevRouteOverride; its owner must remove the same registrations this lane removed
   from the lifecycle spec.
4. `codex-provider-entry.spec.ts` fails until rewritten: it asserts the seven static
   IDs and `staticModels` contents (`:5,27,34-43,50,63-66,79-83`).
5. Behavioral spec breakage (assert the old default `gpt-6-sol` where the lane now
   passes `undefined`):
   - `libs/backend/lane-routing/src/lib/matrix/seed-matrix.spec.ts:224`
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.settings-routing.spec.ts:216`
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.spec.ts:327`
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts:1067,1116,1141,2453`
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:906,909,921,930,952,975,1009,1021,1030,1051`
   (`gpt-6-sol` inside `codex-model-rejection.*` files stays: it is sample rejection
   text, not default-model behavior.)
6. `workspace-provider-profile-resolver.ts:339` now reads `undefined` from the
   removed `staticModels` field. Its codex validation must move to dynamic catalog
   evidence or default tiers; its owner should confirm the fallback path.
7. `LaneModelSource` still carries the now-unused `'ptah-default'` member
   (`cli-adapter.interface.ts`, not this lane's file; grok uses the type). Removing
   it needs the interface owner.
8. This lane could not run any verification: the brief forbids verify/nx/build/tests
   and `tsc` while other lanes change shared exports (esp. the codex-runtime
   `CODEX_MIN_SUPPORTED_VERSION` publication, batch 13). Scoped checks for
   cli-agent-runtime, auth-providers, rpc-handlers, shared, agent-sdk and chat-ui
   belong to the team-leader after batches 13/14.
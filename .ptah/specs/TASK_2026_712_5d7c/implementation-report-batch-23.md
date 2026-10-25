# Batch 23 implementation report: lane owner discovery reads the owning route/query

Execution: in-process backend-developer subagent (Anthropic family, Claude Opus 5.5). No CLI lane was used. No git mutation and no nx/jest/tsc/lint/build/npm runs. Formatting used the installed Prettier API only.

## Files (all under W = D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e)

- MODIFIED `W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts`
  - `PlanOwnerReadContext.claudeRoute?: ClaudeAccountNamedRoute`. A Claude read target now carries a copy of the certified route next to its `sessionHandle`, so `ClaudePlanUsageReader` takes its Batch 15 named path. That path matches binding and epoch, re-checks the owner before and after, and returns `no-open-session` on a mismatch. A route with no session is the exported `NO_OPEN_SESSION` known status. No other query is ever chosen.
  - New pure helpers: `PlanOwnerSourceBinding` (provider, fingerprint, revision, epoch; no directory), `namedSourceMaterial(source, run)` for route-, revision-, epoch- and run-specific unknown material, and `sameSourceBinding(a, b)`.
- MODIFIED `W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts`
  - `ownerForClaudeLane(account, agentId, route?)`. A known email plus organization gives the same owner whatever the directory (dedup). With a named route, an owner without an email is keyed by route, revision, epoch, run id and agent. The ambient material `run:<agentId>` is unchanged.
  - `LaneOwnerKey.accountRouteFingerprint?` is part of the remembered-owner key, so one named account's remembered owner never answers for another. Unknown owners are still never remembered. The ambient key is unchanged.
- MODIFIED `W/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.ts`
  - `onSystemInit(query, route?)`. It still reads `accountInfo()` once from the lane's own query and passes the route to `ownerForClaudeLane`. The debug log adds only a boolean `named`; no identity or path is logged. A failed or timed-out read still records no owner, so it is never promoted.
- MODIFIED `W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts`
  - New optional constructor dependency `@inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })` typed `DiscoverySessions` (only `find(id)` → `{ accountBinding?, query }`).
  - `sessions()`: a requested session with a named `accountBinding` goes to `namedSession()`. That function reads identity through the session's own query (`ownerForSession(id)`). It accepts the answer only if all of these hold afterwards: the same record, the same non-null query, a binding equal to the one captured, and a known `anthropic` account. In every other case (replaced query/late epoch, changed binding, thrown or email-less read, query closed, non-Claude answer) the owner is unknown, keyed by `namedSourceMaterial(binding, session:<id>)`. The entry is `known` with `service-unavailable` / `no-open-session` plus ledger evidence. It is never live-read, because discovery holds no certified route for that session (see risks).
  - `nativeSession()` (ambient `claude-cli` selected-provider card) now skips any session with a named binding. The ambient card never reads a named account's query. Ambient sessions keep the existing behaviour: first requested session, then the ledger-known one.
  - The missing-email ambient suppression (`verified.size === 1`) counts only ambient verified owners. A named account lives in another directory and no longer vouches for the ambient route.
  - Prettier also re-wrapped several pre-existing one-line `fromSource(...)` calls in `discoverTargets`. This is whitespace only and accounts for part of the 182-line diff.
- CREATED `W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.accounts.spec.ts`. Mocked fixtures only. No `process.cwd()` and no module-namespace `jest.spyOn`.

## Acceptance coverage (spec)

- Known same-owner dedup: one discovery tile for the same identity in two named directories, and the lane resolver gives the same key across `fp-a`/`fp-b`.
- Distinct/unknown separation: two identities plus two email-less routes give four keys, and the unknown keys contain their route. Epoch 1 and epoch 2 email-less lane owners differ.
- No matching query → unavailable: `planOwnerRead` with a route and no session gives `NO_OPEN_SESSION`. A bound session with `query: null` gives a route-specific unknown with `no-open-session`. The ambient card with only a named session gives `no-open-session`, and `ownerForSession` is never called.
- Stale response disposal: a record replaced (new query, epoch 2) during the identity read is discarded, and the owner stays unknown for `fp-a`.
- Failed read never promoted: a thrown discovery read stays a deterministic unknown across refreshes. A failed lane `accountInfo()` records no owner. Unknown owners are not remembered, and remembered owners are keyed per route.
- The ambient observed owner is retained: an unbound native session is still a `read` target with its own `sessionHandle` and no `claudeRoute`.
- No inference: no SDK query is launched, and only existing bounded `accountInfo` and control reads are used.

## DI registration

No new token. `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` already exists and is registered wherever `SDK_SESSION_QUOTA_PROBE` is, because `SessionQuotaProbeService` injects it. Discovery already depends on that probe. The token is injected with `{ isOptional: true }`, a repository precedent (`agent-generation/.../content-generation.service.ts:149`), so existing seven-argument constructions stay valid. `expected-resolvable.ts` needs no change because the service set is unchanged.

## Existing specs that mock changed members (orchestrator should run)

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts` (constructs discovery with seven args; mocks `ownerForSession`/`ownerForClaudeAccount`/`sessionOwners`; covers `nativeSession` and the verified-suppression filter)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.spec.ts` (`ownerForClaudeLane`, `rememberLaneOwner`/`lastLaneOwner`)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts` (`lastLaneOwner`, `planOwnerRead`)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/owner-lifecycle.integration.spec.ts` (lane owner remember/lookup flow)
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.spec.ts` (`onSystemInit`, `ownerForClaudeLane` mock)
- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts` (mocks `lanePlanLimits.onSystemInit`)
- Consumers to typecheck: `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts` (calls `discoverTargets`), and `agent-process-manager.service.ts` / `di/register.ts` / `ptah-cli-registry.ts` (unchanged call shapes, optional params only).
- Suggested command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`

## Diagnostics

`ptah_get_diagnostics` on all five changed files: 0 errors, 0 warnings, coverage clean. One spec type error (`sessionOwners` value shape) was fixed before the final run. Tests have not been executed (orchestrator heavy-check slot).

## Decisions

- Discovery reads the session binding from the lifecycle manager rather than from a new probe method. Options: (a) extend `SessionQuotaProbe.sessionRoute` with the binding (`agent-sdk`, not owned), (b) inject the existing lifecycle token, or (c) do nothing. Evidence: `SessionRecord.accountBinding` is immutable (`session-registry.service.ts:428-452`), and the probe already resolves the same token. Chose (b) as optional. Reversible.
- Named sessions in discovery are listed with no live usage read. Evidence: the certified `ClaudeAccountNamedRoute` cannot be built from the binding (it carries a type-only certification marker, and the record keeps no `runId`/`profileId`/`canonicalConfigDir`). The plan forbids reading through an unvalidated or unrelated query. Fail-closed `no-open-session` plus ledger evidence was chosen. The `planOwnerRead` `claudeRoute` seam turns this into a validated live read once a caller holds the route. Reversible.

## Risks / follow-ups (outside ownership; not edited)

- Wiring: `claude/claude-sdk-lane-runner.ts:138` should call `lanePlanLimits.onSystemInit(sdkQuery, context.named?.route)`. `agent-process-manager.service.ts:2752` should pass `accountRouteFingerprint` for named lane runs. Until then, named lanes use the run-specific ambient material (still unique per run, not shared) and the shared `ptah-cli:claude` remembered-owner key.
- Live named-session usage windows in the dashboard need a certified route source per session, such as a lifecycle or admission accessor. That can be planned with Batches 27/28. Until then, named sessions show the proved owner with ledger evidence and `no-open-session`.
- `lane-limit-lookup.service.ts` (not owned) does not pass `claudeRoute` yet. It is unchanged, and a Claude lane owner with no session still reads `no-open-session`.
- Live named auth/query launch remains fail-closed (D7). Nothing here launches a query.

# Codex plan-limit deadline fix

## Files changed

- `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts:20`: defined the single 12,000 ms Codex deadline beside the 3,000 ms default.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:127-174`: gave each lane its own timer and abort controller. Codex lanes, including Ptah CLI rows routed to `openai-codex`, get 12 seconds; other lanes retain 3 seconds. Explicit `deadlineMs` still overrides both.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:239-266,620-635`: selected Codex provider and detected Codex lane owner sources get 12 seconds; other sources keep 3 seconds. The existing late-owner retention remains.
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:179-190`: dashboard Codex reads get 12 seconds; other provider reads retain 3 seconds.
- Added `.ptah/specs/plan-limits-live-fix/probe/lookup-live.ts` to run the real app-server reference RPCs inside the updated lane lookup. It stubs the VS Code host module because this Node probe runs outside VS Code.

The existing `CodexAccountUsageService` caches successful responses for 30 seconds (`codex-account-usage.service.ts:26,160-163,202`). `PlanUsageService` also caches completed owner readings for 30 seconds (`plan-usage.service.ts:81,179-185,366`). Thus a successful five-second read is retained for subsequent dashboard and agent-list calls; no additional cache was needed. Existing discovery logic retains a Codex owner completed after a timed-out source for the next refresh (`plan-limit-owner-discovery.service.ts:197-199,456-460`).

## Tests added

- `lane-limit-lookup.service.spec.ts:153`: Codex succeeds after five seconds while another lane reaches its three-second timeout.
- `plan-limit-owner-discovery.service.spec.ts:680`: selected and detected Codex-home sources retain a five-second owner resolution.
- `plan-limits-snapshot.service.spec.ts:213,243`: a five-second Codex dashboard read succeeds and a non-Codex read still times out at three seconds. The existing push test now expects the Codex result after five seconds.

## Live result

`npx tsx --tsconfig tsconfig.base.json .ptah/specs/plan-limits-live-fix/probe/lookup-live.ts` completed in 4,282 ms: `lookup: ok`, `status: available`, one weekly window at 20% used. It runs the installed Codex app-server RPC reference flow within the actual lane lookup and reader. The separate reader probe completed in 4,320 ms with an available weekly window. Both outputs were redacted; no identity or credential was printed. The probe uses a stub owner and snapshot adapter, so it does not exercise the full dashboard DI path.

## Check results

- cli-agent-runtime scoped Jest: 2 suites, 46 tests passed.
- rpc-handlers scoped Jest: 1 suite, 10 tests passed.
- `npx nx typecheck cli-agent-runtime --parallel=1`: passed.
- `npx nx typecheck rpc-handlers --parallel=1`: passed.

The two Nx commands also printed a non-fatal Nx Cloud account warning; both local typechecks exited successfully.

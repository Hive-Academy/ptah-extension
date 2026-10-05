# Lane A report

## 1. Antigravity account identity — Done

- Added zod-validated synchronous active-account lookup and opaque account owner generation in `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:113,361`.
- Added the lane-owner port member and routed Antigravity lanes through it in `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts:34,79`.
- Added coverage for distinct/stable active accounts, malformed/missing/empty fallback, and email non-disclosure in `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:323`.
- Added lane routing coverage in `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.spec.ts:64`.

## 2. Turn-start account probe rejection — Done

- Attached a logging rejection handler to the fire-and-forget prefetch in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:232`.
- Added rejected-read regression coverage in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.spec.ts:197`.

## 3. Credential invalidation error — Done

- `cloud_credential_error` exists in the shared SDK hook types and is now invalidating in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:28,116`.
- Added it to the existing invalidation parameterized spec in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.spec.ts:247`.

## 4. Callback registry documentation — Done

- Corrected the emitted-session-id comment in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-plan-limit-callback-registry.ts:61`.

## 5. Loopback TLS agent lifecycle — Done

- Reused a single non-keep-alive loopback-only TLS agent in `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts:248,276`.
- No reader spec added: the injected status-request seam bypasses `defaultRequest`, so the module-level transport lifecycle is not directly exercised by the existing test seam.

## Verification

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: passed; auth-providers remained 24/24 baseline sites and agent-sdk remained 4/4.
- `npx nx run-many -t typecheck,test,lint -p auth-providers cli-agent-runtime agent-sdk --outputStyle=static`: still running in the shared Windows environment when this report was written; no pass/fail counts available yet.

## Revise round 1

- Removed the undecorated filesystem constructor parameter from the tsyringe service. `readActiveGeminiAccount()` is now a module-level, exported test seam in `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:120`; `ownerForAntigravity()` uses its production default in `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:377`.
- Updated the existing account identity cases to mock `node:fs` rather than inject a constructor argument, and added child-container resolution coverage in `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:1,371`.
- Corrected the quota-probe header to state that signals carry the real SDK session id, while lookup accepts either id, in `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:32`.
- Required serialized scoped Nx verification was launched once: `npx nx run-many -t typecheck,test,lint -p auth-providers cli-agent-runtime agent-sdk --outputStyle=static --parallel=1`. The shared execution bridge detached before completion, so real per-project pass/fail counts were not available at report time.
- Required degradation audit was launched with filtered output; the bridge detached before its completion summary. The prior completed audit remained baseline-clean (auth-providers 24/24; agent-sdk 4/4).

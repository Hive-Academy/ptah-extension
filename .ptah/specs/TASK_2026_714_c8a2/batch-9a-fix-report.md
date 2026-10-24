# Batch 9a revision 1 report

Implemented the six assigned gateway findings. Final focused tests: 47 passed in 2 suites. Scoped TypeScript diagnostics: clean. Combined Nx verification fails dependency lint because the new required Zod boundary imports `zod`, which is not declared in the gateway package manifest. That manifest is outside this assignment's four-file ownership; the coordinator must add the existing workspace Zod version to its dependencies and rerun scoped lint. No package installation is needed.

## Findings and evidence

Paths below are relative to `libs/backend/gateway-chat-bridge/src/lib/`.

| Finding | Change | Regression evidence |
| --- | --- | --- |
| 1. Unbound approval reply | `codex-gateway-approval-sink.ts:12` defines a strict Zod reply schema and inferred presentation return type. `:78` validates runtime data and compares requestId without coercion. Aborted requests still cancel; malformed/mismatched answers decline. Edit attempts still decline with editNotSupported. `:85` dismisses on every path, including early cancellation, unavailable presentation and userInput. | `codex-gateway-approval-sink.spec.ts:169` wrong request declines; `:181` a shared late reply from a cancelled earlier prompt cannot approve the next prompt; `:201` early-exit dismissal. Existing four-decision, malformed reply, edits, error, abort and userInput coverage retained. |
| 2. Arbitrary context / unrelated sink | `codex-gateway-adapter.ts:25` makes construction private and requires a module-private symbol at runtime. `:38` opens by registering supplied runtime ports with the adapter's exact sink, calling resolveGatedCodexRuntime for gateway, then opening the exact profile/resume identity. Core registration refuses an existing runtime. | `codex-gateway-adapter.spec.ts:108` exact sink, resolver arguments and resume; `:122` real core resolver and production gate prevent context opening; `:143` real registration rejects an existing runtime; `:157` arbitrary context construction fails. Missing sink also fails before registration. |
| 3. Non-terminal errors abort context | `codex-gateway-adapter.ts:224` emits a fixed, sanitized message and continues to terminal. It does not forward vendor error contents. | `codex-gateway-adapter.spec.ts:416` retryable error, subsequent text and terminal are delivered without closing context. Existing failed-terminal and prematurely-ended-stream tests remain. |
| 4. Divergent finals dropped | `codex-gateway-adapter.ts:171` and `:181` emit the complete final text/reasoning when it does not extend the streamed prefix, matching the lane mapper. | `codex-gateway-adapter.spec.ts:436` divergent text and reasoning both survive; existing equal-final dedup coverage retained. |
| 5. Usage double counting | `codex-gateway-adapter.ts:221` retains the latest reported usage snapshot without emitting it; `:232` emits usage at message_complete, preferring terminal usage. No counters are invented. | `codex-gateway-adapter.spec.ts:453` multiple snapshots and terminal usage produce one usage-bearing completion. Existing projection and missing-counter cases verify fallback and omission. |
| 6. Sequence duplicates | `codex-gateway-adapter.ts:108` rejects repeated/older sequences before terminal handling, after which only accepted matching-identity events advance the watermark. | `codex-gateway-adapter.spec.ts:467` duplicate text and stale terminal cannot duplicate content or prematurely end the turn. |

## Verification

Commands executed from `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat`. PowerShell filters are equivalent to the requested tail/grep filters.

1. `npx prettier --write libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts` ? succeeded. Adapter spec formatted again after strengthening core-gate coverage.
2. `ptah_get_diagnostics` with the four absolute changed source/spec paths ? final result: TypeScript compiler, clean coverage, 0 errors, 0 warnings. Repeated only after the final spec change.
3. `npx jest -c libs/backend/gateway-chat-bridge/jest.config.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20` ? initial 46/46 passed; after stronger gate tests, final 47/47 passed, 2/2 suites, 3.962 seconds. Node emitted a Jest-config ES module warning, but suites passed.
4. `npx nx run-many -t typecheck lint -p @ptah-extension/gateway-chat-bridge --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10` ? FAILED: dependency lint reports a package missing from dependencies (new import: zod). 1 error, 3 warnings. No TypeScript errors reported; scoped compiler diagnostics separately confirm clean final files. No source lint errors or no-unexpected-multiline errors reported. The three existing gateway warnings were already documented in batch-9a-report.md. Do not treat the combined Nx run as passing.
5. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'gateway-chat-bridge|TOTAL'` ? gateway `4 ok (baseline 4)`; TOTAL `276 unsuppressed site(s)`. No gateway FAIL. All four gateway sites remain in the existing gateway-chat-bridge.ts.

No builds, workspace-wide checks, installs, git operations or edits to Claude gateway / lane files were performed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Open the context inside a static factory using the public core registration and gated resolver. | Own gated opening; accept an externally branded context. | Current request explicitly chooses owned opening when the API supports it. `codex-runtime/src/index.ts` exports both functions; `src/lib/di/registration.ts` binds the sink and rejects existing runtime registrations. No new core contract is necessary. | Yes, internal unwired adapter API. |
| Require a fresh host-owned registration container, and let the host retain runtime lifecycle ownership. | Fresh registration scope; trust an existing runtime with unknown sink. | Core registration creates the runtime from exactly the supplied ports and refuses pre-registration. The registration API documents host lifecycle ownership. This adapter directly resolves no DI tokens. | Yes; batch 9b composition supplies and retains the scope. |
| Use typed requestId/decision replies with strict runtime Zod validation. | Trust TypeScript; validate at presentation boundary. | Explicit revision requirement and core string-or-number requestId contract. Wrong identity cannot approve; edits remain declines. | Yes, presentation seam only. |
| Preserve lane behavior for non-terminal errors, divergent finals, usage snapshots and sequence watermarks. | Independent projection semantics; match existing lane mapper. | Read-only comparison with codex-lane-events.ts confirms those rules. Gateway error messages are sanitized static text. | Yes, projection only. |
| Leave the dependency manifest for the coordinator. | Expand scope to package.json; respect explicit four-file ownership. | User says YOUR FILES ONLY; package manifest lacks zod and Nx dependency lint detects the required import. | Yes; add zod using the existing workspace version, then rerun scoped lint. |

## Imports and integration handoff

- New runtime symbols from the already imported `@ptah-extension/codex-runtime` library: `registerCodexRuntime`, `resolveGatedCodexRuntime`. No runtime import from a new internal library, so no new host tsconfig path is introduced.
- New external runtime import: `zod`; add it to `libs/backend/gateway-chat-bridge/package.json` dependencies outside this lane. `tsyringe` is a type-only production import and an existing package dependency (runtime import in specs only).
- Batch 9b must call `CodexGatewayAdapter.open(container, portsWithoutSink, sink, logger, platform, profile, resume?)`, using a fresh host-owned scope and retaining runtime lifecycle ownership. A raw context can no longer be injected. `portsWithoutSink` includes the public registration usage configuration.
- Presentation adapters must return `{ requestId, decision }` for the exact prompt; conversation authentication and routing remain presentation responsibilities.
- Production gateway parity remains disabled. The real gate is covered; no live gateway or process integration was attempted.

## Files written

- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-9a-fix-report.md`

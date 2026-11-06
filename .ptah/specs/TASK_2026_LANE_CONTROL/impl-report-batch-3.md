# Batch 3 implementation report

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/`: added the pure delivery planner and spec, effective-capability probe, receipt store and spec, message coordinator and spec, and shared lane resume service and spec.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/`: updated the message router and spec, process manager and spec, and spawn environment. The manager forwards spawn policy, emits message/turn lifecycle events, and classifies limit/auth exits.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts` and `ptah-cli-registry-spawn-model.spec.ts`: validate Ptah CLI policy before SDK/process creation and return the effective policy.
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts` and `register.ts`: register the new coordinator, receipt store, and resume service.
- `libs/shared/src/lib/types/agent-process.types.ts`: add typed `usage-limit`/`auth` stop reasons and optional reset timestamp.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` and its spec: forward Ptah CLI `permission`/`network` into the registry and capability/policy metadata into the process record. The latest caller instruction explicitly required this provider spawn handoff.

## Behaviour per planner rule

1. A running lane with default `queue` accepts up to eight pending messages without interrupting; an idle live lane starts a turn.
2. `now` prefers live steer. Codex and Pi follow the effective handle capability, without a CLI-name condition.
3. If `now` cannot steer and needs interrupt-resume, absent `allowPartialTurnLoss === true` refuses before interrupt. A successful interrupt followed by continuation failure becomes `interrupted-undelivered`.
4. Legacy `delivery: 'steer'` requires true steer; it does not fall back to interrupt.
5. Released/expired lanes with a CLI session use the shared resume gate and spawn path, retaining the original receipt ID.
6. Preview and Send call the same pure planner; Send replans against current live capabilities before effects.
7. Unsupported capability or spawn policy returns a structured refusal before process creation; explicit permission/network pass through ordinary CLI and Ptah CLI paths.
8. A message accepted into a queue binds to its own message ID and explicit `turnSeq` when its turn starts; it settles only on that turn's settlement.

## Receipt state machine

- `accepted -> started -> settled` for a successful dispatch and turn settlement. The receipt is `accepted` while queued; a turn start binds its message ID to `turnSeq`.
- Queued dispatch failure or Stop of an accepted message becomes `failed` (`agent_stopped` on Stop). Stop of a started turn becomes `settled` with `turnOutcome: 'stopped'`.
- Confirmed interrupt followed by failed continuation becomes terminal `interrupted-undelivered`.
- Cancel is permitted only from `accepted`; it becomes terminal `failed/cancelled-by-user`.
- Only receipt metadata is persisted behind host-neutral `IStateStorage`; accepted bodies remain in the live queue. On host restart, nonterminal receipts become `failed/host-restarted`. Receipt retention is bounded to 64 per agent with seven-day terminal TTL; missing/expired IDs return `expired`.
- The coordinator emits changes through an injected event sink interface for Batch 5 renderer wiring.

## A7 exit classification

The manager records `stopReason: 'usage-limit' | 'auth'` on exit/error evidence. Usage-limit detection includes 402/429, quota, usage balance exhausted, and `RESOURCE_EXHAUSTED`. It copies a reset parsed from the error into `stopResetAt`, or uses the earliest future reset from the limit ledger when the error has none. Batch 4 owns the notifier's failed verdict mapping.

## Tests added or updated

- Planner: default queue, live steer and legacy steer, interrupt-resume confirmation, cold resume, and unsupported branches.
- Receipt store: metadata persistence, bounds/TTL, expired lookup, and host-restart recovery.
- Effective capabilities: live Pi steer and restored resume capability.
- Coordinator: replan at execution, refusal before interrupt, interrupted-undelivered, accepted-only cancel, queued failure, Stop of accepted and started messages, and cold resume retaining receipt ID.
- Resume: shared resume gate/spawn arguments and missing-session refusal.
- Router/manager: queued message ID forwarding, turn lifecycle, queue/Stop transitions, A7 exit classification, and limit-ledger reset fallback.
- Ptah CLI registry/namespace builder: policy validation and permission/network forwarding.

## Verification

- `npm run verify -- -p @ptah-extension/cli-agent-runtime` first run: exit 1 before tasks. Nx reported `@nx/eslint/plugin` graph worker exited with code 1.
- Same exact command retried once: source verification passed (`NX 2 tasks: 2 succeeded`, 0/2 cache hits; lint and typecheck). Test target failed (`NX 1 task: 0 succeeded, 1 failed`): `Test Suites: 13 failed, 121 passed, 134 total`; `Tests: 17 failed, 1 skipped, 2561 passed, 2579 total`. The command filtered only `@ptah-extension/cli-agent-runtime`; no workspace-wide target ran.
- After fixing the Batch 3 test issues found in that run, focused runtime Jest through `node scripts/verify.mjs --exec --task batch3-jest -- npx jest -c libs/backend/cli-agent-runtime/jest.config.ts --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-planner.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-delivery-receipt-store.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-message-coordinator.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-lane-resume.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts --coverage=false --maxWorkers=2`: 6 suites passed, 1 manager suite failed (259 passed, 1 failed) due to a misplaced test assertion; corrected subsequently.
- Final manager regression: `node scripts/verify.mjs --exec --task batch3-manager-ledger-jest -- npx jest -c libs/backend/cli-agent-runtime/jest.config.ts --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts --coverage=false --maxWorkers=2` — `Test Suites: 1 passed, 1 total`; `Tests: 216 passed, 216 total`; exit 0.
- Other focused Batch 3 specs in the first focused run passed; capability probe spec separately: `node scripts/verify.mjs --exec --task batch3-capabilities-jest -- npx jest -c libs/backend/cli-agent-runtime/jest.config.ts --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/messaging/agent-effective-capabilities.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 2 tests passed; exit 0.
- Namespace builder: `node scripts/verify.mjs --exec --task batch3-namespace-jest -- npx jest -c libs/backend/vscode-lm-tools/jest.config.ts --runTestsByPath libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 94 tests passed; exit 0.
- Final runtime source typecheck: `node scripts/verify.mjs --exec --task batch3-tsc-final -- npx tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json --noEmit --pretty false` — exit 0.
- Scoped `ptah_get_diagnostics` after edits repeatedly returned `TypeScript check still running after 45s`; native typecheck above completed successfully.

## Pre-existing failures

The full verify retry showed unrelated or environment-sensitive failures in `mcp-install.service.spec.ts` (workspace paths), `claude-approval.reader.spec.ts` (real git/path fixture), `acp-process-transport.spec.ts` (10/15-second timeouts), `ptah-cli-registry-auto-compact-argv.spec.ts` (expected pinned SDK 0.3.318, observed 0.3.278), and `child-worktree.provisioner.integration.spec.ts` (120-second timeout). These specs were not changed in this batch.

Batch 1–2 capability-manifest changes also leave older tests red: `codex-native-selection.spec.ts`, `codex-lane-activation.spec.ts`, and `agent-process-manager.account-binding.spec.ts` still use the legacy capability mock shape and fail TypeScript compilation; `codex-lane-parity.spec.ts`, `cli-detection.service.spec.ts`, and `register.ptah-cli-registry.smoke.spec.ts` assert the old deep-equality shape. They are outside the Batch 3 spec scope and remain the reason the full test target is red after this batch's focused tests pass.

## Needs

- Batch 4: map typed limit/auth `stopReason` to a failed notifier verdict and use `stopResetAt` when present; this batch did not edit the notifier or parent delivery.
- Batch 5: route MCP/RPC preview/send/cancel and explicit Resume through the coordinator/resume service, wire the receipt event sink to renderer push, expose the policy fields in transport schemas and all host compositions.
- Batch 6: migrate the renderer follow-up queue to backend receipts and merge pushed receipt updates into the monitor store.
- Batch 1–2 owner: update the inherited legacy capability mocks/assertions named under Pre-existing failures so the runtime test target can pass.

## Decisions

- Keep message bodies in the live router queue and persist metadata only. Evidence: binding amendment A1; reversible behind the receipt storage port.
- Bind queued starts by message ID before turn sequence assignment. Evidence: manager flush has the exact queued ID, while direct turn starts can interleave; reversible if lifecycle events gain a stronger delivery token.
- Classify exit evidence on the process record while preserving the existing process status. Evidence: binding amendment A7 gives the notifier in Batch 4 responsibility for a failed verdict; reversible when notifier integration is complete.
- Pass Ptah CLI policy from the namespace builder to the registry and validate via `AgentSpawnEnvironment.resolveLanePolicy` before SDK creation. Evidence: latest caller instruction and existing registry spawn path; reversible by moving the same handoff behind Batch 5 transport wiring.

## Not done

- Batch 4 notifier and parent delivery; Batch 5 MCP/RPC and renderer push; Batch 6 renderer migration are outside this batch.
- The full runtime verify test target remains red due to the inherited/environment failures listed above; the changed Batch 3 specs and runtime source typecheck pass.
- Skill discovery/loading was unavailable because this host listed no skill-loading tool.

## Follow-up correction (2026-11-06)

The capability-mock failures above were regressions introduced by this branch's Batch 2 manifest expansion, not failures inherited from main. They are fixed in `impl-report-batch-3-fixes.md`, along with the limit-reader and Codex error-reason review findings. A subsequent filtered test run passed 132 of 136 suites; the four remaining suites are classified in that follow-up report. The earlier verification and Needs entries above describe the state at the time of the original Batch 3 report.

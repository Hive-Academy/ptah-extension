# Batch 10d.P-C1 report

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:318`: Skip the account-binding checkpoint when both fields are absent; reject either partial binding; invoke the callback with the thread ID when both fields are present.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:246`: Add a default-account case with a callback that must not run. At lines 257-273, assert one callback with the complete reference and thread ID. At lines 294-304, assert both partial-binding variants reject before prompt start and close the context once.

## Decisions

- **Default account:** Skip the callback when both binding fields are absent. The alternative was to reject a callback without fields. Evidence: `AgentProcessManager` supplies the callback for all runs, while the legacy Codex SDK adapter (`codex-cli.adapter.ts:541-927`) has no account-binding checkpoint and starts default-account runs without one. Reversible: yes.
- **Partial binding:** Reject a supplied field without its partner even if the callback is absent. The alternative was to validate only when the callback exists. Evidence: the task requires a bound context never to downgrade silently, and `CliCommandOptions` makes the callback optional. Reversible: yes.
- **Context cleanup:** Keep the existing catch and close code. The alternative was a new cleanup path. Evidence: `runSdk` lines 347-361 await `close()` after `openContext` throws; `close()` awaits `closeContext()`, whose WeakMap reuses one close promise per context (lines 266-289). Reversible: yes.
- **N3 persisted identity:** `codex-app-server-lane.adapter.ts:317` persists the identity before the binding check at lines 318-325, so a refused binding can leave a resumable identity without a started turn; this is low impact and the established persistence order remains unchanged.

## Verification and limitations

- Inspected the changed source and specs. Both source files retain LF line endings and UTF-8 without BOM.
- Did not run verification, tests, typecheck, lint, build, Nx, npm, or Ptah diagnostics, per task hard rules. The coordinator ran the full cli-agent-runtime target on Windows after the C1 fix and it passed, including `codex-lane-activation.spec.ts`; the revise-round adapter cases and Linux CI remain pending.
- No matching skill-loading tool was exposed to this lane; the task's self-contained rules were applied directly.

## Revise round 1

- **N1:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:318-325` now refuses a complete binding without `onAccountBinding` before prompt start. The existing catch closes the opened context once.
- **N2:** `.ptah/specs/TASK_2026_714_c8a2/p10-lane-parity-proof.md:3,58,96` now records the C1 activation failure and fix, the coordinator's passing Windows run, pending Linux CI, and the named-account manager path's pending live proof. Shifted adapter spec references were corrected at proof lines 17, 31 and 59; the signature remains unsigned.
- **N3:** Documented the persisted-before-binding order and its low impact under `## Decisions` above; no code change.
- **N4:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:306-322` adds partial and complete binding cases without a callback, each asserting refusal before prompt start and exactly one context close. Existing C1 cases remain at lines 246-304.

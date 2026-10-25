# Batch 20 implementation report

Implemented named Claude lane dispatch and queued-turn validation in the five assigned source/spec files. Named execution remains release-held without a host-supplied, available persistence port and successful admission. No host registration or release gate was changed.

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

This report is the only additional file written. No git operations were run; changes remain uncommitted for the invoking workflow.

## Acceptance evidence

Paths below are relative to the assigned worktree.

1. **Two queries, independent empty gates, no early task options.** `claude-cli.adapter.ts:118` performs named preparation before SDK loading; bootstrap precedes defaults/model-effort, policy, harness and spawn assembly. `claude-sdk-lane-options.ts:30` supplies control-only bootstrap options with temporary cwd, empty system prompt/tools/MCP/settings, no hooks or resume, and denied permissions. Bootstrap has its own abort controller. `claude-sdk-lane-runner.ts:414` closes the bootstrap and awaits numeric child termination before final launch at `:443`. Both use the exported `createNamedAccountPromptGate`, never the seeded ambient mailbox as their SDK prompt.
2. **Final identity and durable linkage before dispatch.** `claude-sdk-lane-runner.ts:443` checks the final query's accountInfo, buffers its SDK init, verifies resume session identity, commits or reuses the immutable run binding, attaches the real SDK session, awaits account-bound metadata and durable lane reference, then awaits `onAccountBinding`. It rechecks final identity before accepting the initial task. The buffered query replays init to the existing `PtahCliStreamLoop`; no alternate message transformer or SDK control protocol was added.
3. **Batch 19 handoff.** `claude-cli.adapter.ts:75` exposes the authoritative account binding port. The callback passed at `:174` is awaited while the final gate remains empty. `claude-sdk-lane-runner.ts:189` stamps the exact frozen receipt onto the handle. Parentless runs still await persistence. The manager checkpoint remains at `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:726` and was read-only.
4. **Queued dispatch, auth and metadata changes.** `claude-sdk-lane-runner.ts:562` checks current route and identity, then authoritative metadata on subsequent turns. `:575` validates before queue insertion; the final prompt wrapper at `:443` independently validates at consumption. Epoch notifications abort the affected immutable route and discard undelivered messages. An already-running turn is not polled for label/deletion changes; subsequent turns require live metadata. Bootstrap and receipt snapshots are frozen; labels/defaults are not routing authority. Initial fresh admission does not incorrectly require resumable known-identity evidence; ordinary resume does.
5. **Cleanup and permissions.** `claude-sdk-lane-runner.ts:156` makes runner cleanup and pending-turn settlement idempotent, including named abort when the stream remains pending. `:331` observes numeric process exits and closes each query once. `:601` closes/discards gates, removes auth and abort listeners, and settles the reservation once. An unproved/signal-only exit retains the reservation. Final permission callbacks deny until linkage is complete and after disposal. Admission awaits have bounded timers and release their timers/listeners. Named stderr is reduced to a fixed diagnostic at `claude-sdk-lane-options.ts:104`.
6. **Release-held and ambient compatibility.** `claude-cli.adapter.ts:260` refuses absent/held persistence before calling admission or loading the SDK; a refusal from admission also precedes SDK loading. Bound context without routing admission cannot silently become ambient. The existing spec `fails closed before named admission, SDK loading or prompt release even with a registered port` remains unchanged at `claude-cli.adapter.spec.ts:379`, including both refusal strings. The configured native registry was not edited; its options and seeded mailbox continue through the existing ambient runner branch. Capabilities remain continuation-only, with no steer or interrupt.
7. **D15 environment boundary.** `claude-sdk-lane-options.ts:22` retains the safe native environment followed by the existing exported route helper. This preserves the secure-storage pin and selector scrubbing. Named final settings sources are empty at `:175`. Spawn assembly remains a type-only import; no value import of agent-generation or workspace-intelligence was introduced.

## Test cases authored

`claude-cli.adapter.spec.ts:584` and `:796` add mocked coverage for:

- Absent/held persistence and a held admission port before SDK loading.
- Control-only bootstrap ordering, separate final gate, closed bootstrap with no task yield, and fresh gates across runs.
- Registry binding, SDK attachment, metadata, durable reference and manager callback ordering; callback-held prompt and permission denial.
- Failures of each persistence step and callback; bootstrap identity failure; final-query mismatch before writes and after callback.
- Handle receipt stamping and authoritative port exposure.
- Epoch cancellation, late callback completion, queued identity mutation at consumption, subsequent-turn metadata deletion, and immutable receipt shape excluding labels.
- Unknown resume evidence, authoritative existing-binding reuse, and refusal of direct bound ambient input.
- Signal-only/uncertain termination retention, synchronous query failure after spawn, once-only query close, unsubscribe and turn settlement.

`claude-sdk-lane-runner.spec.ts:381` onward adds named setting/environment/redaction checks, duplicate-cleanup regression coverage, admitted-query reuse without a third query, unchanged receipt handoff, continuation-only behavior, and named abort settlement while the stream remains pending. Existing ambient seeded-mailbox and permission routing assertions remain in place, including callback argument 0 versus routing hint argument 4.

These specs were **authored and typechecked, not executed**. No Jest, Nx, tsc CLI, ESLint, build, serve, package or e2e command was run. No sign-in, sign-out, credential mutation or inference occurred.

## Diagnostics

Final `ptah_get_diagnostics` was scoped to the absolute paths of all five assigned files. Result: **typescript-compiler; coverage clean; 0 errors; 0 warnings; 0 sibling diagnostics**. Earlier spec-double typing errors were corrected before this final check. Prettier formatted only the five owned files.

## Decisions

1. **Optional host persistence dependency, release-held by default.** Options: extend the existing dependency object, introduce new DI tokens, or edit forbidden port/registration files. Chose the optional `accountPersistence` dependency and explicit availability check. Evidence: Batch 19's authoritative LaneAccountBindingPort and Batch 17's registry/SDK-attachment/metadata contract; D7/D21 retain certification holds. No concrete auth-providers import or new injection token. Reversible host wiring.
2. **Reuse the public gate and normal stream loop; keep lane lifecycle local.** Options: import private main-chat coordinator internals, expand out-of-scope agent-sdk exports, or implement the lane coordinator around exported SDK primitives. Chose the latter because the plan assigns lane lifecycle to this runner and only the empty gate is publicly exported. The bootstrap options and identity digest follow the main-chat implementation; no private control messages or transformer copy. Reversible when shared coordinator/bootstrap/identity exports are approved.
3. **Conservative final termination settlement.** Options: trust query.close/signal-only exit, wait indefinitely, or retain unless numeric termination has been observed when settling. Chose retention without proof, matching the safety rule in `sdk-query-runner.service.ts:483`. Bootstrap still waits for termination before final-query creation. A numeric exit arriving only after final cleanup has already settled does not retroactively release that retained lease. This can retain a genuinely stopped child; certification/reconciliation must account for it. Reversible with a trustworthy termination contract.
4. **Validate every queued subsequent turn twice.** Options: trust enqueue-time proof, poll active runs, or revalidate on enqueue and immediately before SDK delivery. Chose the latter plus removable epoch subscription. Evidence: a queued message may outlive its initial validation, and deleted metadata must block subsequent turns while a running immutable snapshot continues. No per-item timer/observer persists after its bounded validation. Reversible internal sequencing.
5. **Preserve refusal text while adding typed codes.** Options: replace error text, silently fall back to ambient, or retain text and attach a safe refusal code. Chose retained text and typed codes. The existing required held-admission spec was not rewritten. Dependency error details are not exposed as named refusal messages. Reversible presentation detail.

## Out-of-scope changes needed

- **Host composition and certification:** supply `ClaudeCliAdapterDependencies.accountPersistence` (`claude-cli.adapter.ts:55`) using the same native registry/SDK-attachment/metadata authorities as main chat. Do not set availability until physical-route checks, both-store lookup, auth-epoch events and installed-SDK empty-gate behavior are certified. No host currently gains availability from this batch.
- **Shared persistence adapter:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:559` defines main-chat persistence; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:93` defines its registration token. The lane contract at `claude-sdk-lane-runner.ts:232` intentionally uses the same commit/attach/save/current-route/event method shapes plus Batch 19 lookup/reference operations. Host implementations must require matching registry and metadata and must not certify caller-provided directories.
- **Optional shared helper exports:** the main-chat bootstrap builder at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:899`, identity helper and coordinator at `session-query-executor.service.ts:575,608` are not public exports. `libs/backend/agent-sdk/src/index.ts:453` already exports the prompt gate and is reused. Consolidating the remaining shared configuration/identity helpers requires an agent-sdk-owned change; no out-of-scope export was edited.
- **Termination proof:** `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:529` and `sdk-query-runner.service.ts:483` need the previously recorded trustworthy termination/reconciliation contract before certification can safely relax conservative retention. This batch does not treat a signal-only worker exit as proof.
- **Verification owner:** run the two changed Jest suites and the required host/project checks in the invoking workflow/CI. Runtime behavior, live empty-gate init/accountInfo, and host registration are not certified by clean scoped TypeScript diagnostics.

## Delivery

Absolute report path: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-20.md`.

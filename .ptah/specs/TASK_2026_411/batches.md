# TASK_2026_411 — Codex execution batches

Execution is sequential unless the user explicitly changes the workflow. Codex CLI is the sole executor: no subagents, helper CLIs, nested worktrees, permission changes, commits, or pushes unless separately authorized. Every batch begins by verifying this worktree and branch and ends with its listed gate. Never use live Ptah/Claude/Codex profiles or authenticated provider requests.

## Global execution rules

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-411-profile-performance`
- Branch: `fix/task-411-profile-performance`
- Preserve unrelated user changes; inspect `git status` before each batch.
- Use `apply_patch` for source edits. Use generated temp homes/fixtures and fake local servers only.
- Keep `@anthropic-ai/claude-agent-sdk` pinned at 0.3.150, Zod pinned at 4.3.6, and the selected model unchanged.
- Do not proceed past a failed correctness, main-thread-budget, boundary, or cross-host gate.
- A batch may touch only its ownership list. If a required edit falls outside it, stop and revise this document before editing.

## Dependency graph

```text
B1 contracts/protocol
 ├─> B2 Electron worker/readiness
 │    └─> B3 metadata split/lazy output
 │         ├─> B4 stats reader/RPC
 │         │    └─> B5 analytics UI
 │         └─> B9 final validation
 ├─> B6 Codex stream parity/proxy timing
 ├─> B7 Codex account identity/surface
 └─> B8 compaction settings/hook timing

B6 + B7 + B8 ─> B9
```

## B1 — Storage capability and protocol contracts — COMPLETE (2026-09-10)

Verification evidence: `b1-report.md`. B1 changed contracts, schemas, and focused tests only; no B2 implementation was started.

Dependencies: none.

Exclusive ownership:

- `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`
- new state async/readiness/maintenance interfaces and typed errors under `libs/backend/platform-core/src/`
- `libs/backend/platform-core/src/index.ts`
- new manifest and worker-message types/schemas under `libs/backend/platform-electron/src/implementations/`
- focused protocol/manifest specs only

Implementation instructions:

1. Add optional capability interfaces without changing the existing `IStateStorage` method signatures.
2. Define a Zod-validated worker protocol with monotonically identified operations and a 256 KiB maximum message payload.
3. Define generic declarative array splitting and bounded JSON-sequence operations; do not mention session metadata in the Electron protocol types.
4. Define manifest schema fields: generation, v1 source hash, mutation epoch, key blob length/hash, and commit identity.
5. Encode fail-closed post-mutation recovery and typed not-ready/recovery errors in contracts/comments.

Gate:

- Platform-core and platform-electron protocol unit tests/typecheck/lint pass.
- Contract tests reject oversized/invalid worker messages and invalid manifests.
- Import graph shows no concrete adapter import from backend core.

## B2 — Electron v2 worker and readiness integration — COMPLETE (2026-09-10)

Verification evidence: `b2-report.md`. B2 delivered the generic storage worker,
durable recovery, readiness propagation, Electron startup gating, and production
worker bundling. B3 domain metadata extraction was not started.

Dependencies: B1.

Exclusive ownership:

- `libs/backend/platform-electron/src/implementations/electron-state-storage.ts`
- new Electron state worker, worker host, commit/recovery helpers and specs
- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` and focused spec additions required to carry bounded snapshot pages (B1 defined the transport budget but intentionally did not define the worker-host hydration request)
- `libs/backend/platform-electron/src/registration.ts` and public exports
- `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts` and specs
- `libs/backend/vscode-core/src/services/workspace-context-manager.ts` and focused specs required to await a delegate before publishing it as active (the manager is the sole activation caller; changing only the proxy cannot make the existing async switch safe)
- `apps/ptah-electron/src/di/phase-1-infra.ts`
- Electron boot/readiness activation and IPC bridge files
- `apps/ptah-electron/src/windows/main-window.ts` and focused specs, limited to late-binding the existing small global bounds store when the preparing shell creates the window before DI
- migration shell asset, Electron worker build wiring/`project.json`, relevant smoke/build specs and DI manifests
- `apps/ptah-electron/tsconfig.app.json`, limited to excluding the existing Jest-only `src/config/build-artifact-gate.ts` helper that the production typecheck currently includes without Jest globals (required for the declared B2 app typecheck gate; no runtime surface changes)

Implementation instructions:

1. Implement v2 blob/manifest/CURRENT commit ordering in the worker. Remove the proposed rollback journal entirely.
2. Retain v1 and the prior v2 generation; never auto-serve stale v1/prior-v2 after `mutationEpoch > 0` corruption.
3. Make workspace storage not-ready until migration plans and manifest verification finish. Throw typed errors for early sync reads/writes.
4. Forward readiness through the exact active workspace delegate; do not activate an unready workspace or mix it with default storage.
5. Load only the static shell until ready. Ensure no state-reading RPC/import starts earlier.
6. State process-crash guarantees accurately; do not claim power-loss-atomic rename on Windows.

Gate:

- Failure injection at every durable step yields v1 only pre-mutation, valid current v2, or recovery-required—never a partial/stale silent answer.
- Constructor/main thread does not read/parse legacy state or stringify a whole store.
- Workspace-switch/default-overwrite regression tests pass.
- Electron worker artifact exists in a production build; DI smoke manifests remain correct.

## B3 — Durable metadata extraction and lazy output paging

Dependencies: B1, B2.

Exclusive ownership:

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- new metadata migration recipe, per-session repository/output paging collaborator, tokens/register/barrels/specs in `agent-sdk`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` and focused specs
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- CLI-session/output methods in `session-rpc.handlers.ts`, their schemas/specs
- corresponding shared RPC/session types
- frontend agent-monitor/tree state and tests required for progressive output pages

Implementation instructions:

1. Supply the domain migration recipe to the generic worker: output chunks first, per-session detail second, lean index last in one manifest commit.
2. Keep `SessionMetadataStore` as facade but replace whole-array staging with per-session detail plus bounded index updates.
3. Preserve “longer wins,” retry, and reference-before-delete invariants. Never delete the only output copy.
4. Write/read agent output as bounded sequences. Split long strings into tagged transferable slices; do not truncate.
5. Restore lean agent records at startup/resume. Fetch output through bounded `session:cli-output-page`; remove full output arrays from `chat:resume` and `session:cli-sessions` payloads.
6. Provide compatibility migration for VS Code/CLI stores without importing Electron or changing their behavior.

Gate:

- Generated 256 MB fixture with historical inline and per-key output round-trips exactly.
- Injected extraction failure leaves the fat source authoritative and retryable.
- Instrumentation observes no main-thread JSON parse/stringify or structured-clone message over 256 KiB on migration, writes, resume, or reads.
- Hot metadata write amplification is proportional to one session/index entry, not all sessions.
- VS Code, Electron, and CLI metadata/resume contract tests pass.

## B4 — Stats projection, cache, and RPC — COMPLETE (2026-09-11)

Verification evidence: `b4-report.md`.

Dependencies: B3 (metadata contracts stable; implementation may reuse lean index).

Exclusive ownership:

- new stats reader/aggregator/cache files and specs in `libs/backend/agent-sdk/src/lib/`
- projection additions to `helpers/history/jsonl-reader.service.ts` and specs
- agent-sdk DI tokens/register/barrels
- stats/list portions of `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`, schema/specs
- stats-related shared session/RPC types

Implementation instructions:

1. Stream only usage/timestamp/model/identity/compact-boundary projection; do not call full-history replay.
2. Implement `current-context` and `[since,until)` range semantics, partial coverage, nullable cost, and no active-provider fallback.
3. Enforce 20 ids/request, two parent files concurrently, bounded child concurrency, byte/line yielding, and abort.
4. Key bounded LRU/in-flight coalescing on exact file/directory membership/rate-card tokens. Never use TTL as validity.

Gate:

- Golden accounting/cancellation/cache invalidation tests pass.
- Source-level regression proves stats handler cannot call `readSessionHistory()`.
- Synthetic 20-id page stays under 30 s on the reference host; concurrency/yield assertions are the CI-primary gate.

## B5 — Progressive analytics UI — COMPLETE (2026-09-11)

Verification evidence: `b5-report.md`.

Dependencies: B4.

Exclusive ownership:

- `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts` and specs
- analytics/session card component/template/style files necessary for loading/partial/cap/estimate states
- frontend-only shared use-site updates caused by B4 contracts

Implementation instructions:

1. Capture one `until`, issue 20-id pages, and merge each page into Angular signals.
2. Use workspace/range/load generation plus `AbortController`; stale responses cannot write.
3. Key cache by workspace/range/until/session. Preserve OnPush, standalone, zoneless behavior.
4. Show partial coverage and the 200-session cap; label local cost as a current-rate-card estimate.

Gate:

- Range/workspace race and progressive-paint tests pass.
- No global RPC timeout increase.
- Dashboard tests/typecheck/lint pass.

## B6 — Codex stream usage parity and proxy timing — COMPLETE (2026-09-12)

Dependencies: B1 only.

Exclusive ownership:

- Responses usage mapper/schema and specs in `libs/backend/auth-providers/src/lib/translation/`
- `responses-stream-translator.ts`, `responses-stream-collector.ts`, and specs
- `translation-proxy-base.ts` timing additions and specs
- transformer/live-tracker specs only; production transformer code only if a failing actual-consumer test proves it necessary

Implementation instructions:

1. Share the uncached/cache/output mapper between stream and non-stream paths.
2. Emit complete terminal usage on `message_delta`; do not add unnecessary stream-event typing.
3. Add metadata-only proxy phase timing with fake clocks and exact/inexact correlation labels.
4. Build the real-consumer integration: fake Responses SSE → proxy → `@anthropic-ai/sdk` → Ptah transformer/tracker.

Gate:

- Actual SDK-consumer parity passes for cached/uncached/tool/split/duplicate/missing/malformed/EOF cases.
- No response body, header, credential, prompt, or tool payload enters timing/log records.
- Subscription request shape/model/system prompt and 600 s timeout are unchanged.

## B7 — Codex home identity and account usage surface — COMPLETE (2026-09-12)

Dependencies: B1; B6 first if both need auth-provider registration/barrel files.

Exclusive ownership:

- new `codex-home-resolver.ts`, account service/schema/types/specs under `auth-providers/providers/codex/`
- `codex-auth.service.ts` path/watch corrections
- auth-providers DI tokens/register/barrels
- checked-in schema artifacts generated from packaged Codex CLI 0.147.0
- provider handler/schema/spec portions and matching shared provider RPC types
- new dashboard provider-account state/card and analytics-card wiring

Implementation instructions:

1. Resolve Codex home once per service instance, honoring injected test override then `CODEX_HOME` then `homedir()/.codex`.
2. Use that exact directory for proxy auth read/watch and App Server spawn env. Never read/log credentials in tests.
3. Generate version-matched protocol schemas from packaged 0.147.0 in a disposable directory, review them, then check in only the necessary response schemas/types.
4. Omit `params` on both account read requests. Feature-gate method/version and validate responses with Zod.
5. Return unsupported for API-key/Bedrock/custom-proxy/non-Codex cases without authenticated upstream work.
6. Render account quota/activity separately from local estimates.

Gate:

- Fake App Server asserts init order, omitted params, exact `CODEX_HOME`, version behavior, redaction, timeout/abort/close/cache.
- No authenticated request, login, token refresh, or credential fixture.
- Provider prefix registration and all three host RPC smoke tests pass.

## B8 — Effective compaction settings and hook timing — MOVED TO PR #493 (TASK_2026_414)

Dependencies: B1; B6 first if timing helpers share files.

Exclusive ownership:

- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`
- `sdk-query-options-builder.ts` and focused specs
- compaction hook handler/timing helper and specs
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`
- `ptah-cli-registry.ts` and focused specs
- `apps/ptah-extension-vscode/package.json` compaction contribution metadata only

Implementation instructions:

1. Delete `compactionControl` assembly/use. Merge explicit `autoCompactEnabled` and validated `autoCompactWindow` through the one `buildFlagSettings` path.
2. Validate integer `[100000,1000000]`; align the advertised minimum. Invalid persisted values warn and use 100,000.
3. Test through the real pinned SDK and fake process spawner; parse captured argv `--settings`. Do not stop at Ptah options.
4. Preserve model, prompts, manual compact, output style, and setting-source precedence.
5. Add monotonic metadata-only compaction attempt timing; keep overlap correlation explicitly inexact.

Gate:

- Effective argv tests pass for true/false/min/max/invalid values on interactive and CLI-agent paths.
- No `compactionControl` production reference remains.
- A delayed 216 s fake compaction reaches PostCompact and clears state; watchdog remains overdue-but-continuing at 180 s.

## B9 — Cross-host and performance closure — BLOCKED (2026-09-12)

Verification evidence: `b9-report.md`. Blocked on two pre-existing lint
findings owned by B2 and B7 (not B9's to fix) and two `node_modules` install
gaps in this worktree (`web-tree-sitter`, `prismjs`/`daisyui`) unrelated to
this task's diff. B9's own deliverables — the deferred B3 fixture (256 MB
migration, injected extraction failure, main-thread budget, write
amplification) and the 200-session/20-id-page analytics fixture — both passed
with real numbers against the real production worker artifact.

Dependencies: B2–B8.

Exclusive ownership:

- test fixtures/performance specs/cross-host smoke specs only
- task reports under `.ptah/specs/TASK_2026_411/`
- no production behavior changes; failures return to the owning earlier batch

Implementation instructions:

1. Run targeted tests, typechecks, lints, and builds for all touched projects; verify Nx’s reported project count.
2. Run Electron worker/build boot tests and VS Code/Electron/CLI composition smoke tests.
3. Run opt-in 256 MB temp-profile and 200-session analytics performance fixtures on a quiet reference host.
4. Record mechanism gates, event-loop heartbeat, write amplification, page timing, and honest upstream-latency uncertainty.

Gate:

- All correctness/security/boundary tests pass.
- No main-thread large-value operation or global timeout increase.
- No live profile/credential access and no unsupported account/compaction claim.

## Batch 2 readiness

B1 and B2 are complete and their gates passed. B3's declared dependencies are
satisfied and B3 is ready to start in a later invocation. B3 and every later
batch remain pending.

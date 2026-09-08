# Plan review (second pass) — TASK_2026_388

Reviewer: Claude (orchestrator), 2026-09-07. Reviewed `implementation-plan.md`,
`plan-self-review.md` and `batches.md` written by Codex, against the code.

## Verdict

**Accept the architecture. Do not start implementation until the six findings
below are folded into the plan and the batch map is re-cut.** The design
(untouched global lane, in-process private runtime, immutable durable
`SessionExecutionConfig`, fail-closed lease, one query funnel, router by tab id
and real id) matches every constraint in `context.md`. All file paths and line
anchors I sampled resolve. The gaps are in sequencing, a restart hole, and two
places where per-runtime isolation is applied to things that must stay shared.

## Findings

### F1 — HIGH: crash between UUID resolve and the durable write resumes a private session on the global provider

Plan §1 persists `executionConfig` on the UUID-resolved callback, after
`SessionMetadataStore.create`. Plan §1 also says "absent field in legacy JSON
means `inherit`". Those two rules together create a hole: a host that dies
after the SDK emitted the UUID but before the durable write completes leaves a
JSONL transcript with no metadata field. On restart that session is
indistinguishable from a legacy one and resumes on global auth. That is the
exact silent-fallback the review of TASK_2026_304 rejected.

Required: write a **pending private-session record keyed by tab id before the
first query starts** (a small `pending-execution-configs.json` beside the
metadata store, or a tab-id-keyed row in the store itself). On UUID resolve the
durable lane moves it to the real id. On resume, a transcript with no metadata
field AND no pending record is legacy inherit; a pending record for that tab
id is adopted; a transcript created after the feature's store version with
neither is a typed `SESSION_EXECUTION_CONFIG_MISSING` failure, not inherit.
Store version stamping makes "created after the feature" decidable.

### F2 — HIGH: `executionConfig` must be optional on `chat:start`, defaulting to `inherit`

Plan §2 makes it required and relies on "callers upgraded in the same release".
`chat:start` is a published JSON-RPC surface of `@hive-academy/ptah-cli`. In
`apps/ptah-cli/src` alone there are twelve call sites (`session.ts`,
`interact.ts`, `chat-bridge.ts`, `session-submit.service.ts`,
`anthropic-proxy.service.ts`, …) and the `ptah-cli-usage` skill documents
external bridges (openclaw/nemoclaw) that speak this protocol. A required field
breaks every external caller and the TUI. Make it optional; the Zod schema
applies `{ kind: 'inherit' }` as default. Immutability is unaffected: the field
is still absent from `chat:continue`.

### F3 — HIGH: Batch 3 is a monolith and Batch 8 defers every proof to the end

Batch 3 owns 19 files including `sdk-agent-adapter.ts`,
`session-lifecycle-manager.ts`, `sdk-query-options-builder.ts`,
`sdk-model-service.ts`, `stream-transformer.ts`, the callback registry, fork,
and three new runtime files. That is the whole stateful core of `agent-sdk` in
one batch with no spec of its own. Batch 8 then holds all 31 spec files. Seven
code batches would land unverified, and "Done when" for each batch points at a
spec that does not exist until the last batch. This violates the house rule
that a batch is verified before commit.

Required re-cut:

- **3a** durable lane on `SessionIdResolvedCallbackRegistry` + awaitable
  `StreamTransformer` callback + both adapter emit sites. Own its spec.
- **3b** private env branch in `SdkQueryOptionsBuilder` + `build-safe-env.ts`
  - identity-keyed model cache in `SdkModelService`. Own its spec.
- **3c** `PrivateSessionRuntimeFactory` + `PrivateSessionRuntime` +
  `InteractiveSessionRouter` + registration. Own its spec.
- Every code batch owns its **new** spec files (new files are disjoint by
  construction). Batch 8 becomes integration only: the three host smoke specs,
  the cross-lib proof specs, and the inherit-only regression floor.

### F4 — MEDIUM: `SdkModelService` must be shared, not re-registered per runtime

Plan §4 re-registers `SdkModelService` per private runtime. Its
`fetchModelsViaSdk` spawns the 253 MB CLI (multi-second, see
`agent-sdk/CLAUDE.md`, TASK_2026_353). A per-runtime instance starts with an
empty cache, so every private session start pays a fresh spawn, and the cache
dies with the runtime. Plan §7 already specifies identity-keyed caches
(provider id, auth route, base URL, fingerprint, tier hash). With that key one
shared instance is correct and cheaper. Keep the singleton; pass identity
explicitly on private calls; use `invalidateForAuthChange` semantics per
identity. Same reasoning applies to `ClaudeCliDetector` (already shared) and to
`SessionMetadataStore` (already shared).

### F5 — MEDIUM: `PrivateSessionRuntime` must not be a second `SdkAgentAdapter`

Plan §4 lists "the private `IAgentAdapter` implementation" as a new class.
`SdkAgentAdapter` is ~1100 lines and owns start/resume/continue/slash/fork/
rewind/abort orchestration. A parallel implementation is the "second
`agent-sdk`-shaped monolith" the root `CLAUDE.md` forbids and will drift.
Required: extract the adapter's constructor-time global wiring (lines 207-233:
`events.onConfigChanged`, `events.onAuthFileChanged`, workspace subscription,
ambient-auth `initialize`) behind an `AdapterRuntimeMode` so the SAME class can
be constructed in `mode: 'private'` with a fixed profile, no subscriptions, and
`initialized = true` from the fixed profile. The private runtime then IS an
`SdkAgentAdapter` instance resolved from the child container. The router's
`inherit` branch delegates to the singleton exactly as today. This also closes
finding 1.1 of the earlier review (the `initialized` gate) without touching the
global path's semantics.

### F6 — LOW: two ownership overlaps in the batch map

- `libs/backend/agent-sdk/src/index.ts` is owned by Batch 3; Batch 1 adds
  `executionConfig` helpers to `session-metadata-store.ts` that the barrel may
  need to export. Assign the barrel to whichever batch lands first or give
  Batch 1 the export.
- `libs/frontend/chat/src/lib/tokens/session-context.token.ts` moves to the
  app-shell boundary in Batch 6, but `chat-state` (Batch 5) and `canvas`
  (Batch 6) both read it. Fine as long as Batch 5 does not touch it; say so.

## Confirmed with no finding

- `chat:continue` carries no provider field today
  (`rpc-chat.types.ts:115-145`) and the plan keeps it that way.
- `ALLOWED_METHOD_PREFIXES` already allows `chat:`; `chat:close` needs only
  the shared method map + manifest entry.
- Four reset routes in `auth-rpc.handlers.ts` and the config subscriber in
  `sdk-agent-adapter.ts:210-221` are left global-only; private runtimes are
  unreachable from them by construction once F5 is applied.
- Worker / `utilityProcess` deferral triggers are measurable and the seam
  (factory + `IAgentAdapter` contract) keeps it possible.
- Gateway bridge excluded; per-workspace credentials and OAuth scoping
  excluded; private is never the default.
- All cited file paths I sampled exist, including
  `apps/ptah-cli/src/di/{expected-resolvable.ts,container.smoke.spec.ts}`.

## Required before implementation

1. Fold F1, F2, F4, F5 into `implementation-plan.md`.
2. Re-cut `batches.md` per F3 and F6 (expect 10–11 batches).
3. Then hand to `team-leader` for decomposition acceptance.

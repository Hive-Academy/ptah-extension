# TASK_2026_411 — Reconciled implementation plan

Status: approved architecture. B1 was completed and verified on 2026-09-10; subsequent batches remain pending and may proceed within the unchanged approved scope without another architecture review gate.

## Outcome

Repair the five measured failure paths without changing the selected model, silently shortening summaries, increasing the global 30 s RPC timeout, or touching a live profile:

1. Electron startup and hot writes do not parse, stringify, or structured-clone the 256 MB workspace state as one main-thread value.
2. Historical inline CLI output is durably extracted before metadata is made lean; the session index and per-session records stay bounded.
3. Dashboard analytics uses a stats-only streaming reader, exact cache validity, and progressive bounded pages.
4. Codex streamed input/cache/output usage reaches the real Anthropic SDK consumer, while subscription account activity and quota remain a separate surface.
5. Claude CLI compaction settings reach the spawned process through the supported settings payload; timing remains metadata-only and does not claim to shorten upstream summarization.

Existing database backup/integrity workers and the 180 s no-activity watchdog remain unchanged.

## Verified baseline

- `ElectronStateStorage` synchronously reads and parses the entire file in its constructor and stringifies the entire object for every update (`libs/backend/platform-electron/src/implementations/electron-state-storage.ts:18-20,55-73`).
- All sessions currently share `ptah.sessionMetadata`; each flush writes the whole array (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:20-30,124,458-464`). Historical inline agent output is already copied to its own key before the reference is leaned, and failed extraction retains the fat reference (`:349-431`).
- `session:stats-batch` currently enters the full history path, whereas the JSONL reader already streams files. The new reader must be a projection sibling, not a rewrite of resume/history behavior.
- Stream completion currently emits only `output_tokens`; the non-stream collector already implements uncached-input/cache-read mapping (`responses-stream-translator.ts:454-498`; `responses-stream-collector.ts:191-197`). `StreamEventTransformer` already accepts all final usage fields (`stream-event.transformer.ts:258-303`), so no unrelated event-typing change is required.
- Pinned `@anthropic-ai/claude-agent-sdk` 0.3.150 does not type `Options.compactionControl`. Its process setup destructures supported options and forwards `settings` to `ProcessTransport`; `compactionControl` is absent. The same bundle uses that field only in the in-process deprecated `BetaToolRunner` path. The pinned types describe `settings` as the `--settings` flag (`sdk.d.ts:1709-1718`) and type `autoCompactWindow`/`autoCompactEnabled` (`:5180-5183,5370-5373`). The bundled validator requires an integer window in `[100000, 1000000]`; the pinned Claude 2.1.150 executable describes that range as tokens and applies it through model-aware context calculations.
- `CodexAuthService` hardcodes `~/.codex/auth.json` (`codex-auth.service.ts:23-43`), while the repository’s verified Codex-home resolver honors `CODEX_HOME` (`harness-sync/.../codex-home.ts:43-53`). This can make proxy identity differ from App Server identity.
- The lock resolves `@openai/codex-sdk` and its CLI to 0.147.0. The bundled 0.147.0 executable contains `account/rateLimits/read` and `account/usage/read` and supports version-matched schema generation. Official OpenAI documentation shows both reads without `params`, documents their response purposes/auth constraints, and says generated schemas match the invoked CLI version: [Codex App Server documentation](https://learn.chatgpt.com/es-419/docs/app-server).

## Constraints and non-goals

- Preserve the `platform-core` hexagonal boundary and behavior in VS Code, Electron, and headless CLI.
- Use Zod at file, worker-message, RPC, SSE, and App Server JSON-RPC boundaries.
- Generated fixtures, disposable homes, and fake local services only. Never inspect or modify a real Ptah, Claude, or Codex profile in implementation tests.
- No React product code, second sanitizer, concrete adapter import in backend core, provider inference for historical data, credential output, or authenticated upstream test.
- No `max_output_tokens` on the subscription route, model substitution, arbitrary shorter compaction prompt, 600 s proxy timeout change, or watchdog behavior change.
- Preserve all historical output. No migration or cleanup may delete the last durable copy.

## A. Workspace state and metadata

### A1. Optional cross-host capabilities

Keep `IStateStorage` source-compatible for VS Code/CLI. Add optional interfaces in `platform-core`:

- `IAsyncStateStorage`: async scalar read/update plus bounded JSON-sequence read/write operations.
- `IStateStorageReadiness`: `whenReady()` and a typed readiness state/error.
- `IStateStorageMaintenance`: a generic, declarative `splitArrayValue` migration executed by the adapter worker.

The migration description is data, not an Electron import: source key, schema version, item-id field, summary field allowlist, per-item destination prefix, nested extraction recipes, and commit receipt. `agent-sdk` owns the session-metadata recipe; the Electron composition root supplies it when it constructs workspace storage. `platform-electron` remains domain-agnostic.

`WorkspaceAwareStateStorage` forwards capabilities to exactly the delegate selected for the operation. An unregistered active workspace is an error rather than a default-store fallback for readiness/mutation. `setActiveWorkspace` does not publish a new active delegate until that delegate is ready.

Before readiness:

- synchronous `get()` and `keys()` throw `StateStorageNotReadyError`;
- `update()` rejects with the same typed error;
- no default/empty value is returned and no mutation is queued.

This is intentional: an empty answer can cause initialization code to overwrite recovered data. Electron gates all non-migration consumers; VS Code/CLI adapters are immediately ready.

### A2. Crash-identifiable v2 layout

Use an adjacent directory; retain v1 byte-for-byte:

```text
workspace-storage/<workspace>/
  workspace-state.json
  workspace-state.v2/
    CURRENT
    manifests/manifest.<generation>.json
    values/<encoded-key>.<generation>.json
    staging/<operation-id>/...
```

The manifest records schema version, generation, v1 source hash, `mutationEpoch`, and key blob length/hash. There is no rollback journal: committed blobs already define final state, a content-free journal cannot reconstruct values, and an unbounded mutation log would add write amplification.

Commit order is blob temp write → file flush → same-directory rename → manifest temp write/flush/rename → `CURRENT` temp write/flush/rename. Keep the prior complete v2 generation for explicit diagnostics/recovery until a later verified commit; do not automatically serve it after corruption.

Durability claim is precise: ordering and flushes make process-crash states identifiable and prevent a partial mixed generation. Node/Windows rename does not provide `MOVEFILE_WRITE_THROUGH`, so power-loss durability of the final directory entry is not promised.

Recovery rules:

- No valid v2 commit, or a migration commit with `mutationEpoch === 0`: quarantine incomplete v2 and retry from the retained v1.
- A committed v2 with `mutationEpoch > 0` and a missing/hash-invalid current blob: enter `recovery-required`; never silently fall back to stale v1 or an older v2 generation.
- A crash before `CURRENT` moves leaves the previous committed generation current. A crash after it moves selects only the fully verified new manifest.
- Staging/unreachable blobs may be swept only after a later successful commit and never while referenced by current/prior retained manifests.

### A3. Domain migration: output first, metadata second

The worker performs the session recipe while v1 is still the authoritative source and does not send the parsed aggregate to the main thread:

1. Parse `ptah.sessionMetadata` in the worker.
2. For every fat CLI reference, write per-agent output manifests/chunks first. Merge with any existing `ptah.agentOutput:<agentId>` using the current append-only “longer wins” rule.
3. Write a lean per-session detail at `ptah.session:<sessionId>` containing session fields and lean CLI references only.
4. Write `ptah.sessionMetadata` as a versioned lean index containing identity, name, workspace, timestamps/status, child flag, and aggregate usage—no segments or stream events.
5. Reread and hash-check every destination, then commit one manifest generation. Only that commit makes the lean index authoritative.

If any extraction or validation fails, no lean generation commits; v1 retains the fat record and retry is idempotent. Nothing is deleted. Blank/malformed agent ids keep their output in the per-session detail and mark migration coverage degraded rather than discarding it.

Normal writes update one per-session detail and its small index entry. `SessionMetadataStore` remains the public facade and preserves its serialized read-modify-write semantics, but no longer stages the all-session details array. Destructive order remains: remove references/index durably before deleting output chunks.

### A4. Bounded worker traffic and lazy output

Set a worker-message budget (initially 256 KiB, a constant tested at the protocol boundary). Large arrays use a JSON-sequence protocol:

- main-to-worker writes send one/bounded groups of events; long string fields are split into tagged transferable UTF-8 slices and reconstructed in the worker without truncation;
- the worker alone performs JSON serialization and hashing;
- worker-to-main reads parse in the worker and return bounded pages/slices, yielding between pages;
- historical oversized items remain worker-local during migration.

Do not reassemble all agent output merely to cross another boundary. Replace startup calls to `getCliSessionsForRestore()` with lean reference restoration. `AgentProcessManager` restores the record first and obtains output pages lazily. Add a bounded `session:cli-output-page` RPC used by the monitor/tree UI; `chat:resume` and `session:cli-sessions` no longer carry full stream-event arrays. Retain a compatibility facade only where a bounded test fixture proves it cannot enter Electron startup/UI IPC.

Acceptance gate: no JSON parse/stringify or structured-clone message larger than the configured budget on Electron main during migration, normal metadata/output writes, resume, or output reads.

### A5. Boot and rollback

Create `BrowserWindow` with a bundled CSP-safe “Preparing workspace history” shell. Complete v2 verification and the session recipe before loading Angular, registering state-reading RPC work, or starting session import. Migration failure leaves the shell in a recovery state with a credential-free error code.

For workspace switches, keep the old delegate active until the new delegate reaches ready. No consumer can observe a not-ready delegate as active.

Rollback is explicit:

- Before any v2 mutation, the untouched v1 remains a complete downgrade source.
- After v2 mutations, a worker `materialize-v1` operation serializes the valid current v2 state (including reconstructing legacy metadata/output shape), verifies it, rotates old v1 to a timestamped backup, and replaces `workspace-state.json`.
- If current v2 is corrupt, materialization stops and surfaces recovery-required; it never claims stale v1 is current.
- No v1/v2 generation or backup is automatically deleted in this task.

## B. Stats-only analytics

Add `SessionStatsReaderService`; `session:stats-batch` must not call `readSessionHistory()`.

The reader streams JSONL and projects only record/subtype/timestamp, parent/session identity, model id, usage fields, assistant count, and compact-boundary timestamp. It retains no content blocks, tool payloads, replay events, or message arrays; it yields by line/byte budgets and honors `AbortSignal`.

Accounting contracts:

- `scope: 'current-context'` remains the compatibility default for current-session callers.
- `scope: 'range'` counts timestamped parent/subagent usage in `[since, until)` for dashboard analytics.
- Untimestamped records are omitted from range totals and produce `coverage: 'partial'` plus a count.
- Historical provider/model evidence comes from transcripts. Missing provider remains unknown; costs are nullable current-rate-card estimates.

RPC pages contain at most 20 session ids and process at most two parent files concurrently, with a small subagent cap. The dashboard captures one `until`, fetches progressively, merges each page into signals, and cancels old workspace/range generations. The frontend cache key includes workspace scope, range, `until`, and session id.

Backend cache identity includes normalized workspace/session/scope/range plus exact main file and subagent membership `(path,size,mtimeMs)` tokens and rate-card revision. Use bounded entry/byte LRU and in-flight coalescing. TTL may limit reuse but never substitutes for validity. Failed/aborted results are not cached. Surface `session:list.hasMore` so totals never imply more than the loaded 200 sessions.

## C. Codex streamed usage parity

Create one pure Responses→Anthropic usage mapper and response Zod schema. Terminal mapping is:

- `input_tokens = max(0, input_tokens - cached_tokens)`;
- `cache_read_input_tokens = cached_tokens` when upstream supplies it;
- `output_tokens = output_tokens`;
- no cache-creation value unless upstream supplies one.

`ResponsesStreamTranslator` retains `input_tokens_details.cached_tokens` and emits full final usage on `message_delta`; initial `message_start` remains zero because terminal usage is not known yet. Reuse the mapper in forced-stream collection and ordinary non-stream translation. Log schema categories only, never response bodies.

Do not modify `StreamEventTransformer` typing merely to satisfy this task; it already consumes the fields. The decisive integration test is fake Responses SSE → `CodexTranslationProxy` → real `@anthropic-ai/sdk` stream consumer → Ptah transformer/live tracker. It covers cached/uncached text, tool use, split frames, duplicate terminal/DONE, missing usage, malformed values, and early EOF, and proves parity with non-stream output.

## D. Separate Codex account usage/quota

Use local `codex app-server` JSON-RPC, never a guessed private HTTPS endpoint. `account/rateLimits/read` and `account/usage/read` are sent with `method` and `id` only—omit `params` entirely. Response payloads are validated with version-matched Zod schemas.

Add one `codex-home-resolver.ts` inside `auth-providers`. `CodexAuthService` derives its auth path/watch directory from that resolver, and `CodexAccountUsageService` sets the spawned process’s `CODEX_HOME` to the exact same resolved directory. Tests inject disposable home/env inputs; they never read the developer’s environment or auth file. A custom non-native proxy endpoint returns `unsupported-config` rather than presenting App Server data as the proxy account.

Resolve the packaged Codex executable corresponding to lockfile 0.147.0, request `--version`, and feature-gate against schemas generated from that executable. The implementation batch checks generated schema artifacts into the owning lib; runtime does not generate files. Unknown/new nullable fields remain unavailable rather than guessed. A method-not-found response maps to `cli-version-unsupported`.

On demand, start stdio App Server through `IProcessSpawner`, send `initialize` then `initialized`, call `account/read`, then the two reads, and terminate on success/error/abort/budget expiry after draining close. Do not send login/refresh requests. Never log or return tokens, auth headers, email, raw stdout, or raw error payloads.

Expose `provider:getAccountUsage` under the existing prefix with `available`, `unsupported-auth`, `unsupported-config`, `provider-unsupported`, `cli-unavailable`, `cli-version-unsupported`, `service-unavailable`, and `stale` states. Cache briefly with `fetchedAt`; manual refresh bypasses cache and auth mutations invalidate it.

The Angular card is separate from local session analytics. Rate-limit percentages/windows are quota; lifetime/daily tokens are activity, not remaining subscription messages or invoice amounts. Local costs are labeled “Estimated from recorded usage and current rate card.” Headless CLI receives the same RPC contract without a TUI-only implementation.

## E. Supported compaction control and timing

Do not use `Options.compactionControl` anywhere. Merge into the existing flag-tier settings builder on both interactive and CLI-agent paths:

```ts
{
  autoCompactEnabled: enabled,
  autoCompactWindow: validatedWindow,
}
```

`autoCompactEnabled: false` must be explicit. `autoCompactWindow` is a token-count window in integer range `[100000,1000000]`; the CLI derives a model-aware effective compaction limit from that configured window, so do not promise that the raw number is the exact first-compaction counter value. Align VS Code contribution validation with the supported range (current advertised minimum 50,000 is rejected by the pinned validator). Invalid persisted values produce a warning and the documented 100,000 default; they are never silently omitted.

The acceptance test invokes the real pinned SDK with a fake `spawnClaudeCodeProcess`, captures `SpawnOptions.args`, parses the effective `--settings` JSON, and asserts enabled/disabled/window values for both paths. An assertion against the Ptah options object is insufficient. Also assert model, system prompt, output style, and other settings are unchanged.

Timing records contain only opaque request/attempt ids, provider/model id, retry ordinal, stream mode, monotonic phase timestamps, status, byte counts, terminal token counts, and overlap count. Compaction hooks record pre/post times. Interval correlation to proxy calls is marked `exact: false`; no prompt, summary, tool payload, header, credential, or body is logged.

Threshold control changes when compaction begins, not how long the upstream 213–216 s summarization takes. Keep manual `/compact`, summary behavior, 600 s upstream timeout, selected model, and 180 s watchdog semantics unchanged.

## Concrete file targets

Storage/contracts and migration:

- `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`, new async/readiness/maintenance interfaces, errors, and `src/index.ts`.
- `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts` and specs.
- `libs/backend/platform-electron/src/implementations/electron-state-storage.ts`; new manifest, worker protocol, worker, and specs; registration/build exports.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`; new session metadata migration recipe/output paging collaborator and specs; relevant barrels.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`, `src/lib/wiring/agent-events.ts`, and focused lazy-output specs.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, `handlers/session-rpc.handlers.ts`, schemas/specs; shared RPC types; frontend agent-monitor state needed for paged output.
- `apps/ptah-electron/src/di/phase-1-infra.ts`, pre/post-window activation, IPC bridge, assets, `project.json`, worker/build/smoke specs, and expected-resolvable/absent manifests if registrations change.

Analytics:

- New `session-stats-reader.service.ts` and usage aggregator in `agent-sdk`; extend `jsonl-reader.service.ts` with a projection iterator; tokens/register/barrels/specs.
- Session RPC handler/schema/shared contracts and dashboard analytics state/templates/specs.

Codex usage/account/timing:

- Responses usage mapper/schema, translator/collector, translation proxy base, and specs in `auth-providers`.
- New Codex home resolver and account-usage service/schema/types; update auth service, DI/register/barrels/specs.
- Provider RPC handler/schema/shared contracts and separate dashboard provider-account state/card.
- Compaction config/settings builder, CLI spawn assembly/registry, hook timing, VS Code setting metadata, and specs.

See `batches.md` for exclusive ownership, dependencies, commands, and gates.

## Acceptance matrix

Storage correctness/performance:

- Generated 256 MB v1 fixture with 174 output keys/214,837 events migrates without data loss; fat output is durable before lean records commit.
- Failure injection after every write/flush/rename/verify step selects v1 only before the first v2 mutation, otherwise selects the valid current v2 or enters recovery-required—never a silent stale fallback or partial mix.
- `materialize-v1` round-trips v2-era mutations and retains backups; corrupt current v2 refuses materialization.
- Readiness tests prove no default read or write before ready and correct per-delegate workspace switching.
- Main-thread instrumentation fails on parse/stringify or structured-clone messages above 256 KiB for migration, output write/read, resume, and hot metadata updates.
- Event-loop heartbeat remains responsive; update bytes scale with the changed session/output page, not profile size. Wall-clock comparisons are secondary and use best-of-three on a quiet reference host.

Analytics:

- Golden fixtures cover compaction boundaries, nested/legacy subagents, mixed models, cache tokens, malformed/untimestamped lines, cancellation, and exact invalidation after append/rewrite/add/remove/workspace/range changes.
- A synthetic 200-session/37-subagent set returns each 20-id page within the existing timeout on the reference host and paints page one before later pages. Concurrency/yield gates are primary.

Codex:

- Fake local Responses/App Server only; no authenticated network.
- Actual Anthropic SDK consumer and Ptah tracker receive identical uncached/cache/output totals to non-stream translation.
- Fake App Server verifies initialization, omitted params, ids, exact `CODEX_HOME`, packaged-version gating, response schemas, timeout/abort/close, cache, and redaction.
- UI never combines account quota/activity with local estimated usage.

Compaction/regression:

- Real SDK fake-spawn capture proves effective `--settings` for enabled, disabled, boundary windows, and invalid persisted values on both spawn paths.
- Model/system prompt and unsupported request parameters remain unchanged.
- Delayed fake SSE and hook tests prove phase timing cannot throw or alter output; overdue watchdog continues and a 216 s completion still reaches PostCompact/clears UI state.
- Run targeted test/typecheck/lint/build for every touched project, then VS Code/Electron/CLI smoke contracts. Use project names from each `project.json`; verify Nx reports the requested count. Run `nx reset` only if a project file changed and no other executor is using the worktree.

## Supported, uncertain, and blocked

Supported by pinned/local evidence:

- `Options.settings` reaches ProcessTransport as `--settings`; `autoCompactEnabled` and integer `autoCompactWindow` `[100000,1000000]` are accepted settings.
- Responses terminal cached-input details and existing Ptah final-usage consumption.
- Codex CLI 0.147.0 includes the two account methods and schema-generation command.
- Official App Server protocol/account behavior described above, tested without credentials using a fake server.

Uncertain; do not guess:

- The CLI’s internal model-aware transformation from configured token window to exact effective trigger is not a stable Ptah contract; test forwarding and observed hook behavior, not private formula equality.
- Installed external Codex CLIs may differ from packaged 0.147.0; gate on packaged/version-matched schemas and surface unsupported versions.
- Account activity is not remaining messages/credits or billing. Do not derive allowance.
- Proxy-request/compaction correlation remains interval-only and inexact.
- Upstream compaction latency may remain 213–216 s; this task provides control and observability, not an unsupported latency promise.
- Missing historical provider identity remains unknown/null cost.

Remaining product blockers only if scope expands:

- Seamless downgrade after v2 mutations without explicit materialization would require dual-writing the giant v1 file and reintroduce the freeze.
- Automatic recovery from a corrupted post-mutation v2 would require an explicit user-selected data-loss policy; this plan fails closed.
- If a 20-session stats page still exceeds 30 s on the reference host, lower the page cap; do not increase the global timeout.

No new discretionary product choice is introduced by this reconciliation. The visible minimum compaction-window correction and fail-closed storage behavior are required safety/compatibility consequences of verified pinned behavior.

## Execution status

The user approved the reconciled architecture and its storage correction. B1 is complete with evidence in `b1-report.md`; B2 and later batches remain pending. Any scope expansion or genuinely new product choice still requires explicit review. All implementation and validation stays in this worktree and uses only temp profiles/fake services.

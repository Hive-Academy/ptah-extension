# 05 — Architecture Proposal: Runtime-Agnostic Compaction Coordinator

TASK_2026_406. Evidence-based design for compaction coordination across the
Claude Agent SDK path, the ptah-cli spawn path, and non-Anthropic providers
(Ollama Cloud, OpenAI Codex translation path). Research only — nothing here is
implemented.

Evidence classes used throughout:

- `[F]` measured fact — read from source or logs in this repository.
- `[C]` documented contract — SDK `.d.ts` / bundled code / official docs.
- `[I]` inference — reasoned from `[F]`/`[C]`, not measured.
- `[U]` unknown — no evidence available; must be gated, not assumed.

Source-validation date for all repository file:line references and
`node_modules` reads: 2026-09-10 (this session). Report 03's cited web URLs
carry their own access dates (2026-09-10 as recorded in report 03; the
orchestration record says 2026-09-09 — the discrepancy is unverified and does
not affect any code-level claim, all of which I re-validated directly).

## 1. Provenance of inputs

| Report | Status | Note |
|---|---|---|
| 01-runtime-map | read in full, claims re-validated | One correction: §"ptah-cli constructs the compactionControl the SDK accepts" is wrong — see §3.2. Also its citation of `session-query-executor.service.ts` omits the `helpers/` path segment; correct path is `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`. |
| 02-full-log-forensics | read in full; file exists on disk although the bridge recorded the worker as BLOCKED before spawn | Content is available and internally consistent, but its provenance is bridge-unverified. Treat its numbers as `[F]*` (measured by an unconfirmed worker). |
| 03-native-runtime-contracts | read in full, claims re-validated | Access-date discrepancy noted above. Code claims verified against `node_modules` directly. |
| 04-provider-capabilities | read in full, claims re-validated | §5 "auto-compact never fires on third-party base URLs" (issue anthropics/claude-code#65585, closed "not planned") conflicts with report 02's single measured auto compaction on the openai-codex path. Both are carried as unresolved — see §11. |

## 2. Validated capability ground truth (the design's foundation)

### 2.1 What the Claude Agent SDK 0.3.150 actually offers

Measured and verified this session (`node_modules/@anthropic-ai/claude-agent-sdk/`,
version `"0.3.150"` in package.json:3):

| Lever | Evidence | Class |
|---|---|---|
| Send the literal string `"/compact [instructions]"` as a new query prompt → manual compaction fires | `sdk.d.ts` slash-command surfaces; Ptah's own dispatch (§2.3); report 03 §2 with docs URLs (accessed 2026-09-10 per report 03) | `[C]` |
| `Options.settings?: string \| Settings` at query build; `Settings.autoCompactWindow?: number`, `Settings.autoCompactEnabled?: boolean` | sdk.d.ts:1726, 5183, 5373 | `[C]` |
| `autoCompactWindow` is zod-bounded in the bundled sdk.mjs: `number().int().min(1e5).max(1e6)` — integer 100,000–1,000,000 | bundled sdk.mjs (grep, this session) | `[F]` |
| `Query.applyFlagSettings(partial Settings)` mid-session; each key accepts `null` to clear | sdk.d.ts:2178-2180 | `[C]` |
| `Query.getContextUsage(): Promise<SDKControlGetContextUsageResponse>`; response's `autoCompactThreshold?` is optional — absent means unknown | sdk.d.ts:2213-2218, 2764 | `[C]` |
| PreCompact hook: `{trigger, custom_instructions}`; PostCompact hook: `{trigger, compact_summary}` — notification-only, no block/modify | sdk.d.ts:2081, 2009; report 03 §3 (hooks docs, accessed 2026-09-10 per report 03) | `[C]` |
| `SDKCompactBoundaryMessage` with `compact_metadata {trigger, pre_tokens, post_tokens?, duration_ms?, preserved_segment?, preserved_messages?}` | sdk.d.ts:2587-2613 | `[C]` |
| `SDKStatusMessage.compact_result?: 'success'\|'failed'` + `compact_error` | sdk.d.ts:3528 | `[C]` |
| `compactionControl` / `contextTokenThreshold` in the bundle exist ONLY in the Anthropic Messages API client agent-loop layer (paired with `max_iterations`, behind a deprecation `console.warn`), NOT in the SDK `Options` type; `Options` has no `compactionControl` field and no `Options.compact()` method | sdk.mjs grep + sdk.d.ts full grep, this session | `[F]` |

### 2.2 What does NOT exist (hard gates)

- No SDK option to block, cancel, or modify an in-flight compaction. `[C]`
- No API to replace or edit conversation history from the host. `[C]`
- No way to read the SDK's effective `autoCompactThreshold` when the field is
  absent from `getContextUsage()`. `[C]`
- Codex TS SDK 0.147.0: zero compaction surfaces in `dist/index.d.ts` (grep
  for `compact`, case-insensitive: no matches, this session). The Codex wire
  has `Op::Compact`/`ContextCompacted` in-process, but no verified
  app-server RPC and no hook subscription through the TS SDK. `[F]`/`[U]`

### 2.3 What Ptah already has (all re-validated)

- `CompactionConfigProvider` (`libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`):
  reads `ptah.compaction.enabled` (default `true`) and `ptah.compaction.threshold`
  (default `100000`, values `<1000` rejected with warn). `[F]` (:30-33, :71-86)
- The chat path **reads and logs** this config at
  `sdk-query-options-builder.ts:762-773` but **forwards nothing** — the
  returned `Options` (:782-895) contain no compaction field. `[F]`
- `SlashCommandInterceptor` (`helpers/slash-command-interceptor.ts:30`):
  `NATIVE_COMMANDS = new Set(['clear'])`; `/compact` → action `'new-query'`.
  The SDK parses slash commands only from raw string prompts to `query()`. `[F]`
- Dispatch seam: `ChatSlashCommandRouterService.routeFollowUpSlashCommand`
  (`rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:104-149`)
  calls `sdkAdapter.executeSlashCommand(sessionId, command, {sessionConfig…})`. `[F]`
- `CompactionHookHandler` (`helpers/compaction-hook-handler.ts:174-226`):
  validates trigger union `'manual'|'auto'`, rejects null sessionId, lazily
  resolves `preTokens` from `LiveUsageTracker`, fans out via
  `CompactionCallbackRegistry` with per-subscriber try/catch; always returns
  `{continue: true}`. `[F]`
- `ICompactionCallbackRegistry` port (`memory-contracts/src/lib/compaction-callback.port.ts`):
  zero-dep, `sessionId` non-blank invariant, pinned by spec. `[F]`
- `LiveUsageTracker` (`helpers/live-usage-tracker.ts:114,138,156`):
  two slots (live max-snapshot + resume baseline), `seedResumedSession`,
  `getCumulativeTokens`, `clearSessionTokenSnapshot` (drops both; called at
  `compact_boundary` per :148 comment). `[F]`
- `NoActivityWatchdog` (`helpers/no-activity-watchdog.ts`): 180s constant at
  :249; `compacting` flag set on status `'compacting'` (:185), cleared on
  `compact_result` (:187) and `compact_boundary` (:189); `onOverdue` receives
  an operations list including `'compaction'` (:222). Wired in
  `session-query-executor.service.ts:158-214` with cleanup-first abort
  ordering; `onOverdue` integration site confirmed at
  `session-query-executor.service.ts:204-213` (log-and-re-arm — answers report
  01 §14 open question). A slash-command query takes no idle hold, so the
  watchdog arms on `start()` (`session-query-executor.service.ts:226-235`). `[F]`
- `resolveContextWindowOverride` (`sdk-query-options-builder.ts:912-924`):
  sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` only for non-first-party base URLs with
  a known window; pins the SDK's window detection for proxies. `[F]`
- ptah-cli path: `PtahSpawnAssembly.compactionControl` built at
  `cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:221-227`,
  forwarded at `ptah-cli-registry.ts:702-753` — but the object is `as Options`
  cast at :753 and `Options` has no such field (§2.1). The runtime
  `compactionControl` references live in the Anthropic API client layer the
  spawn does not reach. `[F]`/`[I]` **This is dead configuration.**

### 2.4 Log evidence (report 02, `[F]*`)

- 36 compaction starts / 29 sessions; 35 manual, 1 auto (openai-codex path,
  provider `gpt-6-astra`, local translation proxy; killed by the 180s watchdog
  180.01s later).
- 23 of 36 starts had `preTokens=0` — the lazy `ensurePreTokens` slot was
  empty, i.e. usage tracking was unavailable at compaction time. This is the
  measured basis for the "unreliable usage" fallback requirement.
- A manual compaction succeeded in 157s, then hit session-not-found 23ms
  after PostCompact.
- Memory curator reacted 62ms after a Compaction-started log line.
- `compactionThreshold=100000` fixed in all logs — consistent with §2.3: the
  value is logged, never enforced at the SDK level.

## 3. Feasibility assessment

### 3.1 Can we do it at all?

**Yes, partially — an observe-and-trigger coordinator is feasible on existing
seams. A replace-history or modify-summary coordinator is NOT feasible with
SDK 0.3.150 and must not be promised.**

Feasible with current code, no SDK upgrade:

1. Trigger compaction at a chosen moment: send `"/compact " + instructions`
   through the existing `executeSlashCommand` seam. `[F]` (seam exists),
   `[C]` (SDK behavior).
2. Make `ptah.compaction.threshold` actually mean something: translate it to
   `Settings.autoCompactWindow` at query build (bounded 100k–1M `[F]`), or
   `applyFlagSettings` mid-session.
3. Observe the full lifecycle: PreCompact/PostCompact hooks +
   `compact_boundary` + `compact_result` status. All already wired through
   `CompactionHookHandler`.
4. Read live usage on the Claude path: `Query.getContextUsage()`; fall back to
   `LiveUsageTracker.getCumulativeTokens()`; on Codex path, usage observation
   is `[U]` and the coordinator degrades to observe-only.

Not feasible (gate, do not build):

- Cancel or block an in-flight compaction. `[C]` no API.
- Modify the summary the SDK writes. `[C]` PostCompact is notification-only.
- Replace history / roll back post-compaction from the host. `[C]`/`[U]`.
- Programmatic compaction on the Codex TS SDK path. `[F]` no surface.
- Know the SDK's internal auto-compact threshold when
  `getContextUsage().autoCompactThreshold` is absent. `[C]`.

### 3.2 Correction to report 01

Report 01 treats the ptah-cli `compactionControl` as "the only path that
actually constructs the compactionControl object the SDK accepts". The SDK
`Options` type accepts no such field (§2.1); the registry passes it through an
`as Options` cast (`ptah-cli-registry.ts:753`) and no SDK layer reads it.
`[F]` Therefore **no existing path enforces `ptah.compaction.threshold` at the
SDK level**. The chat path's auto-compaction is the SDK's own (possibly
regressed behind third-party base URLs per issue #65585 — unresolved, §11),
plus the `CLAUDE_CODE_MAX_CONTEXT_TOKENS` window pin.

## 4. Option comparison and recommendation

| | A. Runtime delegation | B. Provider endpoint | C. Ptah-owned summarization |
|---|---|---|---|
| Mechanism | SDK auto-compact + `autoCompactWindow` tuning; hooks observe | Call the provider's own context/summarize API | Ptah runs its own summarizer (memory-curator pattern) over the transcript, then… what? |
| History control | SDK-owned; host cannot modify result `[C]` | Same `[U]` | **None** — host cannot write the result back into the session `[C]` |
| Trigger control | Indirect (window tuning, bounded 100k–1M) | `[U]` none verified | Full |
| Works on Ollama Cloud / Codex / proxy paths | Questionable (issue #65585, unresolved) | No such endpoint verified on Ollama or Codex `[U]` | Trigger yes; replacement no |
| Failure modes observed | Watchdog kill `[F]*`; session-not-found after PostCompact `[F]*` | Unverified | Doubles token cost; no write-back |
| New code | Smallest | Speculative | Largest, and dead-ends at the write-back wall |

**Option C alone is a dead end**: Ptah can compute the best summary in the
world, and the SDK gives no API to substitute it for the conversation. `[C]`
The only "write-back" the SDK offers is the `custom_instructions` string on
`/compact` — i.e. Option C survives only as *instructions enrichment* fed into
Option A's trigger.

**Recommendation (smallest safe design): Option A as the engine, with a thin
Option-C enrichment layer, all behind capability gates.**

Concretely: a `CompactionCoordinator` that

- observes via the existing `ICompactionCallbackRegistry` (no new hook plumbing),
- reads usage via a new zero-dep `IContextUsagePort` (memory-contracts) with a
  three-level fallback,
- triggers at turn boundaries by injecting `/compact <enriched instructions>`
  through the existing `executeSlashCommand` seam,
- tunes the native backstop via `Settings.autoCompactWindow`,
- and refuses (logs + no-ops) on every gated operation in §3.1.

## 5. Design

### 5.1 Ports and ownership

| Concern | Port / owner | Location |
|---|---|---|
| Lifecycle events | `ICompactionCallbackRegistry` (existing, unchanged) | `memory-contracts/src/lib/compaction-callback.port.ts` |
| Usage reading | NEW `IContextUsagePort`: `getContextUsage(sessionId): Promise<{usedTokens: number; windowTokens: number} \| null>` — `null` means "unknown; do not auto-trigger" | `memory-contracts` (zero-dep, beside the callback port) |
| Trigger execution | Existing `IAgentAdapter.executeSlashCommand` | `shared` / agent-sdk adapter |
| Window tuning | Existing options builder + `Settings.autoCompactWindow` | `agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` |
| Coordination state machine | NEW `CompactionCoordinator` (single class, DI-registered) | `agent-sdk/src/lib/helpers/compaction-coordinator.service.ts` (new) |
| Liveness | Existing `NoActivityWatchdog` — unchanged; coordinator relies on it, does not own it | `agent-sdk/src/lib/helpers/no-activity-watchdog.ts` |
| Durable knowledge capture | Existing memory-curator PreCompact reactor (already reacts `[F]*` within 62ms) | `memory-curator` — unchanged in stage 1 |

Platform boundaries: everything lives in backend libs; no adapter imports; no
frontend dependency. `IContextUsagePort` is implemented once in `agent-sdk`
(Claude path: `Query.getContextUsage()` + window from the model registry /
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` pin) and returns `null` on paths without the
capability. The coordinator queries the port, never the SDK directly — so the
CLI/Electron/VS Code hosts need zero changes.

### 5.2 Bounded state machine

```
IDLE ──(usage ≥ trigger)──► ARMED ──(turn idle & no compact in flight)──► TRIGGERED
ARMED ──(usage drops / provider switch / disable)──► IDLE
TRIGGERED ──(inject "/compact …")──► COMPACTING
COMPACTING ──(compact_boundary or PostCompact)──► COOLDOWN
COMPACTING ──(compact_result 'failed' / query error / watchdog abort)──► BACKOFF
COOLDOWN ──(cooldown elapsed AND usage < re-arm level)──► IDLE
BACKOFF ──(retry < 2, after backoff)──► ARMED
BACKOFF ──(retry ≥ 2)──► OBSERVE_ONLY (until session end)
```

Bounds: one coordinator instance per session; every state has a maximum
dwell (ARMED 60s, COMPACTING watchdog-covered 180s+overdue, COOLDOWN default
5min, BACKOFF exponential 1min/4min). Every transition is logged with
`{sessionId, from, to, reason, usage}`.

### 5.3 Trigger math: 80% of effective context, with reserve

```
effectiveContext = windowTokens − reserveTokens
reserveTokens    = outputReserve + toolReserve   (default 32_000, configurable)
triggerLevel     = 0.80 × effectiveContext
```

- `windowTokens`: from the provider/model registry when known; on the Claude
  proxy path this is the same source `resolveContextWindowOverride` already
  pins via `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (reuse it, do not re-derive). `[F]`
- If `windowTokens` is unknown → **no auto-trigger**. Manual `/compact` and
  observation stay available. Never trigger on a fabricated window. `[I]`
- Native backstop: set `Settings.autoCompactWindow` to
  `max(100_000, min(1_000_000, triggerLevel))` — the zod bound `[F]` is a hard
  constraint; values outside it are clamped, not rejected silently.

### 5.4 Unreliable-usage fallback (three levels, fail-closed)

Report 02 measured `preTokens=0` on 23/36 starts `[F]*` — usage data IS
unreliable in practice. Policy, in order:

1. `IContextUsagePort` → `Query.getContextUsage()` (Claude path). Trust when
   the response carries used tokens.
2. `LiveUsageTracker.getCumulativeTokens(sessionId)` against the known window.
   Trust only when the live slot is populated (nonzero); a zero answer after a
   resume is exactly the failure `[F]*` shows — do not treat 0 as "empty
   context".
3. Neither available → **coordinator stays in IDLE with auto-trigger disabled**
   for that session; native SDK auto-compact (backstop window) remains the
   only automatic compaction. Fail closed: a missed compaction is recoverable
   by the backstop; a wrong one is not.

### 5.5 Reduction target and hysteresis

- Target: after compaction, `usedTokens ≤ 0.5 × effectiveContext` (measured
  from `compact_metadata.post_tokens`, sdk.d.ts:2587-2613 `[C]`).
- Hysteresis: after any compaction, COOLDOWN blocks re-trigger until BOTH
  (a) `cooldownMs` elapsed and (b) usage climbed back above `triggerLevel`.
  No double-trigger from a boundary-adjacent usage spike.
- Escalation: if `post_tokens > 0.7 × effectiveContext` (compaction barely
  helped — long preserved segment), log a `context-pressure` notice for the
  user ("start a new session or clear") and lower the backstop
  `autoCompactWindow` by one step within the zod bound. Do not auto-clear or
  auto-fork. `[I]` (both would touch gated operations.)

### 5.6 Tool atomicity and safe points

- The coordinator triggers **only at turn boundaries**: turn state must be
  `idle` (existing `SessionTurnStateRegistry` phase) and no compaction in
  flight (watchdog `compacting` equivalent observable through
  `compact_result`/`compact_boundary` events the coordinator already
  receives). Never inject mid-tool-call. `[I]` The SDK's own auto-compact
  remains the mid-turn safety net — that is exactly why the backstop window
  must be set rather than disabled.
- Tool-call pairing (`tool_use`/`tool_result` relink) is SDK-owned;
  `preserved_segment`/`preserved_messages` in `compact_metadata` report what
  was kept. `[C]` The host cannot influence pairing — do not try.

### 5.7 Concurrent user queue: user always wins

- If the user submits a message while the coordinator is ARMED, the user
  message goes first; the coordinator re-evaluates at the next idle boundary.
  There is no coordinator-owned queue ahead of the user. The existing session
  query serialization (`session-query-executor.service.ts:134-145` queued
  initial prompt) already orders submissions; the coordinator is just another
  submitter with lowest priority.
- If the user types their own `/compact` while the coordinator is ARMED, the
  PreCompact hook's `trigger:'manual'` tells the coordinator to stand down
  permanently for that compaction cycle. `[F]` (trigger union at
  `compaction-hook-handler.ts:174-184`).

### 5.8 Native-auto deduplication

- Any PreCompact (`trigger:'auto'` OR `'manual'`) while in ARMED/TRIGGERED →
  cancel the coordinator's pending injection, transition to COOLDOWN. The
  registry fan-out (`CompactionCallbackRegistry`) delivers this to the
  coordinator like any other subscriber — no new hook plumbing.
- Suppression window: from any `compact_boundary` until COOLDOWN exits (§5.2),
  the coordinator never injects. This prevents the double-compaction race the
  watchdog's `compacting` flag already guards at the liveness layer
  (`no-activity-watchdog.ts:185-189`).

### 5.9 Cancellation and liveness policy

- There is no API to cancel in-flight compaction `[C]`. Policy: never start
  one you are not prepared to let finish.
- Liveness is the existing watchdog's job, unchanged: status `'compacting'`
  marks accounted activity; `onOverdue` logs and re-arms
  (`session-query-executor.service.ts:204-213`); the abort path is
  cleanup-first. The `[F]*` watchdog kill of an auto compaction predates the
  `compacting` accounting (PR #484, merged 2026-09-09); the current build
  should not repeat it — this is a live-validation item (§8), not a design
  change.
- User-initiated abort of the session aborts a coordinator-injected `/compact`
  like any query (same abort controller, same benign-abort wording rules).

### 5.10 Failure recovery

- `compact_result:'failed'` + `compact_error` `[C]` → BACKOFF, retry ≤ 2 with
  backoff, then OBSERVE_ONLY for the session (log + optional user notice).
- Session-not-found after PostCompact (`[F]*` measured once) → treat session
  as ended: clear coordinator state; `LiveUsageTracker.clearSessionTokenSnapshot`
  already handles the tracker side.
- Watchdog abort during coordinator compaction → BACKOFF. Never auto-retry
  immediately after a 180s kill (that is the `[F]*` failure signature).

### 5.11 Checkpoint and rollback — honest scope

- The SDK session file is the checkpoint. `SessionReplay` already skips
  pre-`compact_boundary` messages on replay (`session-replay.service.ts:90-94`)
  — the boundary is one-way for replay purposes.
- Host-side rollback to pre-compact history: **not available** (no
  history-edit API `[C]`; `forkSession` behavior unverified `[U]`). Gated.
- Practical mitigation already in the codebase: the memory curator's PreCompact
  reactor captures durable facts (decisions, files, task state) into Ptah-owned
  storage within ~62ms of compaction start `[F]*`. That is the real "rollback":
  knowledge survives even though the transcript view does not. The coordinator
  should ensure this reactor ran (subscribe and check) before injecting, and
  skip injection with a warning if the curator pass errors — configurable,
  default warn-and-continue.

### 5.12 Preservation: instructions, decisions, files, tool IDs

| Item | Mechanism | Owner |
|---|---|---|
| Compaction instructions | `/compact <instructions>` string — the only input channel `[C]` | Coordinator builds it |
| Durable decisions/files | Memory curator PreCompact reactor (existing) | memory-curator |
| Conversation structure | `preserved_segment`/`preserved_messages` relink `[C]` | SDK — report only |
| Tool IDs | SDK relink; host reads, never writes | SDK |
| Resume continuity | `seedResumedSession` baseline + `SessionStart source:'compact'` (report 03 §2) | existing code |

The coordinator's instruction template must include: active task id, open
decisions, files in play, and "do not restate secrets" (§5.13). Template is
data, not code — keep it in settings so it can change without a release.

### 5.13 Secrets and prompt-injection treatment

- The transcript is untrusted input. The compaction summary is LLM output over
  that transcript. Therefore: (a) never put secrets in the `/compact`
  instruction string (it joins the transcript); (b) treat `compact_summary`
  from PostCompact as untrusted when displaying or storing; (c) the curator
  pass must apply the existing secret-envelope rules before persisting
  anything extracted from tool output (settings-core patterns).
- Prompt injection from transcript → summary → next turns is inherent to
  runtime-owned summarization (Option A). The coordinator cannot filter the
  summary (gated). Mitigation is display-side and curator-side trust
  boundaries, both already repo conventions (markdown chokepoint on the
  frontend; curator validation on the backend).
- Never log raw summary or instruction bodies at info level; log lengths and
  metadata only (repo log hygiene; report 02's 124.8MB corpus is the cautionary
  measured example `[F]*`).

### 5.14 Provider switching and opaque artifacts

- Report 04 §7: session wire format is portable across providers, semantics
  are not; cache state is not portable. Policy: provider switch = coordinator
  state reset (IDLE, usage slots cleared via existing
  `clearSessionTokenSnapshot`) and a fresh capability probe through
  `IContextUsagePort`. Do not carry `autoCompactWindow` assumptions across
  providers — the backstop is set per query from the current provider's window.
- Opaque artifacts (Codex `ContextCompacted`, provider-specific summaries):
  the coordinator never parses them; it consumes only the normalized
  `ICompactionCallbackRegistry` events. Anything else is `[U]` and ignored.

## 6. Can we genuinely control trigger/replace history? The honest answer

- **Trigger: yes, within limits.** We choose WHEN to inject `/compact`
  (turn-boundary, gated on known usage) and we tune the native auto-compact
  window (bounded 100k–1M). We cannot force compaction mid-turn, on demand
  from a tool callback, or on the Codex TS path. We cannot cancel one.
- **Replace history: no.** No SDK API exists to substitute our summary, edit
  messages, or roll back a boundary. Every design element above respects this;
  anything in future specs that promises "Ptah-written compaction" must be
  gated until the SDK ships it.
- **Unsupported operations are gated, not promised**: the coordinator logs
  `compaction-gate-refused` with the operation name and continues in the
  highest safe mode (observe-only). A capability object
  (`{canTrigger, canTuneWindow, canObserve, canReadUsage}` per provider path)
  is computed once per session and drives every branch — no `if provider ===`
  strings scattered in logic.

## 7. Exact code change map

| # | File / symbol | Change | Existing vs proposed API |
|---|---|---|---|
| 1 | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (build path, near :762-795) | Translate `CompactionConfigProvider` values into `Settings.autoCompactWindow`/`autoCompactEnabled` inside `buildFlagSettings` output | Existing: config read+log only. Proposed: same config object forwarded as flag-tier `Settings` — the `Settings` fields already exist in the SDK `[C]`; clamped to the zod bound |
| 2 | `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` | Extend schema: `triggerRatio` (default 0.8, zod 0..1), `reserveTokens` (default 32000, zod ≥0), `cooldownMs` (default 300000), `reductionTargetRatio` (default 0.5). Keep `<1000` rejection | Existing: `{enabled, threshold}`. Proposed: superset, backward-compatible defaults |
| 3 | `libs/backend/memory-contracts/src/lib/context-usage.port.ts` (NEW) | `IContextUsagePort` + token, zero-dep, beside the callback port | Proposed; mirrors `ICompactionCallbackRegistry` conventions (non-blank sessionId invariant) |
| 4 | `libs/backend/agent-sdk/src/lib/helpers/context-usage.adapter.ts` (NEW) | Implements `IContextUsagePort`: `Query.getContextUsage()` + window registry; returns `null` when capability absent | Proposed; wraps existing `getContextUsage` `[C]` |
| 5 | `libs/backend/agent-sdk/src/lib/helpers/compaction-coordinator.service.ts` (NEW, ~350 lines) | The §5.2 state machine; subscribes via `CompactionCallbackRegistry`, submits via `IAgentAdapter.executeSlashCommand`, reads `IContextUsagePort` | Proposed; every collaborator is an existing seam (registry port, adapter method, usage tracker) |
| 6 | `libs/backend/agent-sdk/src/lib/register.ts` | Register coordinator + usage adapter in the existing DI phase | Existing file, one addition |
| 7 | `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts` | No change. The coordinator is just another registry subscriber | Existing fan-out suffices `[F]` |
| 8 | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:221-227` + `ptah-cli-registry.ts:702-753` | Remove the dead `compactionControl` field, or wire it to the same `Settings` translation (preferred: remove; window tuning happens at query build) | Existing: dead `as Options` cast `[F]`. Proposed: delete the field + cast |
| 9 | `libs/backend/memory-curator` PreCompact reactor | No change in stage 1; stage 3 adds a completion signal the coordinator can await | Existing fire-and-forget `[F]` |
| 10 | RPC surface (stage 3, optional) | `session:context` read method exposing `{usedTokens, windowTokens, coordinatorState}`; requires BOTH `libs/shared/.../rpc.types.ts` union entry AND `ALLOWED_METHOD_PREFIXES` (rpc-handler.ts:46) | Proposed; follows the dual-registration rule |

Platform boundaries: no `platform-*` adapter changes; no frontend changes
until stage 3's optional status surface (which goes through `libs/shared`).
All new files are backend-lib-only, keeping the hexagonal rule and the
frontend⇄backend wall intact.

## 8. Staged implementation plan (not executed — research deliverable)

- **Stage 0 — make the threshold real (smallest, standalone value).** Change
  #1 + #2 + tests. The config stops being decorative; the SDK's native
  auto-compact gets a correct window on every provider path.
- **Stage 1 — coordinator core.** Changes #3-#6 + state machine with manual
  injection, dedup, user-wins queue, watchdog coexistence. Unit tests over a
  fake registry/adapter/usage port; no live sessions needed.
- **Stage 2 — usage-driven trigger.** Three-level fallback, hysteresis,
  reduction measurement from `compact_metadata`, escalation notice.
- **Stage 3 — edges.** Provider-switch reset, curator completion signal,
  optional `session:context` RPC, ptah-cli cleanup (#8).
- Each stage is independently shippable and revertible; Stage 0 alone already
  changes behavior, so it ships behind the existing `ptah.compaction.enabled`
  flag.

## 9. Test and live validation plan

Unit/spec (repo conventions, Jest via `nx run-many -t test`):

1. Options builder: threshold → `Settings.autoCompactWindow` translation,
   zod-bound clamping, `enabled:false` → `autoCompactEnabled:false`.
2. Config provider: new keys' defaults + rejection bounds; existing
   `<1000` behavior unchanged.
3. Coordinator state machine: every transition in §5.2, including the gated
   refusals (unknown window → IDLE; zero-usage → no trigger; user-compact
   during ARMED → stand down; double boundary → single COOLDOWN).
4. Usage port: null on unknown capability; passthrough on Claude path.
5. Watchdog interplay: coordinator compaction counts as accounted activity
   (status `'compacting'` path, `no-activity-watchdog.ts:185-189`).
6. Hook handler specs unchanged (port is pinned by
   `compaction-hook-handler.spec.ts`).

Live validation (instrumented, one workspace, logs at debug for the
coordinator logger only):

1. Claude first-party path: confirm `getContextUsage` returns used tokens and
   (or not) `autoCompactThreshold`; record which.
2. Ollama Cloud path (https://ollama.com, glm-5): confirm whether native
   auto-compact fires at the tuned window — this directly tests issue #65585's
   claim against the bundled 0.3.150 (currently `[U]`, §11).
3. Coordinator-injected `/compact`: verify PreCompact(trigger manual) →
   PostCompact → `compact_boundary` sequence, `pre_tokens`/`post_tokens`
   populated, no watchdog kill, no session-not-found.
4. Long tool loop: verify the coordinator holds at turn boundary while native
   backstop handles mid-turn pressure; verify no double compaction.
5. Provider switch mid-session: verify state reset and fresh capability probe.

## 10. Limitations of this proposal

- All report-02 statistics are `[F]*` (unconfirmed worker, file present,
  provenance unverified by the bridge).
- Issue #65585's "auto-compact never fires behind third-party base URLs" is
  unresolved against 0.3.150 — the design's backstop may be weaker than
  modeled on Ollama/direct paths; live validation item 2 settles it.
- `forkSession` and any session-file manipulation are unverified `[U]` and
  remain gated.
- Codex path gets observation only; programmatic compaction there needs an
  upstream SDK surface that does not exist today `[F]`.
- The coordinator cannot fix the 157s compaction latency or the
  session-not-found-after-PostCompact race `[F]*` — those are runtime/SDK
  behaviors; the design only survives them (BACKOFF, OBSERVE_ONLY).

## 11. Unknowns register (carry forward)

| # | Unknown | Blocking? | Resolution path |
|---|---|---|---|
| 1 | Does native auto-compact fire on third-party base URLs in bundled 0.3.150? (report 04 issue #65585 vs report 02's one auto fire) | No — backstop is tuned anyway; auto-trigger has its own fallback | Live validation item 2 |
| 2 | `getContextUsage().autoCompactThreshold` presence per provider | No — optional field, treated as unknown when absent `[C]` | Live validation item 1 |
| 3 | `forkSession` semantics for pre-compact rollback | Yes for rollback — stays gated | SDK source inspection in a future task |
| 4 | Codex app-server compaction RPC shape | No — Codex is observe-only by design | Upstream codex repo tracking |
| 5 | Report 02 provenance (blocked worker, file present) | No — treated `[F]*` throughout | Bridge re-run if needed |
| 6 | Report 03 access-date discrepancy (2026-09-10 vs 09) | No — code claims re-validated directly this session | None needed |

— End of report 05. Research only; nothing implemented.
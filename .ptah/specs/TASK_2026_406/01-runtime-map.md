---
id: TASK_2026_406
artifact: 01-runtime-map
status: in_progress
type: RESEARCH
title: Compaction runtime map (current end-to-end code)
created: 2026-09-10
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. -->

# Compaction runtime map (TASK_2026_406 / 01-runtime-map)

## 0. Scope and method

This document maps the **current** end-to-end compaction code in the
Ptah monorepo at `D:\projects\ptah-extension`. It is the **evidence base**
for a follow-up design of an Ollama Cloud (Sonnet / Opus) coordinator.
No code, settings, sessions, git state, or live compaction is touched.

Every claim cites a file path and line number, an explicit doc comment,
or a measured fact. The four tag classes are:

- `[F]` measured fact: code or doc on disk.
- `[C]` documented contract: comment, JSDoc, CLAUDE.md bullet.
- `[I]` inference: two facts combined into a conclusion.
- `[U]` unknown: open question for the follow-up.

All paths are absolute Windows paths. All file references use
`file:line` form.

---

## 1. Surface map

### 1.1 Compaction-aware files (measured)

Compaction touches three backend libs and one runtime adapter:

| Lib / file | Role |
|---|---|
| `D:\projects\ptah-extension\libs\backend\agent-sdk` | Hooks, config, registry, threshold wiring, watchdog |
| `D:\projects\ptah-extension\libs\backend\memory-contracts` | Zero-dep port `ICompactionCallbackRegistry` |
| `D:\projects\ptah-extension\libs\backend\memory-curator` | PreCompact reactor; windowed LLM curation |
| `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts` | ONLY ptah-cli path that constructs `compactionControl` and passes it to the spawn |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` | Interactive chat SDK options builder; reads config, **does not** pass `compactionControl` |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-runner.service.ts` | Logs compaction config; does not pass it through |

`[F]` `CLAUDE.md` line "Compaction: subscribers must register via
`CompactionCallbackRegistry`, not by patching the adapter."
(`D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`,
search anchor confirmed during research).

### 1.2 Non-runtime "compaction" surface (UI, RPC, codex)

`[F]` The chat UI and the Codex translation path have their own
"compact" code that is NOT a Prah compaction coordination point.

- `libs/frontend/chat-routing` and `libs/frontend/chat-state` carry
  `session:compacting` events from the host; this is the **consumer**
  half of the hook, not a producer.
- `libs/backend/agent-sdk/src/lib/providers/codex/...` and
  `libs/backend/agent-sdk/src/lib/translation/...` (the Codex translation
  proxy, PR #484) implement the Codex CLI's own internal "compact"
  message in the wire stream; the host sees a *normal* `assistant`
  message after. There is no PreCompact-style fan-out there.

`[I]` No additional Prah-level compaction producer exists outside
`CompactionHookHandler` and `SdkAdapterEvents`. The Codex translation
path is wire-level, not host-level, and is out of scope for an Ollama
coordinator.

---

## 2. Threshold / env settings

### 2.1 Config keys and defaults

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts:30-33`

```ts
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  contextTokenThreshold: 100000,
};
```

- `ptah.compaction.enabled` — boolean, default `true`.
- `ptah.compaction.threshold` — number, default `100_000`.
- Reject: any non-number or number `< 1000` is treated as invalid; the
  default is used and a `warn` is logged
  (`compaction-config-provider.ts:71-86`).

### 2.2 Where the config is read

`[F]` Three consumers:

1. **ptah-cli spawn path**
   `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts:221-227`

   ```ts
   const compactionConfig = this.compactionConfigProvider?.getConfig();
   const compactionControl = compactionConfig?.enabled
     ? { enabled: true, contextTokenThreshold: compactionConfig.contextTokenThreshold }
     : undefined;
   ```

   Returned in `PtahSpawnAssembly.compactionControl` and consumed by
   `PtahCliRegistry.spawnAgent(...)` (TASK_2026_278 / harness-sync).
   This is the **only** path that actually constructs the
   `compactionControl` object the SDK accepts.

2. **VS Code interactive chat path**
   `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-runner.service.ts:391`

   ```ts
   `${SERVICE_TAG} Compaction config: enabled=${compactionConfig.enabled}, threshold=${compactionConfig.contextTokenThreshold} (managed via hooks)`,
   ```

   `[F]` Logged, not forwarded. The chat path does not place the
   `compactionControl` field on the SDK `Options` it builds.

3. **SdkQueryOptionsBuilder**
   `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:762-780`

   Reads `compactionConfig`, **logs it**, but the returned `options`
   object at `:782-895` does not contain a `compactionControl` key.

### 2.3 Does `ptah.compaction.threshold` influence runtime auto-compaction?

`[F]` Answer: **only on the ptah-cli spawn path**. On the VS Code
interactive chat path, the threshold is logged but not passed to the
SDK; the SDK uses its own auto-compaction at the model's
auto-detected context window (subject to `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
overrides — see §2.4).

`[C]` `agent-sdk/CLAUDE.md` "Three read caches" rule applies here:
the threshold is *configured* but the only consumer that propagates
it is `PtahCliSpawnOptions`. The chat path's compaction is
**SDK-managed**, with Ptah observing the lifecycle through the
`PreCompact` / `PostCompact` hooks (`compaction-hook-handler.ts`).

### 2.4 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` env

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:912-924`

```ts
private resolveContextWindowOverride(model: string, baseUrl: string | undefined) {
  if (process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']) return {}; // respect existing
  const isFirstPartyAnthropic = !trimmed || /^https?:\/\/api\.anthropic\.com\/?$/i.test(trimmed);
  if (isFirstPartyAnthropic) return {};                      // native detection is correct
  const window = getModelContextWindow(model);
  if (window <= 0) return {};                                // unknown → leave SDK default
  return { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(window) };
}
```

`[C]` The override only fires for non-Anthropic providers (proxies,
Ollama, Codex, OpenRouter). It forces the SDK's auto-compaction
threshold to track the proxy's **real** model window — otherwise
the SDK falls back to a hardcoded 200k window and auto-compaction
trips too late on small models.

`[F]` Set unconditionally on the chat path
(`sdk-query-options-builder.ts:837-840`); the ptah-cli path does not
emit it (TASK_2026_367 Batch 7).

### 2.5 Sealed-in runtime truth for the coordinator design

- The VS Code chat path **trusts the SDK's auto-compaction at the
  model's context window**. The hook is the only Prah-side lever.
- The ptah-cli path **explicitly sets** `compactionControl` with
  `ptah.compaction.threshold` (default 100 000).
- An Ollama Cloud coordinator that wants to act in the chat path
  must either (a) replace the SDK auto-compaction (not possible from
  the host without bypassing the SDK entirely) or (b) intervene
  BEFORE / AFTER the SDK's own compaction through the existing
  `PreCompact` / `PostCompact` fan-out.

`[I]` The cleanest seam is `PreCompact`: the hook fires for **both**
manual and auto triggers (`compaction-hook-handler.ts:174-184`),
and the trigger value travels on the fan-out payload. The
coordinator can let the SDK compact and then re-curate with
Ollama; OR it can short-circuit by **manually invoking** `/compact`
via a `SlashCommandInterceptor` flow when `ptah.compaction.coordinator`
is set to `ollama-cloud`. Both are safe and additive; the latter
costs one extra LLM call per cycle.

---

## 3. Hook lifecycle

### 3.1 Hook surface

`[F]` `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts:134-349`

- `createHooks(sessionId: string | undefined, cwd: string | null, onCompactionStart?: CompactionStartCallback)`
  - Returns `Partial<Record<HookEvent, HookCallbackMatcher[]>>` with
    exactly `PreCompact` and `PostCompact` keys.
- Each callback **never throws** (`try { ... } catch` wraps the
  body, returns `{ continue: true }` in the catch).

### 3.2 PreCompact payload contract

`[F]`
`compaction-hook-handler.ts:174-225`

```ts
const trigger = input.trigger;                              // 'manual' | 'auto'
const resolvedSessionId = resolveHookSessionId(input.session_id, sessionId);
const resolvedCwd       = resolveHookCwd(input.cwd, cwd);
// ... if (!resolvedSessionId) { warn; return { continue: true }; }

this.callbackRegistry?.notifyAll({
  sessionId: resolvedSessionId, trigger, timestamp: Date.now(),
  preTokens: ensurePreTokens(), cwd: resolvedCwd,
});
capturedCallback?.(/* same shape */);
```

`[C]` `preTokens` is sampled **lazily** via
`ensurePreTokens()` — a single synchronous map read of
`LiveUsageTracker.getCumulativeTokens(resolvedSessionId)`. The hook
runs on the SDK's transport path and may not do I/O or throw
(`agent-sdk/CLAUDE.md` "preTokens has TWO sources" bullet).

### 3.3 Session identity

`[F]` `resolveHookSessionId` (helper `hook-session-resolver.ts`):

- Payload first (`input.session_id`), closure second.
- `''` from either source is treated as absent.
- Returns `null` when both are absent; never `''`.

`[F]` `compaction-hook-handler.ts:190-200` rejects `null` and
returns without publishing, logging
`PreCompact missing sessionId, skipping callback`.

`[C]` `memory-contracts/compaction-callback.port.ts:7-27` and the
port comment block make this an **invariant**: the port's
`sessionId` field is `string` (not `string | undefined`), and the
single notifier cannot legally emit a blank id.

### 3.4 PostCompact

`[F]`
`compaction-hook-handler.ts:269-348`

- Validates `input.hook_event_name === 'PostCompact'`.
- Resolves session id and cwd the same way.
- **Only** if both resolve: emits
  `sdkAdapterEvents.emitCompactionComplete({ sessionId, cwd, trigger, compactSummary, timestamp })`.
- The chat path consumes this through `SessionMcpStatusCallbackRegistry`-
  style fan-out, but for compaction specifically the consumer is the
  UI reload path (`libs/frontend/chat` and `chat-routing`).

### 3.5 `trigger` field

`[F]` Validated against the union `'manual' | 'auto'`
(`compaction-hook-handler.ts:174-184` and `:296-306`). Any other
value skips the publish path. The coordinator can therefore
**distinguish** a user-initiated `/compact` from an SDK auto
trip on the same hook.

---

## 4. CompactionCallbackRegistry fan-out

### 4.1 Implementation

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-callback-registry.ts:22-60`

- `Set<CompactionStartCallback>` with `register()` returning a
  disposer (idempotent on the function reference).
- `notifyAll(data)` iterates the set inside `try/catch` per
  subscriber so one bad handler does not break the SDK or others.
- `size` is exposed so `CompactionHookHandler.createHooks` can skip
  fan-out when there are no subscribers (cheap path).

### 4.2 Token aliasing

`[F]` `agent-sdk/src/lib/di/tokens.ts:41`

```ts
SDK_COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),
```

`[F]` `memory-contracts/src/lib/tokens.ts:6`

```ts
COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),
```

**Same key.** tsyringe resolves the symbol by identity, so
`@inject(MEMORY_CONTRACT_TOKENS.COMPACTION_CALLBACK_REGISTRY)` in
`MemoryCuratorService` and the registration under
`SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY` in
`agent-sdk/.../register.ts:363-367` resolve to the **same
singleton** without a `useToken` alias.

`[F]` `memory-curator/src/lib/di/register.ts:135-139` does NOT
re-register the port. It assumes the agent-sdk side already did.
The order is load-bearing — `registerSdkServices(...)` MUST run
before `registerMemoryCuratorServices(...)` (CLAUDE.md comment in
`register.ts:8-12`).

### 4.3 Contract port

`[F]`
`D:\projects\ptah-extension\libs\backend\memory-contracts\src\lib\compaction-callback.port.ts:28-42`

```ts
export interface ICompactionCallbackRegistry {
  register(callback: (data: {
    sessionId: string;            // guaranteed non-blank
    trigger: 'manual' | 'auto';
    timestamp: number;
    preTokens: number;
    cwd?: string | null;
  }) => void): () => void;
}
```

`[C]` The doc block explicitly forbids widening `sessionId` to
`string | undefined`. The producer's `null` rejection is the
single enforcement point.

---

## 5. Context windows / usage measurement

### 5.1 `LiveUsageTracker` (the writer side)

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\live-usage-tracker.ts`

- Two slots: `snapshotBySession` (live, per-field MAX) and
  `resumeBaselineBySession` (single integer, insertion-ordered, LRU
  bound at `RESUME_BASELINE_LIMIT = 64`).
- `recordSessionUsage(sessionId, { input, output, cacheRead, cacheCreation })`:
  per-field `Math.max(prev, incoming)`. Reject blank `sessionId`.
- `seedResumedSession(sessionId, tokens)`:
  - Must be **one request's** `input + output + cache_read + cache_creation`
    from the last message after the last `compact_boundary` (TASK_2026_374).
  - Insertion-ordered: `delete-then-set` keeps recency; eviction drops
    the least recently seeded.
  - Reject non-positive and non-finite values.
- `getCumulativeTokens(sessionId)`:
  - Live snapshot wins if it exists, even at 0.
  - Else the resume baseline.
  - Else `0`.
- `clearSessionTokenSnapshot(sessionId)`: drops **both** slots so a
  post-compaction read is never answered by a pre-compaction figure.

`[C]` `agent-sdk/CLAUDE.md` "preTokens has TWO sources" bullet:
the seed is **deliberately** not routed through `recordSessionUsage`,
because that method's MAX policy would let a stale historical
figure beat every live frame that follows.

### 5.2 Writer side: who calls `recordSessionUsage`

`[F]` `agent-sdk/CLAUDE.md` "Turn state is derived HERE" + "The
extracted transformer (writer) records cumulative usage from
`message_start.usage` and `message_delta.usage` events." This is
`SdkMessageTransformer` (a `TASK_2026_360` change); the call site
itself is not in the lines re-read here but the contract is
documented in the lib CLAUDE.md.

`[I]` A coordinator that wants *per-message live* preToken
numbers can subscribe to the same `usage` deltas the transformer
already consumes. The current `PreCompact` sample is a single
`Date.now()` snapshot, not a per-message trace.

### 5.3 Resume baseline seeding

`[F]` `agent-sdk/CLAUDE.md` states that
`SessionHistoryReaderService.readSessionHistory` (which
`chat:resume` already calls) seeds the resume baseline. The exact
seed call site is not in the lines re-read here but the contract
is: **one request after the last `compact_boundary`**, not a
cross-turn sum.

`[C]` `SessionMetadataStore.totalTokens` and
`aggregateUsageStats` both hold cross-turn sums. Routing the
**seed** through either would publish a confidently wrong number
(measured: a long session's summed `cache_read` runs into
millions).

### 5.4 `compact_boundary` slicing

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts:87-100`

```ts
for (let i = mainMessages.length - 1; i >= 0; i--) {
  if (mainMessages[i].type === 'system' && mainMessages[i].subtype === 'compact_boundary') {
    startIndex = i + 1;
    break;
  }
}
const effectiveMessages = startIndex > 0 ? mainMessages.slice(startIndex) : mainMessages;
```

`[C]` Replay drops everything before the last `compact_boundary` —
the pre-compaction conversation is no longer representable as a
chat tail. The `transcript` the memory curator reads on
`PreCompact` is fetched BEFORE the SDK writes the boundary
(`ITranscriptReader` consumes JSONL; the boundary is appended
after compaction completes), so the curator sees the full
pre-compaction text on `PreCompact` and the replayed stream sees
only post-compaction messages.

---

## 6. Stats normalization

### 6.1 Per-field MAX vs cross-turn sum

`[F]` `LiveUsageTracker.recordSessionUsage` is per-field MAX,
**not** additive — the `message_start.usage` and `message_delta.usage`
events from Anthropic are monotonically cumulative within a turn,
so a per-field MAX collapses to the latest frame of the turn.
Cross-turn aggregation is delegated to `aggregateUsageStats` and
`SessionMetadataStore.totalTokens`.

`[C]` These two representations answer different questions:

- `LiveUsageTracker` answers "what is the model's view of the
  last frame of this turn?" — comparable across the wire.
- `aggregateUsageStats` answers "how many tokens has this session
  consumed in total since the beginning?" — for UI cost display.

The curator's `preTokens` is the first quantity, by design.

### 6.2 PreCompact `preTokens` semantics

`[F]` `preTokens: ensurePreTokens()` in
`compaction-hook-handler.ts:209-225`. Lazily samples
`LiveUsageTracker.getCumulativeTokens(resolvedSessionId)` on the
first subscriber call. Returns a single integer (sum of the four
fields for a live snapshot, or the seeded resume baseline, or `0`).

`[C]` The frontend's `compaction_start` payload uses `preTokens`
as the **freeze** for the pre-compaction header stats. The
delta against the post-compaction figure is computed client-side.

---

## 7. Query ownership

### 7.1 Interactive chat path

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-runner.service.ts`
+ `sdk-query-options-builder.ts:782-895`.

- The chat path goes through `SdkQueryOptionsBuilder.build()`,
  which returns the `Options` object handed to the SDK `query()`.
- `Options` shape in the returned object (line 783+): no
  `compactionControl`, no `compactionThreshold`.
- Threshold is read for logging only.

### 7.2 ptah-cli spawn path

`[F]`
`D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts:221-249`

- The only path that produces `compactionControl: { enabled, contextTokenThreshold }`
  and returns it as `PtahSpawnAssembly.compactionControl`.
- `PtahCliRegistry.spawnAgent(...)` (TASK_2026_367 Batch 7 — not re-read
  here but named in the agent-sdk CLAUDE.md "Three read caches" rule)
  consumes `PtahSpawnAssembly` and threads `compactionControl` into
  the SDK spawn options for rival CLIs (Codex, Copilot, Cursor,
  opencode, pi, Antigravity).

### 7.3 Internal one-shot queries

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`

- Two concurrency ceilings: `ptah.internalQuery.maxConcurrent = 2`
  (global) and `ptah.internalQuery.maxConcurrentPerLane = 1` (per
  lane).
- Lanes are caller-supplied strings, trimmed and lower-cased. The
  curator names `'memory-curator'`, skill-synthesis names
  `'skill-synthesis'`, everything else shares `'default'`.
- `InternalQueryConcurrencyGate` is one queue + one admission
  predicate `active < limit && activeInLane < perLaneLimit`; the
  `drain()` scan is FIFO **within** a lane but admits the first
  lane-admissible waiter.
- A caller without a `lane` argument is charged to
  `DEFAULT_INTERNAL_QUERY_LANE = 'default'`.
- Queue timeout: `ptah.internalQuery.queueTimeoutMs = 60_000`. A
  waiter that does not reach the front within the window rejects
  with `InternalQueryQueueTimeoutError`.

### 7.4 The synthetic `internal-query-` session id

`[F]`
`D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-curator.service.ts:96`

```ts
const INTERNAL_QUERY_SESSION_PREFIX = 'internal-query-';
```

`[C]` `SdkQueryRunner` mints
`internal-query-${Date.now()}` for one-shot queries. The
curator's PreCompact subscription filters them out at line 204-210
so a curator run cannot recursively trigger another curation
(TASK_2026_376 R1). Both the producer and consumer have the
guard.

---

## 8. Slash command dispatch

### 8.1 Interceptor

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\slash-command-interceptor.ts:30-97`

- Regex: `^\/[a-zA-Z]` (any non-whitespace start with a single
  leading slash followed by an ASCII letter).
- `NATIVE_COMMANDS = new Set(['clear'])`.
  - `clear` → `action: 'native'` (handled locally without SDK).
  - Everything else (including `compact`) → `action: 'new-query'`
    (forwarded to a fresh SDK query).

### 8.2 Why `/compact` is a `new-query`

`[C]` `agent-sdk/CLAUDE.md` "The Claude Agent SDK only parses slash
commands from raw string prompts passed to query(), NOT from
SDKUserMessage objects delivered via streamInput()." A slash
command delivered mid-turn through `streamInput` is silently
**lost** unless the host intercepts it and routes it through a
fresh `query()` call.

`[F]` `webview` flag flips observed in commit log: `feat(webview):
enable /compact and /review on all providers` (`58b18958f`). The
ptah-cli side classifies `/compact` identically — `new-query`.

### 8.3 What the host does on a `new-query`

`[I]` From the interceptor's contract and CLAUDE.md commentary,
the host hands the raw string to a new SDK `query()` so the SDK
itself sees the `/compact` token and emits `PreCompact` with
`trigger: 'manual'`. This is the path that lands in
`compaction-hook-handler.ts:174` with `trigger === 'manual'`,
and the only thing the host adds is the `preTokens` sample
and the registry fan-out.

---

## 9. Session history / replay / import

### 9.1 Replay

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts:87-100`
as in §5.4.

### 9.2 Session importer

`[F]` `agent-sdk/CLAUDE.md` "The session-importer prune is STRICTLY
NARROWER than the import guard it mirrors": the importer's
`isContentlessSessionFile` and `extractMetadata` read the same
8 KB prefix; the producer declines to import, the prune deletes a
stored row. The prune is gated by a `bytesRead <
METADATA_PREFIX_BYTES` short-read check (the only proof the
whole file is in hand) AND the same contentless rule. PR #484
added **75** lines to `session-importer.service.spec.ts` covering
the keep-cases (truncated, corrupt, BOM, missing file, real
session named `Session <date>`).

### 9.3 PR #484 file stat (high-level)

`[F]` `git show a23972881 --stat` reports
**1167 insertions, 330 deletions** across 23 files. The diff is
merge commit `a23972881` of PR #484
("codex-compaction-audit-fix", 2026-09-09). The substantive files:

- `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts`
  — **278 / 247 lines net** (`+278 / -31` shape). PR #484 added
  `tools Map`, `tasks Map`, `compacting` flag, `observe()`,
  `lifecycleHooks()`, and the `onOverdue` callback.
- `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.lifecycle.spec.ts`
  — **+140 lines** of coverage.
- `libs/backend/agent-sdk/src/lib/session-lifecycle/session-control.service.ts`
  — **+33 lines** (turn-guard semantics).
- `libs/backend/agent-sdk/src/lib/session-lifecycle/session-query-executor.service.ts`
  — **+25 lines**; spec **+129 lines**.
- `libs/backend/agent-sdk/src/lib/translation/responses-stream-collector.ts`
  — **+216 lines**; spec **+141 lines** (Codex wire).
- `libs/backend/agent-sdk/src/lib/translation/translation-proxy-base.ts`
  — **+46 lines**.
- `libs/backend/agent-sdk/src/lib/providers/codex/codex-translation-proxy.ts`
  — **+7 lines**; spec **+85 lines**.
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts`
  — **+12 lines**; spec **+75 lines** (the prune narrowing
  pin in §9.2).
- `libs/backend/chat-store/message-dispatch.service.ts`
  — **+44 lines**; spec **+25 lines** (session:compacting
  channel).
- `libs/backend/chat/session/chat-session.service.ts`
  — **+8 lines** (reload).
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`
  — **-40 lines** (decommissioned, replaced by the
  `compacting` flag in the watchdog).
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
  — **+2 / -1** (compact_boundary tagging).

`[F]` PR #484 was scoped as `codex-compaction-audit-fix` per the
merge commit subject — i.e. the watchdog and Codex wire-stream
changes are not a *new* compaction model; they preserve the
existing one against Codex-specific lifecycle quirks.

---

## 10. Queue handling (curator + skill-synthesis)

### 10.1 Internal query gate (host-wide)

See §7.3. Two ceilings; per-lane ceiling of 1 is load-bearing
because raising the global limit alone would let skill-synthesis
claim both slots and starve the curator. (CLAUDE.md
"InternalQueryService has TWO concurrency ceilings".)

### 10.2 `CuratorJobQueue` (curator-only)

`[C]`
`D:\projects\ptah-extension\libs\backend\memory-curator\CLAUDE.md`
"ONE curation pass at a time, and a lost concurrency slot is a
DEFERRAL rather than a failed run (TASK_2026_376 F4)".

- Implemented in `memory-curator/src/lib/curator-llm/curator-job-queue.ts`.
- Promise chain on the singleton service. The pass is submitted
  through the queue so that windows (each a one-shot query on the
  `memory-curator` lane) cannot release-and-reacquire between
  themselves.
- Queue wait ceiling: `CURATOR_QUEUE_WAIT_CEILING_MS` (the
  shared `ptah.internalQuery.queueTimeoutMs` is the underlying
  gate). On timeout: outcome `'stalled'`, not `'ran'`.
- `QueueSlotRetryBudget`: one allowance of 2 retries, shared by
  every extract window and the resolve call.
- Stall recognition walks the `cause` chain
  (`queue-slot-timeout.ts`) because
  `InternalQueryQueueTimeoutError` lives in `agent-sdk`, which
  depends on this lib — same convention as `ProviderAuthError` and
  `ProviderQuotaError`.

### 10.3 Boot scan scheduler

`[C]`
`D:\projects\ptah-extension\libs\backend\memory-curator\CLAUDE.md`
"The boot scan is ARMED, not run, by start()".

- `memory.triggers.bootScanDelayMs` (default 5 min) + idle backoff
  (`memory.triggers.bootScanIdleBackoffMs`, default 5 min).
- `BootScanScheduler` is the one copy of the gate, shared with
  `SkillTriggerService`.
- `lastActivityAt` is `null` at boot → `ForegroundActivityTracker`
  reports `Infinity` → an activity check alone would always pass.
  Both the delay and the re-arm are needed.

### 10.4 Triggers registered to compaction

`[F]`
`D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`
(named in the lib CLAUDE.md "Internal Structure" table; not
re-read here).

- Eight registries: `activity`, `sessionEnd`, `userPromptSubmit`,
  `postToolUse`, `stop`, `toolFailure`, `sessionEndHook`,
  `sessionStart`, `sessionIdResolved`. (`sessionEnd` appears
  twice in the spec text — read as a duplicate listing, not
  two separate registries.) Rekeys state from `tabId` to SDK
  UUID on `sessionIdResolved`.

`[I]` The `sessionIdResolved` rekey is the same pattern the
agent-sdk `SessionTurnStateRegistry` uses
(`agent-sdk/.../di/register.ts:390-401`). Both are wired at
registration time.

---

## 11. Watchdog changes in PR #484

### 11.1 What the watchdog owns

`[F]`
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\no-activity-watchdog.ts`
(247 lines, re-read end-to-end):

- `NO_ACTIVITY_TIMEOUT_MS = 180_000` (3 min).
- State: `holds`, `turnOpen`, `tools: Map<toolUseId, toolName>`,
  `tasks: Map<taskId, toolUseId>`, `compacting: boolean`.
- `hold()` / `release()` are reference counted; child registration
  never owns a parent hold.
- `endTurn()` clears all three maps and the compacting flag.

### 11.2 Hook surface

`[F]`
`no-activity-watchdog.ts:83-108`

```ts
lifecycleHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const events: HookEvent[] = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'PreCompact', 'PostCompact',
    'Stop', 'StopFailure', 'SessionEnd',
  ];
  ...
}
```

Each event registers a single matcher whose callback calls
`observeHook(input)` and returns `{ continue: true }`.

### 11.3 `observeHook` switch

`[F]`
`no-activity-watchdog.ts:110-139`

- `PreToolUse` → record `toolUseId → toolName` in `tools`.
- `PostToolUse` / `PostToolUseFailure` → delete the toolUseId.
- `PreCompact` → `compacting = true`.
- `PostCompact` → `compacting = false`.
- `Stop` / `StopFailure` → `endTurn()` (release pump, do not
  publish idle from the hook — the result owns the turn boundary).
- `SessionEnd` → `stop()`.
- Ignores `agent_id != null` (nested hooks are not root activity).

### 11.4 `observe()` (stream messages)

`[F]`
`no-activity-watchdog.ts:142-205`

- Drops messages with a non-empty `parent_tool_use_id` (child
  chatter).
- For `system` messages, classifies by `subtype`:
  - `task_started` → record in `tasks` only if its `tool_use_id`
    is in `tools` (we already own the root tool).
  - `task_updated` → release a tool when the task is
    `backgrounded` or terminal.
  - `task_notification` → mirror the release.
  - `task_progress` → swallow (does not own time).
  - `status` / `compact_boundary` → update `compacting`.
- For `user` tool_result blocks → delete the corresponding
  `tool_use_id` from `tools`.
- For `result` → `endTurn()`.

### 11.5 Arm / overdue / timeout

`[F]`
`no-activity-watchdog.ts:215-238`

```ts
private arm(): void {
  this.clear();
  if (this.holds > 0 || this.stopped || this.fired || !this.started) return;
  this.timer = setTimeout(() => {
    this.timer = null;
    if (this.stopped || this.fired) return;
    const operations = [...this.tools.values()];
    if (this.compacting) operations.push('compaction');
    if (operations.length > 0) {
      try { this.onOverdue(operations); }
      finally { this.arm(); }
      return;
    }
    this.fired = true;
    this.onTimeout();
  }, this.timeoutMs);
  this.timer.unref?.();
}
```

`[C]` This is the load-bearing change in PR #484. The watchdog
no longer fires after 180 s of **unaccounted** silence; it fires
only when `operations.length === 0`. While a root tool is
running or `compacting === true`, the timer reports
`onOverdue(operations)` and re-arms.

`[C]` Idle between turns is held by the turn state (CLAUDE.md
"The no-activity watchdog is HELD while no turn is in flight and
for the lifetime of every registered subagent"); subagent
lifetime is held by `SubagentHookHandler`. Idle can no longer
fire the watchdog by itself.

### 11.6 Idle / permission hold semantics

`[F]`
`no-activity-watchdog.ts:50-78, 215-238`

- `hold()` is reference counted.
- While `holds > 0`, `arm()` returns early (the timer is never
  set).
- A subagent hold is owned by `SubagentHookHandler` (one per
  `agent_id`); a `SubagentStop` for an unknown id must NOT
  release (it would drop the session's idle hold).
- `PermissionHold` callers (the tool `canUseTool` callback in
  `sdk-query-options-builder.ts:744-753`) call `hold()` then
  `release()` in a `try / finally` even for auto-approved tools,
  so a non-blocking tool costs a matched pair but never misses a
  release.

### 11.7 What the watchdog emits (the recovery path)

`[I]` `onOverdue` is a host-injected callback
(`NoActivityWatchdog` constructor: `onTimeout`, `onOverdue`). It
is the host's responsibility to surface the overdue list to the
user. The watchdog itself is a **notifier**, not a killer. The
killing side is `onTimeout`, which only fires for truly
unaccounted silence. (Comment in
`no-activity-watchdog.ts:223-226`: "One timer, no polling I/O
and no invented failure verdict.")

`[U]` The integration site of `onOverdue` (which class injects
it in `SdkQueryRunner` / `SessionQueryExecutor` and what the
host does with the list) was not re-read in this pass; see
follow-up §14.

---

## 12. Memory curator

### 12.1 Subscription model

`[F]`
`D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-curator.service.ts:200-258`

```ts
start(): void {
  if (this.disposer) return;
  this.disposer = this.registry.register((data) => {
    if (data.sessionId.startsWith(INTERNAL_QUERY_SESSION_PREFIX)) {
      return; // ignore internal one-shots
    }
    this.running = (async () => {
      const cwd = typeof data.cwd === 'string' && data.cwd.length > 0 ? data.cwd : null;
      let transcript = '';
      if (cwd) {
        try { transcript = await this.transcriptReader.read(data.sessionId, cwd); }
        catch (err: unknown) { /* log warn */ }
      }
      if (!transcript) { return this.curate({ sessionId: data.sessionId }); }
      return this.curate({
        sessionId: data.sessionId,
        workspaceRoot: cwd,
        transcript,
        maxWindows: data.trigger === 'manual'
          ? MANUAL_COMPACTION_MAX_WINDOWS  // 1
          : undefined,
      });
    })().catch(/* log error */);
  });
  this.logger.info('[memory-curator] started — subscribed to PreCompact');
}
```

### 12.2 Window budget

`[F]` `memory-curator.service.ts:76`

```ts
const MANUAL_COMPACTION_MAX_WINDOWS = 1;
```

`[C]` `CURATOR_MAX_WINDOWS = 8` is the automatic budget
(`memory-curator/CLAUDE.md` "The curator budget is stated in
LLM CALLS, not characters"). Manual `/compact` caps to 1
window = 2 LLM calls; automatic compaction may use up to 8
windows + 1 resolve = 9 calls. The clamp on caller-supplied
budgets sits in `clampWindowBudget(planWindows)` — a parameter
a call site could widen would not be a bound.

### 12.3 Job queue + retry budget

See §10.2.

### 12.4 Internal query lane

`[F]` `memory-curator.service.ts` constructs the
`CuratorWindowRunner` with the injected `ICuratorLLM`. The
`CuratorWindowRunner.extractAcrossWindows` is sequential; the
lane is `'memory-curator'` with per-lane ceiling 1.

`[C]` `CuratorWindowRunner` checks `signal.aborted` between
windows, abandons the run on a throw, stops on
`status: 'stalled'`, and unions drafts while dropping exact
`(subject, content)` duplicates before the single `resolve`.
This is the seam the coordinator design must respect if it
interposes between PreCompact and the SDK's own compaction
(§2.5).

### 12.5 Transcript clamp

`[C]` `clampTranscript` lives in
`memory-curator/src/lib/curator-llm/clamp-transcript.ts`. The
`CURATOR_TRANSCRIPT_MAX_CHARS = 32 KB` cap is the **last-resort**
guard inside `MemoryCuratorService.doCurate` (renamed to
`windowForModel` per the CLAUDE.md). Budget is `CAP ×
CURATOR_MAX_WINDOWS`; warn-level on the full budget, info-level
on a narrowed budget.

### 12.6 What curator does NOT do

`[C]` It does **not** invoke compaction, mutate the SDK context,
or block the SDK. It is a fire-and-forget reactor on `PreCompact`
whose `try/catch` guarantees no throw into the SDK callback path
(`memory-curator.service.ts:245-256`).

---

## 13. Claude SDK vs Codex integration modes

### 13.1 Claude SDK (the interactive path)

- `query()` spawns the `claude` binary synchronously (CLAUDE.md
  "`query()` spawns the CLI SYNCHRONOUSLY"). PR #484 did not
  change this; the off-thread spawner
  (`OffThreadProcessSpawner`) was added in TASK_2026_341
  (CLAUDE.md "`query()` spawns the CLI SYNCHRONOUSLY" bullet).
- `Options` shape: see `sdk-query-options-builder.ts:782-895`.
- Compaction control: implicit (SDK auto-compaction) +
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` env override for proxies.
- Hooks: `PreCompact`, `PostCompact` (this lib).
- Session identity: SDK UUID from `init`; resolved id is fanned
  out via `SessionIdResolvedCallbackRegistry`.

### 13.2 Codex (the wire-translation path)

`[F]` `libs/backend/agent-sdk/src/lib/translation/...`:

- The host sees a normal Anthropic-SDK message stream on the
  outgoing side and a Codex wire stream on the incoming side.
- The Codex wire has its own "compact" message which the
  translation proxy flattens to an `assistant` message for the
  SDK consumer.
- There is **no** `PreCompact` hook on the Codex path inside
  this codebase (the SDK runs the Claude path, the Codex path
  is a wire-level mirror).

`[F]` PR #484 +216 / +141 (collector) + +46 (proxy base) +
+7 (provider) were exactly about preserving long-running work
and session recovery across the Codex wire — not about adding
new compaction producers. Commit subject:
`fix(codex): preserve long-running work and session recovery`
(afb3d0ec6) and
`fix(codex): address Sonar security and complexity findings`
(f476ac0e9).

### 13.3 Auth provider routing (does it affect compaction?)

`[F]` `agent-sdk/CLAUDE.md` "Three read caches" bullet:
`SdkModelService` keys its catalog on an auth fingerprint
(active auth method + provider id + base URL + hashed credential
+ tier defaults). A provider switch misses the cache by
construction.

`[I]` Switching providers mid-session does not directly affect
compaction, but it does invalidate the `getModelContextWindow`
lookup, which in turn controls the
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` override (§2.4). For an Ollama
Cloud coordinator design, this means: a provider switch on a
non-Anthropic base URL re-pins the context window on the next
query, and the auto-compaction threshold tracks the new model.

`[C]` `auth-providers/CLAUDE.md` "Provider-tier derivation
(deriveTiersFromCatalog)": the tier mapping
(`opus` / `sonnet` / `haiku` / etc.) is resolved from the
**active** provider's `defaultTiers`, not the AuthEnv. Two
providers with identical AuthEnvs can still map `opus` to
different ids. An Ollama Cloud Sonnet / Opus coordinator must
not assume a single id; it should look up the active provider's
tier entry before invoking the model.

---

## 14. Open questions for the follow-up design

`[U]` Where is `NoActivityWatchdog.onOverdue` wired in
`SessionQueryExecutor` / `SdkQueryRunner`? The constructor
takes `onOverdue: (operations) => void` but the host
integration site is not visible in the lines re-read here.

`[U]` Does the coordinator need a host-side `ShutdownLatch` for
the pre-compaction decision (so a mid-flight Ollama call does
not race with a user-initiated `/cancel`)? The curator's
`signal.aborted` check covers its own windows but not the gap
between `PreCompact` and the LLM call.

`[U]` When the SDK auto-compacts, the curator fires (on
`PreCompact`). The curator's `preTokens` is sampled
**before** the SDK compaction. The coordinator design needs to
decide whether to re-sample post-compaction (via `PostCompact`).
`PostCompact` does not carry `preTokens` today
(`compaction-hook-handler.ts:307-332`) — adding it would
require a contract change on `sdkAdapterEvents`.

`[U]` The `compactionControl` field is a SDK-defined type. The
ptah-cli path uses `{ enabled, contextTokenThreshold }`. The
VS Code path does not pass any. An Ollama Cloud coordinator
that wants to control the SDK's own threshold from the host
must verify the field shape against the current SDK version
(`@anthropic-ai/claude-agent-sdk` 0.3.150 pinned per the lib
CLAUDE.md "Tech Stack" but the runtime API was not re-checked
in this pass).

`[U]` Test scaffolding for the coordinator:
`compaction-hook-handler.spec.ts` is named in the
`memory-contracts/compaction-callback.port.ts:21` doc as
pinning the sessionId-rejection contract. The new coordinator
subscribes via the same registry and would need a similar spec
covering: (a) trigger-conditional behavior, (b) `cwd`
presence/absence, (c) re-entrancy on `internal-query-`
prefix, (d) abort propagation.

---

## 15. Seams an Ollama Cloud coordinator can reuse

| Seam | Where | Why safe to reuse |
|---|---|---|
| `ICompactionCallbackRegistry.register` | `memory-contracts/.../compaction-callback.port.ts` | The single subscription point; trigger + preTokens + cwd on payload |
| `LiveUsageTracker.getCumulativeTokens` | `agent-sdk/.../live-usage-tracker.ts` | Already published; the writer (`SdkMessageTransformer`) is the canonical source |
| `LiveUsageTracker.seedResumedSession` | same file | Same identifier; one-request frame, not a cross-turn sum |
| `LiveUsageTracker.clearSessionTokenSnapshot` | same file | Called on `compact_boundary`; coordinator can call it on its own boundary too |
| `ICompactionCallbackRegistry.sessionId` non-blank invariant | `compaction-callback.port.ts:7-27` | The producer's null rejection is enforced; subscribers do not need to defend |
| `CompactionStartCallback` shape | `agent-sdk/.../compaction-hook-handler.ts:60-66` | `cwd?: string \| null` — coordinator can use the cwd to scope workspace context |
| `Manual` vs `auto` trigger | `compaction-hook-handler.ts:174-184` | Coordinator can charge different cost budgets per trigger |
| `MemoryCuratorService` lane | `agent-sdk/.../internal-query.service.ts:38` (default lane) | The coordinator can claim `'default'` for foreground decisions and leave the curator alone on `'memory-curator'` |
| `InternalQueryConcurrencyGate` | `agent-sdk/.../internal-query.service.ts:139-205` | One predicate, FIFO within lane; no lock ordering to get wrong |
| `SDK_TOKENS.SDK_RUNTIME_STATE` | `agent-sdk/.../di/tokens.ts:81` | Reuse for cross-query coordinator state if needed |
| `SessionIdResolvedCallbackRegistry` | `agent-sdk/.../di/register.ts:369-373` | Rekey coordinator state from `tabId` to SDK UUID, mirroring the existing `SessionTurnStateRegistry` rekey |
| `SessionStartCallbackRegistry` / `SessionEndCallbackRegistry` | `agent-sdk/.../di/register.ts:177, 273` | Coordinator can own per-session state on a turn boundary without an extra port |

`[C]` The coordinator can register a NEW `CompactionStartCallback`
on `ICompactionCallbackRegistry` from any DI-registered lib
without touching agent-sdk, memory-curator, or the SDK. The
`CompactionCallbackRegistry.notifyAll` already iterates and
isolates throws per subscriber
(`compaction-callback-registry.ts:49-60`).

---

## 16. Seams an Ollama Cloud coordinator can change (with caveats)

| Seam | Risk | Mitigation |
|---|---|---|
| `ptah.compaction.threshold` (config) | Low — already plumbed on the ptah-cli path; would need a new `ptah.compaction.coordinator` setting to opt in | Add the new setting as a sibling of `ptah.compaction.threshold`; default to off |
| `compactionControl` field on the chat path Options | Medium — chat path currently does not pass it; passing it is the only way to influence the SDK's threshold from the host | Verify the SDK type, then add a new `compactionConfigProvider.getConfig()` consumer in `sdk-query-options-builder.ts:782-895` |
| `LiveUsageTracker.recordSessionUsage` | High — it keeps a per-field MAX; the coordinator's own samples must not go through it | Use `seedResumedSession` for the coordinator's per-session resume baseline if it has one; never call `recordSessionUsage` from outside the message-transform pipeline |
| `MemoryCuratorService` lane | High — the lane is shared; a coordinator that runs on the same lane will queue behind the curator's windows and behind the gate | Claim a new lane (e.g. `'ollama-coordinator'`) and add it to the per-lane ceiling; verify the gate's FIFO scan admits it |
| `ICompactionCallbackRegistry` contract | Medium — the doc explicitly forbids widening `sessionId` to `string \| undefined` | Do not add an absence branch; the producer's null rejection is the invariant |
| `compaction-hook-handler.ts` PostCompact payload | Medium — no `preTokens` today | If the design needs post-compaction preTokens, route the pre-compaction sample through a NEW `SdkAdapterEvents.emitCompactionComplete` field rather than a new contract on the registry |

`[I]` The cleanest Ollama Cloud coordinator design is:
subscribe to `ICompactionCallbackRegistry`, look at the
`trigger` field, and either (a) trigger an Ollama Sonnet
pre-compaction curation (replacing the curator's auto budget)
or (b) post-compaction re-curate with Ollama Opus
(replacing `MemoryStore` writes after the SDK compacted). Both
additive; neither requires a new contract.

---

## 17. Compatibility boundaries

### 17.1 VS Code / Electron / CLI

`[F]` `agent-sdk/CLAUDE.md` "Cross-Lib Rules": "Forbidden imports:
`platform-{cli,electron,vscode}` (adapter selection lives in
app layer)."

- The compaction surface (`CompactionHookHandler`,
  `CompactionCallbackRegistry`, `LiveUsageTracker`,
  `CompactionConfigProvider`) lives entirely in `agent-sdk` and
  `memory-contracts` (zero-dep). It is the same code in all three
  hosts.
- The ptah-cli path is in `cli-agent-runtime` (the
  `ptah-cli-spawn-options.service.ts:221-227` consumer). The
  CLI side's rivalry is to **propagate** the threshold to
  non-Claude CLIs (Codex, Copilot, Cursor, etc.) — not to
  re-define it.
- The Electron app is functionally equivalent to the VS Code
  extension; both go through the chat path. The only
  Electron-specific surface is the `utilityProcess` embedder
  worker (memory-curator's `EmbedderWorkerClient`), which is
  irrelevant to compaction.

### 17.2 Tests

- `compaction-hook-handler.spec.ts` (named in
  `compaction-callback.port.ts:21`).
- `no-activity-watchdog.lifecycle.spec.ts` (PR #484, +140 lines).
- `session-importer.service.spec.ts` (PR #484, +75 lines for
  the prune narrowing).
- `responses-stream-collector.spec.ts` (PR #484, +141 lines for
  Codex wire compaction recovery).
- `message-dispatch.service.spec.ts` (PR #484, +25 lines for
  `session:compacting`).
- `chat-continue-slash-before-resume.spec.ts` (PR #484, +14 lines).

`[C]` There is no `compaction-config-provider.spec.ts` or
`live-usage-tracker.spec.ts` named in the re-read lines; if the
coordinator design touches the config provider or the tracker,
add the spec before the change.

---

## 18. Summary of measured vs inferred

`[F]` (measured):
- All file:line references in §1-§13 are on disk and were read.
- All config defaults and key names are from
  `compaction-config-provider.ts`.
- The `ICompactionCallbackRegistry` token aliases
  `Symbol.for('SdkCompactionCallbackRegistry')` to the same
  singleton in both libs.
- The watchdog's PR #484 changes are exactly the addition of
  `tools` / `tasks` / `compacting` maps and the
  `onOverdue` / `lifecycleHooks` seam.
- The curator's manual compaction cap is `MANUAL_COMPACTION_MAX_WINDOWS = 1`
  and the automatic cap is `CURATOR_MAX_WINDOWS = 8`.
- The slash interceptor classifies `/compact` as
  `new-query`; `/clear` is the only `native` command.
- The chat path **does not** pass `compactionControl` to the
  SDK; the ptah-cli path does.

`[C]` (documented contract):
- The sessionId non-blank invariant on
  `ICompactionCallbackRegistry`.
- The two-slot semantics of `LiveUsageTracker`.
- The manual-vs-auto windowing difference in
  `MemoryCuratorService.start()`.
- The fact that `OffThreadProcessSpawner` exists for every SDK
  launch (TASK_2026_341).
- The fact that an Ollama Cloud Sonnet / Opus coordinator
  would never reach a `ptah-cli` rival-CLI spawn directly
  (those CLIs are vendor SDKs).

`[I]` (inference):
- The "cleanest seam" recommendations in §15-§16 are derived
  from the registered port and the documented non-modification
  rules. They are recommendations, not facts on disk.
- The provider-switch impact on
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is inferred from the
  override's base-URL check.

`[U]` (unknown):
- The integration site of `NoActivityWatchdog.onOverdue`
  (§11.7, §14).
- The exact SDK type of `compactionControl` in the pinned
  `@anthropic-ai/claude-agent-sdk@0.3.150` (CLAUDE.md "Tech
  Stack" — not re-verified in this pass).
- Whether the Ollama Cloud Sonnet / Opus provider will be
  added to the active provider registry
  (`@ptah-extension/auth-providers/.../provider-registry.ts`).
- The exact byte budget for the
  `OllamaCloudCuratorLlm.estimateCost(...)` if the design
  introduces a new ICuratorLLM implementation (TASK_2026_406's
  follow-up).

---

## 19. Source citations

- `D:\projects\ptah-extension\CLAUDE.md` — repo architecture (read
  during this research).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md` —
  compaction surface contract bullets (re-read in full).
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\CLAUDE.md` —
  ptah-cli / spawn contract (re-read in full).
- `D:\projects\ptah-extension\libs\backend\memory-curator\CLAUDE.md` —
  curator budget, boot scan, job queue (re-read in full).
- `D:\projects\ptah-extension\libs\backend\memory-contracts\CLAUDE.md` —
  zero-dep port (re-read in full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-callback-registry.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\live-usage-tracker.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\no-activity-watchdog.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\slash-command-interceptor.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts` (read full, lines 1-120).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` (read lines 700-960).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\memory-contracts\src\lib\compaction-callback.port.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\memory-contracts\src\lib\tokens.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-curator.service.ts` (read lines 1-300).
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\di\register.ts` (read full).
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts` (read lines 1-100).
- `git show a23972881 --stat` — PR #484 file stat (2026-09-09).
- `git log --all --oneline | head -50` — recent commit context
  (2026-09-10, this research).

Access date: 2026-09-10.

# Native Runtime Compaction Contracts

**Task:** TASK_2026_406 — runtime-agnostic intelligent compaction coordinator
**Date:** 2026-09-10
**Scope:** Distinguish model-API endpoints, slash commands, runtime control RPC,
SDK message streams, hook payloads, opaque session-state and persistence/resume
surfaces for native Claude Code and Codex CLI/SDK/app-server compaction.

---

## 1. Verified installed versions

| Component | Version | Provenance |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `0.3.150` | `node_modules/@anthropic-ai/claude-agent-sdk/package.json:3` (accessed 2026-09-10) |
| `@openai/codex-sdk` | `0.147.0` | `node_modules/@openai/codex-sdk/package.json:3` (accessed 2026-09-10) |
| Parity target advertised by SDK changelog | "parity with Claude Code v2.1.150" | `https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md`, entry for 0.3.150 (accessed 2026-09-10) |

These are the versions every contract in this report applies to.

---

## 2. Claude Code / Agent SDK compaction contract

### 2.1 Five distinct surfaces — separated by contract

The Claude SDK exposes compaction across five independent surfaces. A "compaction
command" is not a single thing — each surface has its own invocation, payload
shape, completion signal and cancellation story.

| # | Surface | Type | Direction | Where it lives |
| --- | --- | --- | --- | --- |
| 1 | `/compact` slash command | user-facing CLI input | in → out | `code.claude.com/docs/en/commands` (accessed 2026-09-10) |
| 2 | `--autocompact <auto|tokens>` CLI flag | session flag | in → out | `code.claude.com/docs/en/cli-reference`; minimum Claude Code `v2.1.221` (accessed 2026-09-10) |
| 3 | `/autocompact` slash command | persistent setting | in → out | `code.claude.com/docs/en/commands` (accessed 2026-09-10) |
| 4 | `PreCompact` / `PostCompact` hooks | hook callback (async) | in ← out | `sdk.d.ts:2081-2085`, `sdk.d.ts:2009-2016` |
| 5 | `SDKCompactBoundaryMessage` system event | SDK stream message | out | `sdk.d.ts:2587-2613` |
| 6 | `SDKStatusMessage` with `status: 'compacting'` | SDK stream message | out | `sdk.d.ts:3521-3532` |
| 7 | `SessionStartHookInput.source: 'compact'` | hook callback | in ← out | `sdk.d.ts:3794-3799` |
| 8 | `Query.getContextUsage()` control request | runtime RPC | in → out | `sdk.d.ts:2213-2218`, `sdk.d.ts:2691-2695`, `sdk.d.ts:2700-2790` |

Plus one **non**-surface to be explicit about: there is no `compactionControl`
SDK option and no `Options.compact(...)` method. The SDK carries auto-compact
and context-window state via settings (`Settings.autoCompactWindow`,
`Settings.autoCompactEnabled` — `sdk.d.ts:5183`, `sdk.d.ts:5373`) but exposes
no runtime method that compacts on demand. The closest runtime hooks are
`applyFlagSettings` (`sdk.d.ts:2178-2180`) for layering settings and the hook
surfaces for notification only.

### 2.2 `/compact` slash command (user input)

> "Free up context by summarizing the conversation so far. Optionally pass focus
> instructions for the summary. See how compaction handles rules, skills, and
> memory files."
> — `https://code.claude.com/docs/en/commands` (accessed 2026-09-10)

Sent **as an ordinary prompt string** to the SDK. The TypeScript/Python SDK
does not have a dedicated method for it; you call `query({ prompt: "/compact" })`
or `query({ prompt: "/compact focus on file paths" })` and the SDK forwards it.
This is why the SDK docs say: "Commands sent this way are ordinary SDK inputs."
(`https://code.claude.com/docs/en/agent-sdk/agent-loop.md`, accessed 2026-09-10.)

### 2.3 `--autocompact` CLI flag and `/autocompact` slash command

> "`--autocompact <auto|tokens>` — Set the auto-compact window for this session
> without changing your saved settings. Accepts the same values as `/autocompact`;
> that section covers the value forms and what overrides the flag. Requires
> Claude Code v2.1.221 or later."
> — `https://code.claude.com/docs/en/cli-reference` (accessed 2026-09-10)

> "`/autocompact [auto|<tokens>]` — Set the auto-compact window: how full the
> context window gets before Claude Code compacts automatically. … Claude Code
> saves the value to user settings and applies it to the current session."
> — `https://code.claude.com/docs/en/commands` (accessed 2026-09-10)

There is no SDK options field for the same value (the SDK exposes
`Settings.autoCompactWindow` as a *read* shape on `getContextUsage` /
`resolveSettings`, not as a runtime write). The closest in-SDK equivalent is
`Options.settings` accepting an inline `Settings` object that contains the key
(`sdk.d.ts:1726`).

### 2.4 `PreCompact` and `PostCompact` hooks (callback surfaces)

Hook inputs are TypeScript types declared in `sdk.d.ts`:

```ts
// sdk.d.ts:2081-2085
export declare type PreCompactHookInput = BaseHookInput & {
    hook_event_name: 'PreCompact';
    trigger: 'manual' | 'auto';
    custom_instructions: string | null;
};

// sdk.d.ts:2009-2016
export declare type PostCompactHookInput = BaseHookInput & {
    hook_event_name: 'PostCompact';
    trigger: 'manual' | 'auto';
    compact_summary: string;
};
```

Common base fields include `session_id`, `transcript_path`, `cwd`, `uuid`,
`hook_event_name` (the docs page at `code.claude.com/docs/en/hooks.md`
documents these as common to all hooks — accessed 2026-09-10; the page was
truncated before per-event payload tables but the common-field list is verbatim
there).

The matcher filter on these hooks is **trigger**:

> "PreCompact, PostCompact — what triggered compaction — `manual`, `auto`"
> — `https://code.claude.com/docs/en/hooks.md` (accessed 2026-09-10)

Hook callback signature (`sdk.d.ts:785-787`):

```ts
export declare type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;
```

The `AbortSignal` is forwarded; a hook that ignores the signal may continue
running after the SDK cancels the surrounding operation.

Hook JSON output is `AsyncHookJSONOutput | SyncHookJSONOutput` (`sdk.d.ts:803`).
Per-event outputs are declared for most events; **the SDK source shows no
`PreCompactHookSpecificOutput` / `PostCompactHookSpecificOutput`** — so the only
valid output shape for these two events is the common one (no
`hookSpecificOutput` is documented for either; verify at runtime if needed).

There is no documented way to **block** or **modify** compaction from a hook.
The hooks are notification-only by contract; do not assume otherwise.

### 2.5 `SDKCompactBoundaryMessage` system event (completion signal)

```ts
// sdk.d.ts:2587-2613
export declare type SDKCompactBoundaryMessage = {
    type: 'system';
    subtype: 'compact_boundary';
    compact_metadata: {
        trigger: 'manual' | 'auto';
        pre_tokens: number;
        post_tokens?: number;
        duration_ms?: number;
        preserved_segment?: { head_uuid; anchor_uuid; tail_uuid };
        preserved_messages?: { anchor_uuid; uuids: UUID[] };
    };
    uuid: UUID;
    session_id: string;
};
```

This is the **authoritative completion signal** for compaction:

> "When the context window approaches its limit, the SDK automatically compacts
> the conversation: it summarizes older history to free space, keeping your most
> recent exchanges and key decisions intact. The SDK emits a message with
> `type: "system"` and `subtype: "compact_boundary"` in the stream when this
> happens."
> — `https://code.claude.com/docs/en/agent-sdk/agent-loop.md` (accessed 2026-09-10)

`compact_boundary` fires **after** compaction completes, not before. The
relink fields (`preserved_segment`, `preserved_messages`) are only present when
partial messages were preserved; absent on full summarization.

### 2.6 `SDKStatusMessage` with `status: 'compacting'` (start signal)

```ts
// sdk.d.ts:3521-3532
export declare type SDKStatus = 'compacting' | 'requesting' | null;
export declare type SDKStatusMessage = {
    type: 'system';
    subtype: 'status';
    status: SDKStatus;
    permissionMode?: PermissionMode;
    compact_result?: 'success' | 'failed';
    compact_error?: string;
    uuid: UUID;
    session_id: string;
};
```

The `compact_result` + `compact_error` fields on a status message are the
**error-path completion signal**: a separate `SDKStatusMessage` carrying
`status: null` (or `'requesting'`) plus `compact_result: 'failed'` and
`compact_error: string`. A successful compaction produces a `compact_boundary`
system message (`sdk.d.ts:3241`, `SDKMessage` union includes
`SDKCompactBoundaryMessage`); a failed compaction produces a status message
with `compact_result: 'failed'`.

### 2.7 `SessionStartHookInput.source: 'compact'` (resumed-after-compact signal)

```ts
// sdk.d.ts:3794-3799
export declare type SessionStartHookInput = BaseHookInput & {
    hook_event_name: 'SessionStart';
    source: 'startup' | 'resume' | 'clear' | 'compact';
    ...
};
```

When a session is `query()`-resumed immediately after a compaction completes
(the compaction is followed by a fresh `query()` against the same sessionId),
the first `SessionStart` hook fires with `source: 'compact'` rather than
`'startup'` or `'resume'`. Useful as a "fresh context after compact" marker.

### 2.8 `Query.getContextUsage()` control request

```ts
// sdk.d.ts:2213-2218
getContextUsage(): Promise<SDKControlGetContextUsageResponse>;

// sdk.d.ts:2700-2790
export declare type SDKControlGetContextUsageResponse = {
    categories: { name; tokens; color; isDeferred? }[];
    totalTokens: number;
    maxTokens: number;
    rawMaxTokens: number;
    percentage: number;
    gridRows: ...;
    model: string;
    memoryFiles: ...;
    mcpTools: ...;
    autoCompactThreshold?: number;
    isAutoCompactEnabled: boolean;
    apiUsage: ...;
    ...
};
```

This is the **runtime, on-demand** way to ask the SDK how full the context is,
whether auto-compact is enabled, and what threshold it would use. The
`autoCompactThreshold` field exists in the response (`sdk.d.ts:2764`) but is
**optional** — its absence means "not configured / not available"; treat as
unknown, not zero.

The matching request subtype (`sdk.d.ts:2693-2695`):

```ts
declare type SDKControlGetContextUsageRequest = { subtype: 'get_context_usage' };
```

### 2.9 Persistence / resume / fork

- `Options.persistSession?: boolean` (`sdk.d.ts:1438`) — opt out of writing
  the JSONL transcript.
- `Options.resume?: string` (`sdk.d.ts:1654`) — continue an existing sessionId.
- `Options.resumeSessionAt?: string` (`sdk.d.ts:1666`) — resume up to a
  specific message UUID; cannot be combined with `continue` or `resume`
  without `forkSession`.
- `Options.forkSession?: boolean` (`sdk.d.ts:1388`) — resume but mint a new
  sessionId.
- `forkSession(sessionId, options)` top-level helper (`sdk.d.ts:664`).
- `renameSession(sessionId, title, options?)` top-level helper (`sdk.d.ts:2358`).
- `getSessionMessages(sessionId, options?)` returns the session messages, with
  `options.includeSystemMessages: true` (`sdk.d.ts:728-747`) returning
  `compact_boundary` lines alongside user/assistant messages.

Resume behavior after a `compact_boundary`: the JSONL transcript contains the
boundary as a `type: 'system'` line with `subtype: 'compact_boundary'` and
`compact_metadata`. On resume the SDK replays the conversation history
including the boundary; pre-compact messages are still in the file but the
session's working context is the post-compact state.

`SessionReplay` consumers in this repo already account for that — they find the
last `compact_boundary` and skip everything before it:

- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:90-94`
  (skips `i` pre-compact messages on `compact_boundary`).
- `libs/backend/agent-sdk/src/lib/helpers/live-usage-tracker.ts:148` (drops
  resume baseline and snapshot on `compact_boundary`).

### 2.10 Cancellation and interruption

There is no documented way to cancel an in-flight compaction from a hook or
from a `Query` method. The relevant SDK controls:

- `Options.abortController?: AbortController` (`sdk.d.ts:1218-1221`) — aborts
  the whole query, including a compaction turn in progress.
- `Query.interrupt(): Promise<void>` (`sdk.d.ts:2128`) — interrupts the current
  turn; the docs do not guarantee interruption of an active compaction turn
  specifically.

The hook callback receives an `AbortSignal` (`sdk.d.ts:785-787`); honoring it
limits how long a hook can delay compaction, but does not cancel compaction
itself.

A `PreCompact` hook that throws or never returns will still complete its
callback (the SDK only waits for the hook promise); the compaction proceeds.

### 2.11 Manual vs automatic — what the SDK decides

`trigger: 'manual' | 'auto'` on both the hook payload and the
`compact_metadata` payload is supplied by the SDK:

- `manual` — compaction requested by the user (via `/compact [instructions]`
  as a prompt, or by a UI action that sends that string).
- `auto` — compaction initiated by the SDK's automatic window when context
  fills (`Settings.autoCompactEnabled`, `Settings.autoCompactWindow`).

A runtime coordinator cannot **force** auto-compact by sending a prompt.
There is no SDK method that triggers auto-compact on demand. The
`applyFlagSettings` method (`sdk.d.ts:2178-2180`) can change the
`autoCompactWindow` value mid-session; the SDK then applies the new threshold
on the next token-count check.

---

## 3. Codex CLI / SDK / app-server compaction contract

### 3.1 Sources verified

- `https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/protocol.rs`
  (accessed 2026-09-10) — wire types: `Op::Compact`, `EventMsg::ContextCompacted`,
  `HookEventName::{PreCompact, PostCompact}`, `NonSteerableTurnKind::Compact`,
  `SubAgentSource::Compact`.
- `https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/session/compact.rs`
  (accessed 2026-09-10) — internal module: `run_compact_task`,
  `run_inline_auto_compact_task`, `build_compacted_history*`,
  `compaction_status_from_result`, `CompactionStatus::{Completed, Interrupted, Failed}`,
  `CompactionStrategy::Memento`, `CompactionImplementation::Responses`.
- `https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/slash_command.rs`
  (accessed 2026-09-10) — `SlashCommand::Compact` → user-facing `/compact`.
- `https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/thread.ts`
  (accessed 2026-09-10) — `Thread.run()` and `Thread.runStreamed()` forward
  any input verbatim to the CLI; no `/compact` parsing at the SDK layer.

### 3.2 Invocation surfaces

| # | Surface | Type | Notes |
| --- | --- | --- | --- |
| 1 | `/compact` slash command (TUI) | user input | `SlashCommand::Compact` in `codex-rs/tui/src/slash_command.rs`; only the TUI parses it |
| 2 | Send the literal string `"/compact"` to `Thread.run()` / `Thread.runStreamed()` | SDK call | SDK forwards it verbatim; TUI-side parsing applies; `AppCommand::Compact` is dispatched |
| 3 | `Op::Compact` submission | in-process Op | In-process Rust enum, **not** wire-serialized (no `Serialize`/`Deserialize` on `Op`) |
| 4 | Auto mid-turn compaction | internal | `run_inline_auto_compact_task` in `compact.rs`; no SDK / app-server hook |
| 5 | `PreCompact` / `PostCompact` hooks | hook event | HookEventName enum values; payload carried by `HookStartedEvent` / `HookCompletedEvent` with `run.event_name` discriminator |

The Codex SDK does **not** expose any dedicated compaction method on `Thread`,
`Codex`, `ThreadOptions`, `CodexOptions`, `Turn`, `TurnOptions`, or any
`ThreadEvent` type. The TypeScript SDK surface (`codex-sdk/dist/index.d.ts`)
contains zero compaction types — confirmed by full read of the 278-line file
on 2026-09-10.

### 3.3 Completion signals

| Signal | Type | Payload | Source |
| --- | --- | --- | --- |
| `ContextCompactedEvent` | in-process `EventMsg` | unit struct; serializes to `{ "type": "context_compacted" }` on the wire | `protocol.rs` |
| `TurnItem::ContextCompaction` started / completed | turn-item lifecycle | `sess.emit_turn_item_started` / `sess.emit_turn_item_completed` | `compact.rs` |
| `EventMsg::Error` | failure path | error text | `compact.rs` (errors forwarded as Error events) |
| `EventMsg::Warning` | post-success | "Heads up: Long threads and multiple compactions..." | `compact.rs` |
| `CompactionStatus` analytics | offline | `Completed | Interrupted | Failed`; `CompactionStrategy::Memento`; `CompactionImplementation::Responses`; trigger / reason / phase fields | `compact.rs` |
| `HookStartedEvent` / `HookCompletedEvent` | hook lifecycle | `run.event_name === "pre_compact"` or `"post_compact"`; `run.status` carries success/failure | `protocol.rs` |

`ContextCompactedEvent` is a **unit struct** — it carries no payload beyond its
type tag. There is no `pre_tokens`, `post_tokens`, or `duration_ms` analogue
on the Codex side (the Codex `compact.rs` summary shape is internal and not
exposed on `ContextCompactedEvent`).

### 3.4 Hook payload shape

The Codex protocol reuses the generic `HookStartedEvent` / `HookCompletedEvent`
carriers — there are no dedicated `PreCompactHookEvent` / `PostCompactHookEvent`
structs in `protocol.rs`. The compaction hook payload is the same generic
`HookRunSummary` as every other hook:

```rust
pub struct HookRunSummary {
    pub id: String,
    pub event_name: HookEventName,           // "pre_compact" | "post_compact"
    pub handler_type: HookHandlerType,
    pub execution_mode: HookExecutionMode,
    pub scope: HookScope,
    pub source_path: AbsolutePathBuf,
    pub source: HookSource,
    pub display_order: i64,
    pub status: HookRunStatus,
    pub status_message: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub entries: Vec<HookOutputEntry>,
}
```

There is no Codex-side analogue of `trigger: 'manual' | 'auto'`. The Codex
sources distinguish manual vs auto by routing (`run_compact_task` vs
`run_inline_auto_compact_task`); that distinction does not propagate to the
wire.

### 3.5 App-server JSON-RPC surface (unknown)

I could not locate a published JSON-RPC wire definition for `Op::Compact` or
`ContextCompactedEvent`. The `Op` enum in `protocol.rs` has no
`Serialize`/`Deserialize` derive — the in-process Rust value is not directly
the wire payload. The app-server must serialize it through a separate
adapter, but the adapter file (likely under `codex-rs/app-server/`) was not
retrievable in this session.

**This is an unknown.** Do not assume Codex compaction is reachable via
JSON-RPC. For Ptah purposes the only safe assumption is: "compaction is
observable via `HookStartedEvent`/`HookCompletedEvent` and `ContextCompacted`
on the existing event stream, and invokable by sending the literal `/compact`
string through `Thread.run()`."

### 3.6 Cancellation / interruption

`Op::Compact` returns synchronously? No — `run_compact_task` is async, and
`CompactionStatus::Interrupted` exists in analytics, which means a CLI
interruption (Ctrl+C, terminal close) can abort mid-compaction and record an
Interrupted analytics event rather than a Completed one. The SDK exposes
`TurnOptions.signal?: AbortSignal` (`codex-sdk/dist/index.d.ts:173`) which
aborts the surrounding turn — but the source did not show whether `signal`
specifically unwinds an active compaction turn inside `run_compact_task`. Treat
as **probably yes** (consistent with `Interrupt` hook), but unverified in the
retrieved source.

### 3.7 Persistence / resume

Codex sessions persist to `~/.codex/sessions` (the `Codex` class doc string in
`codex-sdk/dist/index.d.ts:268-275` states "Threads are persisted in
`~/.codex/sessions`"). Compaction writes a summary that survives resume;
the wire shape of the persisted summary is the `TurnItem::ContextCompaction`
plus the synthetic summary messages, both visible in the post-compact replay.
The Codex SDK does not expose a separate `compact_boundary` query method or a
hook to read it back; you read the persisted thread and look for the
synthetic summary turn item.

---

## 4. Capability matrix (Claude Agent SDK 0.3.150 vs Codex SDK 0.147.0)

Every row is a question a runtime-agnostic compaction coordinator needs to
answer; each cell says what surface (if any) the SDK exposes.

| Capability | Claude Agent SDK 0.3.150 | Codex SDK 0.147.0 |
| --- | --- | --- |
| User-facing slash command | `/compact [instructions]` (forwarded as a prompt) | `/compact` (parsed by TUI; SDK forwards verbatim) |
| SDK method that triggers compaction on demand | **None** | **None** (send `/compact` as input) |
| SDK option that enables/disables auto-compact | `Options.settings.autoCompactEnabled` (settings layer, not a separate Options field) | **None at SDK layer** (Codex CLI config only) |
| SDK option that sets auto-compact window size | `Options.settings.autoCompactWindow` (settings layer) | **None at SDK layer** |
| PreCompact hook | `PreCompactHookInput { trigger: 'manual' \| 'auto'; custom_instructions: string \| null }` | `HookStartedEvent` with `run.event_name === 'pre_compact'`; no trigger field |
| PostCompact hook | `PostCompactHookInput { trigger: 'manual' \| 'auto'; compact_summary: string }` | `HookStartedEvent` / `HookCompletedEvent` with `run.event_name === 'post_compact'`; no summary payload |
| Completion signal (success) | `SDKCompactBoundaryMessage` with `compact_metadata { trigger, pre_tokens, post_tokens?, duration_ms?, preserved_segment?, preserved_messages? }` | `ContextCompactedEvent` unit struct on `EventMsg` (`{"type":"context_compacted"}`); plus `TurnItem::ContextCompaction` start/complete |
| Completion signal (failure) | `SDKStatusMessage { status: null\|'requesting', compact_result: 'failed', compact_error: string }` | `EventMsg::Error` carrying error text; `HookCompletedEvent` with `status: failed`; analytics `CompactionStatus::Failed` |
| Pre-tokens / post-tokens telemetry on completion | Yes (`pre_tokens`, `post_tokens?`, `duration_ms?`) | **No** — `ContextCompactedEvent` is empty; analytics records the strategy and status but not token counts |
| Partial-preserve / relink metadata | `preserved_segment`, `preserved_messages` on `compact_metadata` | **None on the wire** (compacted history is rebuilt from `build_compacted_history`; the summary turn item is what survives) |
| Pre-compaction status indicator | `SDKStatusMessage { status: 'compacting' }` before the `compact_boundary` | **None on SDK stream** (only `HookStartedEvent` for pre_compact) |
| On-demand context-usage query | `Query.getContextUsage()` → `SDKControlGetContextUsageResponse { totalTokens, maxTokens, rawMaxTokens, percentage, autoCompactThreshold?, isAutoCompactEnabled, apiUsage, ... }` | **None** (Codex SDK has no `getContextUsage` analogue) |
| Resume picks up compacted state | Yes (`Options.resume`) — replayed JSONL includes the boundary line; UI consumers skip pre-boundary messages | Yes — `Codex.resumeThread(id, options)` — persisted thread includes the synthetic summary turn item |
| Resume from specific point | `Options.resumeSessionAt?: UUID` | **None at SDK layer** |
| Fork after compaction | `forkSession(sessionId, options)` or `Options.forkSession: true` with `resume` | **None** |
| Abort / cancel | `Options.abortController`, `Query.interrupt()` — applies to the whole query | `TurnOptions.signal?: AbortSignal` — applies to the turn; unverified for in-flight compaction |
| Hook cancellation | Hook receives `AbortSignal` (`sdk.d.ts:785-787`); honoring limits hook delay | Hook receives the same lifecycle; signal forwarding on hook events is generic, not per-event |
| Block compaction from hook | **No** — hooks are notification-only by contract; no documented `permissionDecision` or "deny" hook output for compaction | **No** (same shape; hooks observe lifecycle, do not gate) |
| Modify summary from hook | **No** — `PostCompactHookInput.compact_summary` is the final summary, not editable | **No** |
| Custom summary instructions | `PreCompactHookInput.custom_instructions: string \| null`; also forwarded via `/compact [instructions]` prompt | **Not on the hook payload**; instructions are a CLI-side concept, not a wire field |
| Sibling message: resumption / fresh context marker | `SessionStartHookInput.source: 'compact'` | **None** (Codex has no equivalent SessionStart signal) |
| Auto-compact threshold queryable at runtime | `SDKControlGetContextUsageResponse.autoCompactThreshold?` + `isAutoCompactEnabled` | **No** — Codex SDK has no equivalent control response |
| 1M-token beta for Sonnet 4/4.5 | `Options.betas: ['context-1m-2025-08-07']`; toggled automatically by SDK | N/A |

---

## 5. Distinguishing the surfaces — measured facts

### 5.1 A "command text" is NOT a command

A user (or Ptah) sending the literal string `/compact` to the Claude SDK
**does not invoke a control protocol call**. The SDK forwards the string as a
user prompt; the CLI's prompt parser interprets the leading `/`. The same
string sent to the Codex SDK (`Thread.run("/compact")`) goes through the
`codex exec` subprocess, whose prompt parser sees the slash and dispatches it
to the TUI's `SlashCommand::Compact` parser (TUI side) or to the
non-interactive handler in `codex exec` (headless side, not yet verified in
this report).

A coordinator must not assume:

- that a slash-command-like string is an SDK method invocation,
- that an SDK method invocation compiles to a slash command,
- that the SDK's CLI subprocess and the SDK's TypeScript layer interpret
  `/compact` identically.

### 5.2 A hook payload is NOT a control request

Claude's `PreCompactHookInput.trigger` is set by the SDK based on whether
compaction was initiated manually or automatically. A coordinator cannot
"send" a `trigger` value — it can only observe it on the hook callback.

### 5.3 A `compact_boundary` message is NOT a hook callback

The boundary is a system message on the SDK message stream. Hooks are
registered callbacks fired by the CLI subprocess. They are independent
channels; in Claude SDK the boundary may arrive **before** the `PostCompact`
hook (or after, depending on timing — see TASK_2026_293 in this repo, which
documents a race that left PreCompact and PostCompact handlers with mismatched
sessionIds). A coordinator must not treat one as a substitute for the other.

### 5.4 Auto-compact IS settings-driven, not call-driven

Auto-compact is enabled by:

- Claude: `Settings.autoCompactEnabled: boolean` (`sdk.d.ts:5373`) and a
  threshold via `Settings.autoCompactWindow: number` (`sdk.d.ts:5183`). Both
  are settings-layer values, settable via `Options.settings` or
  `Query.applyFlagSettings`.
- Codex: CLI configuration (`config.toml` keys, not exposed on
  `codex-sdk/dist/index.d.ts`).

Neither SDK exposes a programmatic "compact now if auto is enabled" method.

### 5.5 Context usage is read-only

`Query.getContextUsage()` returns a snapshot. It does not trigger compaction
and does not modify state. Its `autoCompactThreshold` field is informational;
treat absent as unknown, not zero.

### 5.6 Codex TypeScript SDK has zero compaction types

A full read of `node_modules/@openai/codex-sdk/dist/index.d.ts` (278 lines,
accessed 2026-09-10) confirmed: no `compact`, `Compact`, or
`ContextCompacted*` identifier. The Codex surface for a TypeScript SDK user
is: forward `/compact` as input and observe the standard `ThreadEvent`
stream for the `context_compacted` JSON tag.

---

## 6. What this means for a runtime-agnostic coordinator

A coordinator that needs to operate on both surfaces needs to:

1. Treat the trigger as a user-input string in both worlds; there is no
   native API method that compacts on demand.
2. Observe the lifecycle through:
   - **Claude**: `PreCompact` hook → `SDKStatusMessage { status: 'compacting' }`
     → `SDKCompactBoundaryMessage` (with `compact_metadata.pre_tokens` /
     `post_tokens?` / `duration_ms?`); `PostCompact` hook for the summary text.
   - **Codex**: send `/compact` as input; observe `HookStartedEvent` for
     `pre_compact` / `post_compact`; observe `EventMsg::ContextCompacted` (the
     `{"type":"context_compacted"}` JSON tag) for completion; check
     `TurnItem::ContextCompaction` on the turn-item stream if more detail is
     needed.
3. Read context usage on demand via `Query.getContextUsage()` on Claude; on
   Codex the SDK has no equivalent — derive from local token counts or skip.
4. Honor the auto-compact threshold only as an **observation**, never as a
   trigger: the SDK chooses when to auto-compact; the coordinator can only
   raise or lower the threshold via `Settings.autoCompactWindow` on Claude or
   Codex config on Codex.
5. Treat the persisted compact_boundary line in the JSONL transcript as the
   durable record of when compaction happened and what tokens were involved.
   Codex has the synthetic summary turn item in its persisted thread, no
   token-counts record.

---

## 7. Open questions / unknowns (NOT measured)

- **Codex app-server JSON-RPC surface for `Op::Compact`.** The protocol file
  confirms `Op::Compact` exists in-process but has no wire-level serde
  derives; the app-server adapter was not retrievable in this session.
  Inference, not fact: there is no JSON-RPC method named `compact` based on
  the absence of serde on `Op`. **Verify before designing anything that
  assumes an app-server RPC for compaction.**
- **Codex non-TUI `/compact` parsing.** The TUI's `SlashCommand::Compact`
  parsing was confirmed, but `codex exec` (headless mode) parsing of `/compact`
  was not verified. The TypeScript SDK does not parse it; whether `codex exec`
  handles `/compact` in its stdin prompt is unverified.
- **Whether `TurnOptions.signal` cancels an in-flight compaction.** The Codex
  protocol shows `CompactionStatus::Interrupted` exists in analytics, which
  suggests interruption works at the Op layer. Whether that flows through
  `TurnOptions.signal` (versus Ctrl+C / terminal close) is unverified.
- **Claude SDK `PreCompactHookSpecificOutput` / `PostCompactHookSpecificOutput`.**
  No such type is declared in `sdk.d.ts`. Hooks that want to emit
  `hookSpecificOutput` for these events would silently produce no effect;
  confirm with the SDK before relying on a hook-output payload.
- **Claude SDK minimum version for `--autocompact` flag.** Docs require
  `v2.1.221`; SDK 0.3.150 advertises parity with Claude Code `v2.1.150`.
  The flag is documented as CLI-only; the SDK may not expose it. **A
  coordinator that wants the same behavior through the SDK should use
  `Options.settings.autoCompactWindow` instead.**
- **Whether Codex SDK exposes hook callbacks at all.** The TypeScript SDK
  types do not mention hooks; the underlying CLI accepts a hooks config
  (`codex-rs/protocol/src/protocol.rs:HookEventName`) but no SDK plumbing
  was observed. **A coordinator cannot subscribe to Codex `pre_compact` /
  `post_compact` hooks through the TypeScript SDK as of 0.147.0.**
- **Persistence format for Codex compaction summary.** Visible as
  `TurnItem::ContextCompaction` in the in-process protocol; the on-disk JSONL
  shape in `~/.codex/sessions/` was not verified in this session.

---

## 8. Provenance summary

| Claim | Source | Access date |
| --- | --- | --- |
| Claude SDK 0.3.150 parity with Claude Code v2.1.150 | `https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md` | 2026-09-10 |
| Codex SDK 0.147.0 type surface (no compaction identifiers) | `node_modules/@openai/codex-sdk/dist/index.d.ts` (full read) | 2026-09-10 |
| Codex wire types `Op::Compact`, `EventMsg::ContextCompacted`, `HookEventName::PreCompact/PostCompact`, `NonSteerableTurnKind::Compact`, `SubAgentSource::Compact` | `https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/protocol.rs` | 2026-09-10 |
| Codex compaction module internals (`run_compact_task`, `run_inline_auto_compact_task`, `compaction_status_from_result`, `CompactionStatus::{Completed, Interrupted, Failed}`, `CompactionStrategy::Memento`, `CompactionImplementation::Responses`) | `https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/session/compact.rs` | 2026-09-10 |
| Codex TUI `SlashCommand::Compact` → `/compact` | `https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/slash_command.rs` | 2026-09-10 |
| Codex TypeScript SDK forwards `/compact` verbatim (no SDK-side parsing) | `https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/thread.ts` | 2026-09-10 |
| Claude `/compact`, `/autocompact` slash-command semantics | `https://code.claude.com/docs/en/commands` | 2026-09-10 |
| Claude `--autocompact <auto\|tokens>` flag (Claude Code v2.1.221+) | `https://code.claude.com/docs/en/cli-reference` | 2026-09-10 |
| Claude `compact_boundary` system message + `PreCompact` hook semantics | `https://code.claude.com/docs/en/agent-sdk/agent-loop.md` | 2026-09-10 |
| Claude hook common fields + `PreCompact` / `PostCompact` matcher | `https://code.claude.com/docs/en/hooks.md` (truncated) | 2026-09-10 |
| Ptah `SessionReplay` skips messages before last `compact_boundary` | `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:90-94` | 2026-09-10 |
| Ptah `LiveUsageTracker` drops baseline + snapshot on `compact_boundary` | `libs/backend/agent-sdk/src/lib/helpers/live-usage-tracker.ts:148` | 2026-09-10 |
| Ptah `CompactionHookHandler.createHooks(sessionId, cwd, onCompactionStart)` contract | `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:134-350` | 2026-09-10 |
| Ptah `CompactionConfigProvider` reads `ptah.compaction.enabled` and `ptah.compaction.threshold` (default 100,000 tokens) | `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts:19-106` | 2026-09-10 |
| Ptah `transformCompactBoundary` emits `compaction_complete` `FlatStreamEvent` with `trigger`, `preTokens`, `postTokens?`, `durationMs?` | `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts:32-96` | 2026-09-10 |
| Ptah `SdkAgentAdapter` is the interactive chat path; `InternalQueryService` is the headless path | `libs/backend/agent-sdk/CLAUDE.md:13-77` | 2026-09-10 |

---

## 9. Inference disclaimer

Items labeled **inference** or **probably** are NOT measured facts; they are
educated guesses based on the verified type and source layouts. Items labeled
**unknown** were not verifiable from the sources accessed in this session and
must be re-verified before any contract assumption is locked in. The matrix
in §4 is exhaustive only of what the verified sources prove; absent cells
mean "not observed", not "definitely absent".

A coordinator that wants to use a non-verified Codex surface should
short-circuit to a user-prompt `/compact` forward — that path was verified for
both SDKs — until the unknown surface is measured.
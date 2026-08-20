# Item 6 — consumer audit: who keys state by the hook-reported id

> Produced by an investigation agent during architecture planning, 2026-08-19.
> **Not independently verified by the orchestrator.** Line numbers were reported
> from live reads; treat them as accurate-as-of-this-commit and re-check before
> editing.

> [!WARNING]
> **This file says `tab_N`. That is wrong.** A tabId at the current commit is a
> **UUID v4** — `TabId.create()` returns `uuidv4()`
> (`libs/shared/src/lib/types/branded.types.ts:165-167`), verified by the
> orchestrator. `tab_<ts>_<id>` is the _legacy_ format, now rejected at the chat
> RPC boundary (`chat-rpc.schema.ts:4-13, 36-41`).
>
> Two consequences, both load-bearing:
>
> - `SessionId.validate(tabId)` returns **true**. A tabId is
>   shape-indistinguishable from an SDK session UUID, so **canonicalisation by
>   inspection is impossible** — any "detect a tabId and swap it" design is
>   unimplementable.
> - A `LIKE 'tab\_%'` SQL predicate would match only legacy rows. Never write one.
>
> This file's _mechanism_ and _enumeration_ sections remain correct; only the
> `tab_N` naming is wrong. Read `implementation-plan.md` §6a before acting on
> anything here. The candidate fix proposed at the bottom of this file
> (promote the single-slot setter to a registry) was **rejected** in §6c — the
> setter is part of the shared `IAgentAdapter` port
> (`agent-adapter.types.ts:253`), so promoting it is a breaking port change.

## The mechanism, confirmed

The brief described the symptom. This is the cause, and it is narrower than
"the closure holds a tabId".

**Where the split originates**

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:460` — `const trackingId = tabId as SessionId;`, passed as `sessionId` into `executeQuery` (`:475`) and `streamTransformer.transform` (`:511`).
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:671-677` — `createHooks(cwd, sessionId, ...)`. **The hook closure id on the chat path is `tab_N`.**
- `session-query-executor.service.ts:118` — `const registerKey = sessionConfig?.tabId ?? (sessionId as string);`

**Where the canonical UUID first appears**

`helpers/stream-transformer.ts:287-292` — on `isSystemInit`, `effectiveSessionId`
is replaced with `sdkMessage.session_id` and `onSessionIdResolved(tabId, realSessionId)`
fires. Callback built at `sdk-agent-adapter.ts:632-666`; resume path `:605-609`.

**The actual mismatch — two publishers disagree**

| Publisher                                      | Site                                                                                                                                  | Emits                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionActivityRegistry` via `notifyActivity` | `sdk-agent-adapter.ts:837-856`, canonicalising through `resolveActivityIds` `:827-835` (`rec?.realSessionId ?? sessionId`)            | **`tab_N` on the first user prompt** (`:506`, called before the stream is consumed, so `rec.realSessionId` is still `null`), UUID on every later call |
| `SessionEndCallbackRegistry`                   | `session-lifecycle/session-control.service.ts:126` — `const registrySessionId = rec.realSessionId ?? rec.tabId;`, notified `:168-171` | **UUID**                                                                                                                                              |

State is armed under `tab_N` and torn down under the UUID. That is the orphaned
idle timer the brief predicted, and it is a **first-turn-only** window — which is
why it is intermittent rather than universal.

## The enumeration

### A. `skill-synthesis` — `SkillTriggerService` (`src/lib/triggers/skill-trigger.service.ts`)

| Map                  | Line  | Value                                                                |
| -------------------- | ----- | -------------------------------------------------------------------- |
| `sessions`           | `:78` | `{ workspaceRoot, idleTimer }` (`:52-55`)                            |
| `editTestStates`     | `:79` | `{ workspaceRoot, editCount, lastEditAt, windowStartAt }` (`:62-67`) |
| `turnCompleteStates` | `:80` | `{ workspaceRoot, timer }` (`:57-60`)                                |

- `sessions`: write `:194`/`:200` from `onActivity`; **timer armed `:203-206`** `setTimeout(() => this.fireIdle(payload.sessionId), idleMs)` — the closure captures the id it was armed with; read `:210`, `:578`; delete `:213`, `:171`; timer cleared `:166`, `:203`, `:212`.
- `turnCompleteStates`: 90 s debounce (`TURN_COMPLETE_DEBOUNCE_MS` `:50`); write `:228`/`:231` from `onStop`; **timer armed `:234-236`**; read `:216`, `:240`; delete `:219`, `:243`, `:173`.
- `editTestStates`: write `:392`/`:400` from `onPostToolUse`; read `:412`; delete `:415`, `:436`, `:451`, `:215`.

Downstream, same key:

- `SkillSynthesisService.analyzedSessions` — `skill-synthesis.service.ts:176` `Map<sessionId, turnCount>`; read `:467`, `:605`; write `:480`, `:612`; delete `:593`.
- `SkillQueueStore` (SQLite) — `queue/skill-queue.store.ts`, column `session_id` `:56`, **`UNIQUE(session_id, stage)`** `:7`, `:197`; lookups `:139`, `:571`. Enqueued from trigger `:607-639`.
- `SkillInvocationRecorder.seen` — `skill-invocation-recorder.ts:26`, key `` `${slug}|${sessionId}|${...}` `` `:38`, written `:73`.
- `archaeology/transcript-window.reader.ts:185` — `` `${sessionsDir}/${source.sessionId}.jsonl` ``. **A `tab_N` id yields a non-existent path.**

### B. `memory-curator` — `MemoryTriggerService` (`src/lib/triggers/memory-trigger.service.ts`)

| Map/Set           | Line                                                         |
| ----------------- | ------------------------------------------------------------ |
| `sessions`        | `:86` — `{ workspaceRoot, idleTimer, turnCount }` (`:68-72`) |
| `episodes`        | `:87` — `EpisodeTracker`                                     |
| `inFlightCurates` | `:88` — `Set<string>`                                        |
| `lastCurateAt`    | `:89` — `Map<string, number>`                                |

- `sessions`: write `:229`/`:236`; **timer armed `:239-242`**; read `:329`, `:508`; delete `:331`, `:203`.
- `EpisodeTracker` (`triggers/episode-tracker.ts:53`): `recordTurn` `:65` ← `:263`; `recordFailure` `:78` ← `:291`; `recordToolSuccess` `:96` ← `:412`; `recordCommit` `:104` ← `:442`; `snapshot` `:108` ← `:417`, `:545`, `:570`; `reset` `:189` ← `:328`, `:547`, `:590`.
- `inFlightCurates` / `lastCurateAt`: read `:602-606`; write `:591`, `:592`; delete `:654`, `:206`.

Downstream, same key:

- `ObservationQueueStore` (SQLite `observation_queue`) — `observation-queue.store.ts`: refuses blank `:130`; insert `:139-150`; `drainForSession` `:207-218`, `:228-239`; `countUnprocessed` `:265-270`. Written from trigger `:257`, `:284`, `:336`, `:399`, `:437`, `:455`; drained `:629`.
- `MemoryCuratorService.inFlight` — `memory-curator.service.ts:63`, key `` `${workspaceRoot ?? ''}::${sessionId}` `` `:243`.
- Trigger `:619` `transcriptReader.read(sessionId, workspaceRoot)` — **a `tab_N` id here is exactly the TASK_2026_293 failure mode** (transcript reader rejects it, curator writes a placeholder).

### C. agent-sdk internal

- `SubagentRegistryService` records registered with `parentSessionId` at `subagent-hook-handler.ts:217-231`; queried in `session-control.service.ts:129/131/163`.
- `AgentProcessManager` records (`parentSessionId`).

## The precedent that already exists — and its gap

Three tabId→UUID remaps are already implemented:

1. **`SessionRegistry` dual index** — `session-lifecycle/session-registry.service.ts`: `byTabId` `:84`, `bySessionId` `:91`, `bindRealSessionId` `:156` (set-once, rejects blank `:157-161`, rejects unknown tab `:164-168`, idempotent `:170-174`, refuses overwrite `:176-180`). Wrapper `session-lifecycle-manager.ts:348`.
2. **`SubagentRegistryService.resolveParentSessionId`** — `vscode-core/src/services/subagent-registry.service.ts:634-660`, scan-and-rewrite over the store.
3. **`AgentProcessManager.resolveParentSessionId`** — driven from `cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` (note: `wiring/`, not `ptah-cli/`), `wireSessionIdResolvedCallback` `:147`, remaps at `:176` and `:184`, broadcast `:193`.

**The gap:** nothing in `skill-synthesis` or `memory-curator` subscribes to that
signal, and there is no registry they _could_ subscribe to — the callback is a
**single-slot setter** on the adapter (`sdk-agent-adapter.ts:668`), already
consumed by `cli-agent-runtime`.

Candidate answer for the architect to accept or reject with reasons: **promote
the single-slot `onSessionIdResolved` setter to a fan-out registry** (same shape
as the twelve existing `*CallbackRegistry` classes), then have the two trigger
services subscribe and rekey. Reuses an established pattern, leaves `registerKey`
and the MCP routing segment untouched, substitutes the UUID nowhere.

## Also affected by the same pre-`init` hole

`vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:545-553`
`resolveSessionId` does consumer-side canonicalisation (`rec?.realSessionId ?? tabIdOrSessionId`)
and has **the identical null-before-init fallback**. Contract at
`agent-namespace.builder.ts:105-106`, applied `:138-141`. Producer/parser pair is
`sdk-query-options-builder.ts:1153-1184` (throws `SdkError` on blank routing id,
`:1164-1172`) and `mcp-http/http-server.handler.ts:141-149`.

## Hook handlers — all resolve, all publish the closure id on turn 1

Every handler in `agent-sdk/src/lib/helpers/` calls
`resolveHookSessionId(input.session_id, sessionId /* closure */)`:
`pre-tool-use:47`, `post-tool-use:77`, `stop:47`, `stop-failure:52`,
`session-start:43`, `session-end:43`, `tool-failure:43`,
`user-prompt-submit:43`, `user-prompt-expansion:43`, `subagent-stop:52`,
`subagent:217,367`, `compaction:177,301`, `teammate-lifecycle:137`.
`worktree-hook-handler.ts` uses `input.session_id` directly.

`hook-session-resolver.ts:28` `resolveFirstPresent` — payload first, closure
second, returns `null` never `''`. Confirmed intact.

Only two consumer libraries subscribe: `skill-trigger.service.ts` (`:121`,
`:124`, `:127`, `:132`, `:135`, `:139`) and `memory-trigger.service.ts` (`:138`,
`:141`, `:144`, `:149`, `:152`, `:155`, `:158`, `:163`, `:166`).

## Blast radius, in decision order

1. **In-memory + timers** — two live timers per session (`skill:203`, `skill:234`, `memory:239`) whose closures capture the arming id, cleaned up on a canonicalised SessionEnd. A `tab_N` entry is never reclaimed and fires against a bogus id.
2. **Durable SQLite** — `observation_queue.session_id`, `skill_synthesis_queue.session_id` with `UNIQUE(session_id, stage)`. Rows written under `tab_N` are not found by a UUID-keyed drain. **Open: what happens to rows already on disk under a `tab_N` key?**
3. **Derived filesystem lookups** — `${sessionsDir}/${sessionId}.jsonl`. Hard-fails on `tab_N`.
4. **Already solved** — the three remaps above.

## Open question the architect must still answer

`teammateIdle` (`sdk-adapter-events.service.ts:76`) currently has **no
subscriber**. Confirm that is intentional before treating it as a consumer.

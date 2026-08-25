# Item 3 — blank-session-id census

> Produced by a dedicated investigation sweep during architecture planning,
> 2026-08-19, at the working tree on top of `1363f486b`.
> Scope: `libs/backend/**`, `libs/frontend/**`, `libs/shared/**`.
> `libs/api`, `libs/web`, `libs/api-contracts`, `libs/showcase-manifest` excluded
> (different product, no session-id domain).
>
> Method: all 707 `?? ''` / `|| ''` occurrences under the scanned libs were
> enumerated and triaged, including multi-line forms; ~835 occurrences were
> skipped as unrelated and counted. Line numbers are accurate as of this commit —
> **re-check before editing.**

## Headline

| Metric                                  | Count                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| Distinct production files               | **79** (backend 49, frontend 30, `libs/shared` **0**) |
| Production hit sites                    | **138**                                               |
| Independent implementations of the rule | **5**                                                 |
| Return conventions                      | **3** (`undefined`, `null`, `boolean`)                |
| Trim policies                           | **4**                                                 |
| Spec files with hits                    | 10 (31 hits)                                          |

`libs/shared` — the only lib every other lib may import, and the owner of the
branded `SessionId` + `UUID_REGEX` (`branded.types.ts:50-82`) — contains **no
blankness primitive at all**.

## The five implementations, and how they disagree

| Impl                                           | Location                                                                                | Trim?                                | Returns     | `'   '` is… | Exported?                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ | ----------- | ----------- | --------------------------- |
| `blankToUndefined`                             | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-registry.utils.ts:41` | yes — **returns trimmed**            | `undefined` | absent      | lib-internal, not on barrel |
| `sessionIdOrNull`                              | `libs/backend/memory-curator/src/lib/memory.store.ts:140`                               | tests trimmed, **returns untrimmed** | `null`      | absent      | **module-private**          |
| `knownSessionId`                               | `libs/frontend/chat-streaming/src/lib/session-scope.ts:25`                              | **no** (bare truthiness)             | `undefined` | **present** | barrel `index.ts:49`        |
| `resolveFirstPresent` / `resolveHookSessionId` | `libs/backend/agent-sdk/src/lib/helpers/hook-session-resolver.ts:28`                    | **no** (`.length > 0`)               | `null`      | **present** | yes                         |
| inline                                         | `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:605`                     | yes                                  | `null`      | absent      | n/a                         |

**A whitespace-only session id is "absent" to three of these and "a valid id" to
two.** That is a latent behavioural fork, not a style inconsistency.

`agentVisibleInSession` (`session-scope.ts:60`) is a related but distinct
_predicate_ (boolean, two-axis scoping rule) — counted among the five only as a
sibling of `knownSessionId`.

## Census by form (production code, `*.spec.ts` excluded)

### F1 — `!x || x.trim().length === 0` — 4 hits, all `agent-sdk`

| File                                                                                   | Line |
| -------------------------------------------------------------------------------------- | ---- |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                                  | 647  |
| `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`                             | 406  |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`                  | 1164 |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts` | 157  |

### F1-variant — `!x || x.length === 0` (**no trim**) — 13 hits

`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` — 190, 225, 305, 347, 457
`libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts` — 36
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` — 225, 256, 282, 319, 344, 398, 452

### F2 — `x !== undefined && x.trim().length === 0` — 1 hit

`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:1030`.
`cleanupPendingPermissions(sessionId?)` — `undefined` deliberately means "all
sessions", `''` must not. **The only site where the tri-state distinction is
load-bearing and hand-rolled.** See §0 do-not-delete in the implementation plan.

### F3 — bare `x.trim().length === 0` — 2 hits

`libs/backend/memory-curator/src/lib/observation-queue.store.ts:130`
`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:424`

### F3-variant — bare `x.length === 0` / `x.length > 0` — 6 hits

`libs/backend/memory-curator/src/lib/memory-curator.service.ts:242`
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:335`
`libs/backend/agent-sdk/src/lib/session-importer.service.ts:240`
`libs/backend/agent-sdk/src/lib/helpers/hook-session-resolver.ts:32`, `:35`
`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:605`

### F4 — bare `x === ''` — 2 hits

`libs/backend/vscode-core/src/services/subagent-registry.service.ts:463`
`libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:143`

Both are "an empty filter must not mean all sessions" guards, written
independently, both logging a warn. Both on the §0 do-not-delete list.

### F5 — bare `!x` as a blank-session-id guard — **97 hits across 46 files**

Backend 39 · Frontend 58.

Backend by lib: `agent-sdk` 22 (incl. all 12 hook handlers' `if
(!resolvedSessionId)` rejection, which is the _correct_ published pattern),
`cli-agent-runtime` 10, `vscode-core` 6, `memory-curator` 1.

Frontend by lib: `chat` 34, `chat-streaming` 14, `tribunal-panel` 8,
`chat-routing` 3, `harness-builder` 3, `chat-state` 1, `skill-synthesis-ui` 1,
`memory-curator-ui` 1.

**This form is 70% of all hits and is explicitly OUT OF SCOPE for any sweep.** On
a `string | undefined`, `if (!sessionId) return;` is already correct and
idiomatic. It is listed for completeness and to record where the rule is most
_invisible_ — nothing at those sites states "blank means absent", which is how a
new `?? ''` gets added upstream without anyone noticing.

### F6 — `x ? x : undefined` / `x || undefined` — 6 hits

`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.ts:317`
`libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:321`
`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:101`, `:131`
`libs/frontend/chat-routing/src/lib/stream-router.service.ts:171`
`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:465`

Plus one inline `||` with the same semantics:
`libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:132-133` — the comment
at `:124-127` explicitly says "`||` not `??`" because the caller can hand `''`.

### F7 — `blankToUndefined` — 1 definition + 4 call sites (all `cli-agent-runtime`)

Def `ptah-cli-registry.utils.ts:41`; imports `ptah-cli-registry.ts:58`,
`ptah-cli-spawn-options.service.ts:44`; calls `ptah-cli-registry.ts:653`, `:654`,
`ptah-cli-spawn-options.service.ts:178`, `:179`.
**Zero spec coverage. Zero cross-lib use.**

### F8 — `sessionIdOrNull` — 1 definition + 1 call site (all `memory-curator`)

Def `memory.store.ts:140`; call `memory.store.ts:188`.
**Module-private. Zero spec coverage.**

## Acceptance-criterion surface — every production `?? ''` / `|| ''` on a session-id field

| #   | File                                                                                        | Line | Expression                                                                                   |
| --- | ------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| 1   | `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`                                  | 190  | `sessionId: ev.sessionId ?? ''`                                                              |
| 2   | `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.ts`                      | 46   | `sessionId: ev.sessionId ?? ''`                                                              |
| 3   | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts` | 205  | `ownSessionId ?? ''`                                                                         |
| 4   | `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`                             | 604  | `measurement.holdoutSessionId?.trim() ?? ''`                                                 |
| 5   | `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts`                           | 182  | `[tribunalSessionId]="tribunalSessionId() ?? ''"`                                            |
| 6   | `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts`                | 192  | `agent.parentSessionId ?? ''` — **EXCLUDED**, memo-key serialization, not a field assignment |

**1 spec hit** (fixture, adapt rather than delete):
`libs/backend/rpc-handlers/src/lib/harness/streaming/harness-stream-broadcaster.service.spec.ts:57`.

Notes:

- **#1 and #2 are the same expression duplicated across two libs** — the same
  `MEMORY_EXTRACTED` broadcast wired twice (`thoth-runtime` and `cli-engine`).
- **#3 is vestigial.** `CompactionHookHandler.createHooks` is already
  `(sessionId: string | undefined, …)` (`compaction-hook-handler.ts:126-128`).
  The in-place comment at `ptah-cli-spawn-options.service.ts:196-203` still claims
  `''` is the expected absent marker — **that comment is now false.**
- **#4 immediately re-collapses at `:605`** — an inline reimplementation of
  `sessionIdOrNull` two lines later.

## Latent: 9 `?? undefined` no-ops

`??` does not collapse `''`, so these silently fail to normalize blank input —
latent instances of the exact bug the helpers exist to prevent. **Not in scope for
TASK_2026_296; recorded as follow-up.**

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:665`
`libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts:37`
`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:733`
`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:115`, `:134`, `:244`, `:266`
`libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:502`

## Per-lib production file counts

| Lib                           | Files  |
| ----------------------------- | ------ |
| `backend/agent-sdk`           | 23     |
| `backend/cli-agent-runtime`   | 10     |
| `backend/memory-curator`      | 5      |
| `backend/skill-synthesis`     | 4      |
| `backend/vscode-core`         | 2      |
| `backend/rpc-handlers`        | 2      |
| `backend/vscode-lm-tools`     | 1      |
| `backend/thoth-runtime`       | 1      |
| `backend/cli-engine`          | 1      |
| **backend**                   | **49** |
| `frontend/chat`               | 12     |
| `frontend/chat-streaming`     | 8      |
| `frontend/tribunal-panel`     | 5      |
| `frontend/chat-routing`       | 1      |
| `frontend/chat-state`         | 1      |
| `frontend/harness-builder`    | 1      |
| `frontend/skill-synthesis-ui` | 1      |
| `frontend/memory-curator-ui`  | 1      |
| **frontend**                  | **30** |
| `shared`                      | **0**  |
| **TOTAL**                     | **79** |

## Spec-file hits (10 files, 31 hits) — adapt, never delete

`agent-sdk/.../hook-session-resolver.spec.ts` (8) ·
`chat-streaming/.../session-scope.spec.ts` (12) ·
`agent-sdk/.../sdk-query-options-builder.spec.ts` (2) ·
`agent-sdk/.../compaction-hook-handler.spec.ts` (1) ·
`agent-sdk/.../subagent-hook-handler.spec.ts` (1) ·
`agent-sdk/.../sdk-message-transformer.spec.ts` (2) ·
`rpc-handlers/.../harness-stream-broadcaster.service.spec.ts` (1) ·
`chat-streaming/.../agent-monitor.store.spec.ts` (1) ·
`chat/.../background-agent-tray.scope.spec.ts` (2) ·
`chat/.../agent-monitor-panel.scope.spec.ts` (1)

`blankToUndefined` and `sessionIdOrNull` have **zero** spec coverage anywhere.

## Skipped as unrelated (~835 occurrences, counted for auditability)

~48 `trim().length === 0` on non-session strings (`query`, `title`, `apiKey`,
`botToken`, `content`, …) · ~78 `=== ''` / `!== ''` on non-session values
(`workspaceRoot`, `cwd`, `filePath`, `stage`, …) · ~700 `?? ''` / `|| ''` on
non-session fields (`toolCallId`, `agentId`, `model`, `stdout`, …) · ~8
`.length === 0` on **arrays** named session-ish (`sessionIds`, `tabIds`) — genuine
collection-emptiness · 1 validity-not-blankness guard
(`memory-curator-ui/.../corpus-list.component.ts:413`,
`!SessionId.validate(rawSessionId)`).

## Documentation defect found along the way

`libs/backend/agent-sdk/CLAUDE.md:77` ("Hook session identity") still states that
`SdkQueryOptionsBuilder.createHooks` captures `sessionId ?? ''`. It does not —
`sdk-query-options-builder.ts:1226-1232` is `createHooks(cwd: string, sessionId?:
string, …)`. **The doc is stale and must be corrected**; it is the doc a developer
would read before touching item 6.

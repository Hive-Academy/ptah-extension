# Code Logic Review r1 — D9 12a+12b

Score: 8/10 — Verdict: APPROVED (0 blocking, 0 serious, 4 moderate). Static read only; nothing executed.

## Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| B1 CodexContext widened | FIXED | `codex-runtime.types.ts` diff only adds `CodexHistoryReader` (separate interface, ~l.293) and history types; `CodexRuntime`/`CodexContext` members untouched. `codex-context.ts` is not in the diff. `CodexRuntime implements RuntimePort, CodexHistoryReader` (`codex-runtime.ts:50`). |
| S1 used thread/resume | FIXED | `codex-runtime.ts:58-89`: new `CodexAppServerProcess` per call with the caller's `profile` (CODEX_HOME), `this.options.executable`/`binary` (same verified binary as `open`); `verifiedCodexHome !== profile.normalizedHome` -> `CodexHomeMismatchError`; `finally { await process.close() }` covers success, start failure and mid-read failure. Only `thread/read`, `thread/list`, `thread/turns/list`, `thread/items/list` are issued (`codex-session-history.ts:9`, type-restricted by `HistoryMethod`). No open/resume/start/persist/markInactive. Home mismatch between profile and identity is refused before spawn (`:62`). Server-initiated requests are rejected via `onRequest` throw. |
| S2 item pages silently dropped | FIXED | `codex-session-history.ts:147-174`: full/legacy-with-items turns kept as-is; partial turns paged, duplicate turn ids, cross-turn entries, duplicate item ids, and any embedded item missing/different in pages -> `malformedPage`. Paging bounded. |
| S3 threadNotFound mislabel | FIXED (see M1) | `codex-app-server-process.ts:461` flag only for `thread/read` and anchored `^thread( ...)? not found.?$`; `from()` maps all other rejections to `requestRejected` and keeps the cause (`:41-46`). Too-strict direction is safe (falls to `requestRejected`). The RPC code is not consulted, but the pinned schema defines none, so message-only is acceptable; live match remains UNCONFIRMED (as the lane states). |
| Moderate (child scope, cursor loops, cap) | FIXED | Children = transitive closure from root via `parentThreadId` (`:109-121`), terminates since `selected` only grows; a disconnected cycle or another session's threads are never reachable from root. `MAX_PAGES=100` -> `pageLimitExceeded`; blank/repeated cursor -> `stalledCursor` (`:77-94`). |

## Five logic questions (short)

1. Silent failure: none found. Every mismatch throws a typed error with a fixed message and an attached cause.
2. User action: opening history while the chat context is live is supported (separate process). A thread not yet flushed to the rollout by the live process may read as not found or incomplete; UNCONFIRMED against the real binary.
3. Wrong answer: `JSON.stringify` equality (`:170`) is key-order sensitive (M2).
4. Dependency failure: start failure, request timeout (process `fail`), and bad result shape each map to `processFailure` or `malformedPage`; the process is always closed.
5. Missing: no consumer yet obtains the concrete `CodexRuntime`. Composition roots expose the port, so integration needs a typed handle (see Implementers).

## Moderate issues

- M1 `codex-session-history.ts:41-46`: `from()` cannot tell a missing child thread from a missing root. A child `thread/read` that is not found reports `threadNotFound` for the whole history. Prefer `malformedPage`/a distinct code for children.
- M2 `:170`: embedded-vs-paged conflict check compares serialized JSON. Both sides pass the same Zod parse so order is normally stable, but a server that orders keys differently across endpoints would cause false `malformedPage`. Use a deep-equal.
- M3 `codex-runtime.ts:58-89`: runtime `close()` does not track or abort in-flight history processes. A read after close spawns a process before `assertOpen` first runs (`:96` first `call`), and an in-flight read only stops at its next request. Bounded by the 30 s style request timeout and by `finally`, but add an early closed check and a tracked set.
- M4 `:112-121`: closure loop is O(candidates x depth); with the 100-page cap on both archived states this can reach 20k candidates. Build a parent->children map instead. Also full corpus listing per read is costly (lane acknowledges).

## Implementers

`CodexRuntime` (port) and `CodexContext` gained no members, so no implementer or fake fails to compile. Files that mention them (spec fakes in `rpc-handlers`, `cli-engine`, `cli-agent-runtime`, `agent-sdk`, `apps/ptah-electron/src/di`, `apps/ptah-extension-vscode/src/di`, `scripts/codex-start-probe.ts`) need no change. Only the concrete `CodexRuntime` has `readHistory`; no other class implements `CodexHistoryReader`, and none is required to.

## Data flow

root `thread/read` (OK, id checked) -> list archived+unarchived (OK, bounded) -> closure from root (OK) -> per thread: metadata read, turns (paginated or `includeTurns`) (OK) -> per partial turn item pages and merge (OK) -> snapshot. Gap: M1, M2 only.

## Verdict

APPROVE. Confidence MEDIUM: the code is not executed here and the live pinned not-found message/shape is unconfirmed. Top risk: M1 (misattributed `threadNotFound` for a missing child). Add a live-binary capture before shipping.

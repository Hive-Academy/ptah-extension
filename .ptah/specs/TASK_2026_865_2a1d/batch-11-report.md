# Batch 11 report — TASK_2026_865_2a1d, Task 11.1

Status: DONE (Task 11.1). Executor: backend-developer subagent. No git command was run; the
tree is uncommitted. `decisions.md` and `code-logic-fix5-review.md` were already modified or
untracked before this batch started. I did not change them.

## Files changed

Paths are relative to the worktree
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.

- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts`
  - Adds `CARRY_OVER_NATIVE_MAX_TURNS = 200`, `CARRY_OVER_NATIVE_MAX_TURN_PAGES = 8` and
    `CARRY_OVER_NATIVE_MAX_ITEM_PAGES = 16` (plan :320-323).
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`
  - `CLAUDE_JSONL_SOURCE` is replaced by `type CarryOverSource = 'claude-jsonl' | 'codex-native'`
    and a module constant `NATIVE_BOUND` (`{ maxTurns, maxTurnPages, maxItemPages }`). The
    constant is built from the three constants and matches `CodexHistoryTailBound`
    (`codex-runtime.types.ts:360-367`).
  - `EligibleCarryOver` gains `source`.
  - `evaluate`, identity step:
    - `claude-sdk`: a session with `providerId === 'openai-codex'` stays refused (proxy era,
      E2). Any other Claude session gets `source = 'claude-jsonl'`.
    - `codex-app-server`: only `providerId === 'openai-codex'` is eligible, with
      `source = 'codex-native'`. Any other native `providerId` returns `null` at this step,
      before the provider comparison, the probe and the router.
    - The remaining order stays as in K22: the provider comparison runs first, so native
      Codex on an active Codex gets no probe, and the readiness probe runs after it.
  - `runCarryOver`: the router call now passes
    `{ tailBytes, nativeBound: NATIVE_BOUND, signal }`. The router picks the route from the
    session's metadata, so both bounds go along every time.
  - Success log: `source` is the eligible source (`'claude-jsonl'` or `'codex-native'`).
  - Unchanged: tickets, tags, the `IN_FLIGHT` refusal and `blockUntil` (58499669f, 364ca0c53,
    99f6a8150). The open-folder authorization before the proxy shortcut and the
    `newSessionReady` probe are unchanged too, and so is the start-failure mapping. The diff
    has no line in those areas. The `chat:continue` AUTH_REQUIRED contract is not touched.
  - The service makes no native adapter call. The only call on the old session is the router
    read (no resume, compact or turn).
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`
  - New helper `nativeMetadata(providerId = 'openai-codex')`.
  - The Batch 4 case "a native codex-app-server session, before any router call (T2)" is
    replaced by:
    - `check`: "native Codex -> Claude (D9), with no read before the click" is eligible
      (AC 1.1, D9);
    - `check` and `carryOver`: "a native Codex session with Codex still active, with no probe"
      makes no `prepare`, no `isAuthenticated`, no read and no start (AC 2.5, K22);
    - `check` and `carryOver`: "a native identity whose providerId is not openai-codex" calls
      the router 0 times and makes no probe and no start (T2);
    - `carryOver`: the AC 3.10 case is now an `it.each` over a Claude JSONL session and a
      native Codex session. It asserts `tailBytes`, `nativeBound` equal to the three
      constants, the `AbortSignal`, and exactly those three option keys;
    - `carryOver`: "carries a native Codex session over to Claude, with no native adapter
      call" checks success, one NEW-session probe (identity `undefined`),
      `resumeSession` and `continueSession` at 0, no metadata writes, one start pinned to
      `anthropic`, and the info log with `source: 'codex-native'` (AC 1.1, 6.1);
    - `carryOver`: an empty native history and an unreadable native history
      (a `SessionHistoryRouteError` whose message holds a sentinel) each give
      `HISTORY_UNREADABLE`, no start and no resume, and the sentinel stays out of the
      result and the logs (AC 5.1).
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts`
  - A case pins the three native constants (200 / 8 / 16).

## Test results

- `node scripts/verify.mjs --exec --task b11-jest -- npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over`
  gave `Test Suites: 2 passed, 2 total`, `Tests: 81 passed, 81 total`.
- The rpc-handlers ts-jest transform runs with diagnostics on (no `isolatedModules`), so the
  pass also type-checks both specs and the service and transcript modules they import.
- The native cases alone (`-t native`): 7 passed, 47 skipped.

## Diagnostics and eslint

- `ptah_get_diagnostics` with the 4 changed files: unavailable twice ("TypeScript check still
  running after 45s"). The ts-jest type check above covers these files.
- `node scripts/verify.mjs --exec --task b11-eslint -- npx eslint <the 4 files>` printed no
  findings, exit 0.
- `npm run verify`, nx run-many, build, serve, e2e and package were not run, per row 51 (heavy
  verify runs in CI).

## P4 probe time

These are per-test durations from jest `--json`, in the spec harness with fakes. They do not
measure real latency. They show only that the code adds no wait of its own.

| Case | Duration |
| --- | --- |
| `check`: native Codex -> Claude (eligible, one probe) | 12 ms |
| `check`: native Codex on active Codex (no probe) | 9 ms |
| `check`: native non-Codex `providerId` (no router call) | 4 ms |
| `carryOver`: native read receives both bounds | 5 ms |
| `carryOver`: native -> Claude success | 6 ms |
| `carryOver`: native empty / unreadable history | 3 ms / 2 ms |

## Router `nativeBound` decision

`nativeBound` stays optional. The router is unchanged. On its own,
`readonly nativeBound?:` -> `readonly nativeBound:` at
`libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:37` is one line, but
it does not stand alone:

- The router spec calls `readCarryOverTranscript(sessionId, workspacePath, { tailBytes: 1024 })`
  without a bound at `session-history-router.spec.ts:314` and `:448`. A required field fails
  ts-jest type-checking there.
- The guard `if (!options.nativeBound) throw ...('nativePortUnavailable')` at router `:110`
  and its spec case become dead code under a required type.

The change therefore needs more than one line, across the router and its spec, so per the brief
I left it. A follow-up can make it required, update the two spec calls, and drop or keep the
guard as defense-in-depth. The rpc-handlers caller now always passes the bound, so the native
route is reached in production.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Pass `nativeBound` on every router call, not only on a native source | always / only when `source === 'codex-native'` | Plan: "The router call passes `nativeBound`". The router picks the route from metadata (`session-history-router.ts:107-111`), so a bound on every call keeps either route bounded and needs no branch in the caller. | yes |
| Non-Codex native `providerId` is refused at the identity step | identity step / after the provider comparison | Brief: "any other native providerId stays not eligible with no router call". Refusing at the identity step also skips the probe, the cheapest-first order (K22). | yes |
| Native constants live in `chat-carry-over-transcript.ts` beside `CARRY_OVER_READ_TAIL_BYTES` | transcript module / service | Plan :315-323 lists them with the other constants. The service builds the bound object from them. | yes |
| Router `nativeBound` stays optional | make required / leave | More than one line (router spec :314, :448; guard :110). Brief: leave it and report. | yes |
| Do not add a timing assertion for P4 | assert a ms ceiling / record jest durations | A wall-clock assertion would be flaky under the machine lock. P4 asks only for a record. | yes |

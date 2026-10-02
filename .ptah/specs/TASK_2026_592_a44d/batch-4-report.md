# Backend implementation — `TASK_2026_592_a44d`, batch 4

**Tasks completed**: 4.1 (pin the overwrite question), 4.2 (single guard; the overwrite was proven)

**Verdict on the overwrite question**: an idle `chat:abort` DOES overwrite a non-empty durable
`resumableSdkSubagents` list with `[]` in case (b). This is a path the new tab-close behaviour reaches.
Task 4.2 fixes it with one guard in `abortSession`. No contract change.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\backend\rpc-handlers\src\lib\chat\session\chat-session-abort-resume-state.spec.ts`
  — 6 cases using the REAL `SubagentRegistryService` and the REAL `SessionMetadataStore` (over
  `createMockStateStorage`). Only the SDK adapter and `ptahCli` are faked. The fake adapter models
  `SessionControl.endSession` → `endRecord`: for a live record it runs `markAllInterrupted` and then fires the
  session-end callback (the second writer). Without a record it is a no-op (`'already-ended'`).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
  — `abortSession` reads `this.sdkAdapter.isSessionActive(sessionId)` before `interruptSession`. It calls
  `saveResumeState` only when a live record existed. The RPC return value (`resumableSubagents` from the
  registry) is unchanged.

## Evidence per case (Task 4.1)

The spec was run against the UNCHANGED source first:
`npx jest -c libs/backend/rpc-handlers/jest.config.ts …/chat-session-abort-resume-state.spec.ts --maxWorkers=2`
gave `Tests: 2 failed, 4 passed, 6 total`. Both failures showed the durable list `Expected [record]`,
`Received []`.

| Case | Before fix | After fix |
| ---- | ---------- | --------- |
| (a) live abort with a running subagent: `markAllInterrupted` marks it interrupted and the list is persisted. A second (idle) abort follows. | Pass. The registry still holds the interrupted record this run, so the second write is the same list. | Pass. The second abort has no live record and skips the write, so the list is kept. |
| (b) restart: durable list present, registry empty, no `chat:resume` yet | **FAIL: overwritten with `[]`** | Pass. The list is kept and a later `restoreResumableBySession` restores 1 record. |
| (b) after `chat:resume` restored the list, then an idle abort | Pass (same list written back) | Pass (no write; list unchanged) |
| (c) durable record past the 24 h TTL, idle abort | Wiped (FAIL on the "left in place" assertion). This was harmless: `restoreResumableBySession` already refuses expired records (returns 0). | Left in place, still never restored. No user-visible difference. |
| (c) live abort whose interrupted subagent is past the TTL | Both writers (the session-end subscriber, then `abortSession`) write `[]`, because `getResumable` filters expired records | Same. The live path is unchanged. |
| Live abort when nothing is resumable any more (stale durable list) | Cleared to `[]` | Still cleared. The guard keeps the legitimate stale-clear path. |

How case (b) is reachable from the new close behaviour: after a reload, `SessionLoaderService` calls `chat:resume`
only ONCE, for the initially active restored tab (`restoredSessionChecked` guard,
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:199-216`). Restoring the registry from
the durable list happens only inside `chat:resume`
(`chat-session.service.ts`, `restoreResumableBySession(sessionId, metadata?.resumableSdkSubagents ?? [])`). Take a
background tab restored from localStorage with a `claudeSessionId` that is closed before it is opened or sent to.
Its close sends `chat:abort`. `SessionControl.endSession` finds no record and returns `'already-ended'`, so the
session-end event does not fire. Before the fix, `abortSession` then wrote the empty registry snapshot over the
durable list. A later reopen from the sidebar would have lost the "resume interrupted agents" offer.

## Why one guard is enough (both writers)

- The session-end subscriber (`subscribeToSessionEnd`) fires only from `SessionControl.endRecord`, which requires
  a live record. It never runs on the no-record path, so the overwrite in (b) came from `abortSession` alone.
- When there was no live record, the abort changed no subagent state (`markAllInterrupted` did not run). Records
  written by an earlier abort or restored from the durable list are not lost by skipping the write.
- **Correction (review, PR #628):** this does not hold for every record. `retireInterruptedRecord`
  (`session-control.service.ts:123-148`, turn-interrupt timeout of a stop-intent `chat:continue`) marks subagents
  interrupted without a session-end notification, so those registry entries have no durable write. A later idle
  abort now skips `saveResumeState`, and the resume offer for them can be lost after a restart. This is accepted
  as a known limitation of this task (narrow path, no spec) and recorded as a follow-up in `batches.md`
  ("`retireInterruptedRecord` path"); it is not persisted or tested here.
- `isSessionActive` is `sessionLifecycle.find(id) !== undefined` (`sdk-agent-adapter.ts:1061-1063`). That is the
  same `registry.find` lookup that `SessionControl.endSession` uses (`session-control.service.ts:160-171`).
- The readers were traced. `restoreResumableBySession` is the only consumer of the durable list. Both
  `chat-history-read.service.ts:116` and `chat-subagent-context-injector.service.ts` read the in-memory
  registry, and the registry is fed from the durable list only via `chat:resume`. The stored format is unchanged.

## Stack observed

- NestJS-free tsyringe DI: `@injectable()` with `@inject(TOKENS…)` constructor injection (`chat-session.service.ts:121-188`).
- Specs: direct construction with positional stubs, following `chat-session-mcp-status.spec.ts`. They use the
  `@ptah-extension/workspace-intelligence` jest mock, and real-store construction follows
  `session-metadata-store.spec.ts:104-107`.
- `IAgentAdapter.isSessionActive` is declared at `libs/shared/src/lib/types/agent-adapter.types.ts:252`.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core`:
  `Successfully ran targets typecheck, lint for 2 projects` (4/4 tasks).
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core -- --maxWorkers=2`.
  - First attempt: `NX Failed to process project graph`, an environment problem (no tests ran). Retried with `--verbose`.
  - vscode-core: `Test Suites: 41 passed, 41 total; Tests: 723 passed`.
  - rpc-handlers: `Test Suites: 2 failed, 113 passed, 115 total; Tests: 2 failed, 4 skipped, 3395 passed`.
    Neither failure is in a file this batch touched.
    - `voice-rpc.handlers.spec.ts` › "leaves no input temp file behind…": `Exceeded timeout of 5000 ms` under
      load. It **passes in isolation** (rerun below).
    - `harness-skill-selection-rpc.service.spec.ts` › "never writes state.json": fails deterministically on this
      machine because of a stray `C:\Users\abdal\AppData\Local\Temp\.ptah` directory. The spec's temp workspace
      sits under `Temp`, `resolveHarnessWorkspaceRoot` walks up and finds that `.ptah` marker, and the assertion
      `existsSync(statePath) === false` fails before the service under test runs. This is environment pollution,
      unrelated to the chat code. I left the directory alone because it isn't mine.
- Isolated rerun: `npx jest -c libs/backend/rpc-handlers/jest.config.ts chat-session-abort-resume-state voice-rpc.handlers harness-skill-selection-rpc chat-session-resume-activate chat-continue-slash-before-resume --maxWorkers=2`
  gave `Test Suites: 1 failed, 4 passed, 5 total; Tests: 1 failed, 98 passed, 99 total`. The only failure is the
  harness test explained above. The new spec, `chat-session-resume-activate` (which includes the session-end
  subscriber `saveResumeState` test) and `chat-continue-slash-before-resume` all pass.

## Risks from the plan validation

| Risk | Handling |
| ---- | -------- |
| `saveResumeState([])` overwrites a durable non-empty list on idle close (MEDIUM, unknown) | Proven for case (b) and fixed with one guard. All six cases are pinned by the new spec. |
| Double `chat:abort` on a streaming close overwriting the first abort's resume state (HIGH, mitigated mainly in Batches 1-2) | Backend defence in depth. Case (a) shows a second, idle abort keeps the list. After the fix it does not write at all. |
| `chat:abort` racing `session:delete` (LOW) | Unchanged. An idle abort now skips `saveResumeState`, so the "missing session" warning no longer appears on that path. A live-record abort behaves as before. |

## Plan deviations

None. Task 4.2 is one guard covering the only writer that runs on the no-record path. There is no contract
change, so nothing needed escalating as a blocker.

## Out-of-scope observations

- Pre-existing, not reached only by tab close: after a restart, `chat:continue` on a restored tab that never ran
  `chat:resume` starts a live record without restoring the durable list. When that record ends (abort, close,
  quit/dispose), both writers persist the empty registry snapshot and drop the durable list. The guard does not
  cover this because a live record existed. A fix would restore the durable list on the continue/auto-resume
  path. It is recorded here for the architect.
- The stray `C:\Users\abdal\AppData\Local\Temp\.ptah` directory breaks
  `harness-skill-selection-rpc.service.spec.ts` on this machine. That spec also relies on no `.ptah` existing above
  `tmpdir()`, which is fragile.
- I created a test log (`C:\Users\abdal\AppData\Local\Temp\claude\b4-test.log`, `b4-iso.log`) outside the repo.
- The runtime check of whether claude.exe exits on abort remains with Mode 3 ("Completion evidence").

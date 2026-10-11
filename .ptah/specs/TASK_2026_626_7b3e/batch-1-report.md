# Batch 1 report — TASK_2026_626_7b3e (Shared contract)

Executor: backend-developer (sub-agent). No git operations performed.

## Tasks

### Task 1.1 — Message type, snapshot flag, live payload types — DONE

- `MESSAGE_TYPES.SESSION_STATS_LIVE: 'session:stats-live'` added directly after `SESSION_STATS`,
  with a doc comment: provisional, throttled, replaced by the next higher-revision `session:stats`,
  never a completion signal (no turn end, no queued-send release, no footer update).
- `SessionStatsEntry.provisional?: boolean` added (after `revision`) with the plan's doc text.
- `SessionStatsLivePayload` and `LiveStatsCallback` added beside `ResultStatsPayload` /
  `ResultStatsCallback`, shape exactly as plan `:263-282`.
- `IAgentAdapter.setLiveStatsCallback` NOT added (deferred to Batch 4 per Execution defaults).

### Task 1.2 — Live payload parser — DONE

- New `parseSessionStatsLivePayload(payload: unknown): SessionStatsLiveWire | null`, hand-written
  (no Zod), modelled on `parseSessionMcpStatusPayload`. Exported types `SessionStatsLiveWire`
  (`sessionId: string`, `sessionStats: SessionStatsEntry`, `context?`) and `SessionStatsLiveContext`.
- Rejects (returns `null`): non-object/array/null payload; empty or non-string `sessionId`;
  `sessionStats` that is null, an array or not an object; `provisional` present with any value other
  than `true` (`false`, `'yes'`, `null`); `revision` missing or not a finite number.
- `context` kept only when valid (non-empty string `model`, finite non-negative `contextTokens`)
  AND `sessionStats.provisional === true`; otherwise the result has no `context` key and the
  payload is kept.
- Exported via `export * from './session-stats-live'` in `messages/index.ts`.

### Task 1.3 — Parser spec — DONE

36 tests across the two suites run (parser spec covers): message type value; accepts provisional+context,
absent `provisional`, provisional without context (no `context` key), `contextTokens: 0`; rejects
`provisional` false/'yes'/null, missing/NaN/Infinity/string revision, empty/non-string/missing
`sessionId`, null/array/string `sessionStats`, null/undefined/string/number/array payload; drops
only the context for non-object context, empty/non-string model, negative/NaN/Infinity/missing
`contextTokens`; drops a valid context on a non-provisional snapshot while keeping the payload
(same `sessionStats` reference).

## Files

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/messages/message-constants.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/rpc/rpc-session.types.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/agent-adapter.types.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/messages/index.ts
- CREATED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/messages/session-stats-live.ts
- CREATED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/shared/src/lib/types/messages/session-stats-live.spec.ts

## Risks and edge cases carried by this batch

- Risk row 1 (late live estimate overwriting final context): the parser strips `context` from any
  snapshot whose `provisional` is not `true`, so an authoritative live snapshot can never carry a
  context to the webview. Pinned by the "valid context on a non-provisional snapshot" spec.
- Revision floor bypass: a live payload without a finite `revision` is rejected outright.
- Adding a required `IAgentAdapter` member mid-run (MEDIUM): not added here; agent-sdk is untouched.
- Malformed payload edge case: parser returns `null` without logging; the single `console.warn`
  naming only the session belongs to the caller (Task 7.1).
- Host-source registry baseline (decisions D8): `host-source-registry.baseline.ts` untouched and
  `host-source-registry.contract.spec.ts` passes unchanged.
- Deep snapshot validation is intentionally not done here (stays in chat-state
  `isValidSessionStatsSnapshot`, Batch 6); the parser only checks the envelope.

## Verification (run one at a time)

1. `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
   ```
   Test Suites: 2 passed, 2 total
   Tests:       36 passed, 36 total
   ```
2. `npx nx typecheck @ptah-extension/shared --parallel=1` (re-run with `--skip-nx-cache` because Nx
   Cloud printed a 401 banner that hid the result)
   ```
   NX  Successfully ran target typecheck for project @ptah-extension/shared
   ```
3. `npx nx lint @ptah-extension/shared --parallel=1`
   ```
   ✖ 5 problems (0 errors, 5 warnings)
   NX  Successfully ran target lint for project @ptah-extension/shared
   ```
   The 5 warnings are pre-existing in other files (max-lines on 874/3550-line files,
   preserve-caught-error, unused `error`). `npx eslint` on the six Batch 1 files alone reported
   nothing (exit 0).
4. `git diff --name-only` (read-only) lists only `agent-adapter.types.ts`, `messages/index.ts`,
   `message-constants.ts`, `rpc-session.types.ts`; `host-source-registry.baseline.ts` not listed.
   New files are untracked: `session-stats-live.ts`, `session-stats-live.spec.ts`.

## Plan deviations

None beyond the batch-recorded one (`setLiveStatsCallback` deferred to Batch 4). The plan's
"`context` cannot replace the context ... (revision 3, finding 1)" doc phrase was kept minus the
review-round reference.

## Out-of-scope observations

- Nx Cloud returns 401 (organization disabled on the free plan); cached Nx runs print the banner
  in place of the target result, so use `--skip-nx-cache` or grep for "Successfully ran target".

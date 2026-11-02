# Batch 10c report: exit-path rate-limit capture

Executor: backend-developer subagent. No git writes. `batches.md` and `task.md` were not edited.

## Tasks

### 10c.0 Confirm the single turn-restart site: COMPLETE

- `grep -rn "hasExited = false" libs/backend/cli-agent-runtime/src/lib` returns one hit:
  `cli-agents/agent-process-manager.service.ts:2206` (`continueConversation`). The other
  `hasExited: false` is the spawn literal (`:1124`), where `turnSegmentStart: 0` is now set.
  The restore path (`:1535`) builds records with `hasExited: true` and no live turn; they read
  `turnSegmentStart ?? 0`. No other restart site exists.

### 10c.1 `rateLimitMatched` + `turnSegmentStart`, exit capture, stream-loop marker: COMPLETE

- `tracked-agent.ts`: two in-memory optional fields, `rateLimitMatched?: boolean` and
  `turnSegmentStart?: number`. Neither is persisted.
- `agent-process-manager.service.ts`:
  - spawn record gets `turnSegmentStart: 0`.
  - `continueConversation`, next to `hasExited = false`, sets
    `turnSegmentStart = accumulatedSegments.length` and clears `rateLimitMatched`, so a stop or
    timeout in the new turn does not carry the earlier turn's flag.
  - `handleExit`, inside the `status === 'running'` branch, sets
    `tracked.rateLimitMatched = this.matchLaneRateLimit(tracked, code)` after the auth match and
    before `recordLaneLimits`, `signalLaneCompletion` and `outputBuffer.discard`.
  - `matchLaneRateLimit`: exit 0 reads only the current turn's `error` segments
    (`turnErrorTexts`: segments since `turnSegmentStart`, newest 8, each cut to 4 KiB); a non-zero
    exit reads those plus the 16 KiB stdout tail. It uses the B10a `matchesApiRateLimit`. A match
    logs `debug('[AgentProcessManager] Lane turn matched an API rate-limit wording',
{ agentId, cli, exitCode })`. No text is logged.
  - `signalLaneCompletion` adds `rateLimited: true` to the context only when matched (see
    Decisions); the notifier already defaults it with `?? false` (B10b).
  - A rate limit never sets `failureKind` and never reaches `recordLaneLimits`: the quota
    `limit` is computed by `classifyLaneFailure` as before and is untouched.
- `ptah-cli-stream-loop.service.ts`: in the success-result branch, when `msg.is_error` and
  `isApiRateLimitResult(msg)` (`api_error_status === 429`, or `matchesApiRateLimit` over
  `result.slice(0, 4096)`), one segment `{ type: 'error', content: PTAH_API_RATE_LIMIT_SEGMENT }`
  is emitted. The exit code stays 0 and `reportTurnSuccess` stays skipped. The classifier is
  imported by relative path inside the same project (no new Nx edge). `result` is checked with
  `typeof` before slicing because existing fixtures omit it.

### Specs

- `agent-process-manager.service.spec.ts`, new `describe('lane completion signal: API rate limit')`:
  1. exit 0 with the marker as a current-turn error segment → context `rateLimited: true`,
     status `completed`, `failureKind` undefined, no owner/window ledger write, debug log args
     exactly `{ agentId, cli: 'codex', exitCode: 0 }`;
  2. exit 0 with "API Error: Request rejected (429)" in an error segment → `true`;
  3. exit 0 with "API Error: 429" only in stdout → no `rateLimited`;
  4. failed exit with a 429 rate wording in the tail → `true`, `failureKind` undefined;
  5. flag set before discard: a `discard` spy records the signal context at discard time and it
     already has `rateLimited: true`;
  6. 429 in turn 1, clean continuation turn 2 → turn 2 context has no `rateLimited`;
  7. clean turn 1, 429 in continuation turn 2 → turn 2 `rateLimited: true`.
- `ptah-cli-stream-loop.service.spec.ts`, new `describe('PtahCliStreamLoop API rate-limit marker')`:
  `is_error` + status 429 → exactly one marker error segment, exit 0, provider text absent from
  every segment; `is_error` + 429 wording → same; `is_error` + 500 → no marker; clean success
  that mentions a 429 → no marker.

## Files touched

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/tracked-agent.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts
- CREATED D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-10c-report.md (this report)

## Verification

`npm run verify -- -p @ptah-extension/cli-agent-runtime 2>&1 | tail -40`:

```
NX  3 tasks: 3 succeeded
Cache:             0/3 hit (0%)
[verify 2026-10-30T21:09:59.807Z] lock released after 240.8s, exit code 0
```

`npm run verify -- -t lint -p degradation-audit 2>&1 | tail -20`:

```
NX  1 task: 1 succeeded
Cache:             0/1 hit (0%)
[verify 2026-10-30T21:15:04.416Z] lock released after 25.2s, exit code 0
```

Host projects (`ptah-electron` etc.) were not re-run: this batch changes no exported symbol
(only private methods and optional `TrackedAgent` fields, which is not exported from the barrel).

## Risks

- R4 (exit-0 429 counted as delivered): the producer side is now in place. An exit-0 ptah-cli
  429 leaves the fixed marker; any CLI's 429 error segment in the current turn sets
  `rateLimited`, which B10b's `verdictOf` downgrades to `failed` / `usage-limit` when the
  deliverable is stale or missing. A fresh deliverable is not downgraded (B10b rule).
- False positives: exit 0 never reads stdout; the classifier needs a 429 next to an API or rate
  wording on one line; an earlier turn's segments are excluded by `turnSegmentStart`.
- Fail-open: segments beyond `MAX_ACCUMULATED_SEGMENTS` are not stored, so detection gives no
  match (today's behaviour).
- Ordering: flag is computed before `signalLaneCompletion` and `outputBuffer.discard`; pinned by
  spec 5.
- Privacy: the marker is a fixed string; the debug log carries `{ agentId, cli, exitCode }` only;
  spec asserts provider text never reaches a segment.
- Quota separation: no `failureKind`, no `recordLaneLimits` input from the rate-limit match.
- No new swallows, no `any`, `@ts-ignore` or `as unknown as` in production code; no new Nx edge.

## Decisions

| Decision                                                                                                         | Options                                                                                  | Evidence                                                                                                                                                                              | Reversible    |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Context carries `rateLimited: true` only when matched (conditional spread), not always `rateLimited: false`      | always `rateLimited: tracked.rateLimitMatched ?? false` (plan text) / conditional spread | sibling optional fields in `signalLaneCompletion` use conditional spreads; notifier defaults `?? false` at both call sites (B10b); keeps existing `toEqual` context assertions intact | yes, one line |
| Failed-exit rate-limit match reads current-turn error segments + stdout tail, not `laneFailureTexts` (all turns) | `laneFailureTexts` as plan / current-turn error segments + same stdout tail              | task brief: "an earlier turn's 429 does not taint a later turn"; `laneFailureTexts` is left unchanged for quota and auth                                                              | yes           |
| Clear `rateLimitMatched` at continuation start                                                                   | leave stale / clear                                                                      | a stop or timeout during turn 2 signals through `signalLaneCompletion` without entering the running branch and would otherwise carry turn 1's flag                                    | yes           |

## Out-of-scope observations

- `tracked.authMatched` is not reset in `continueConversation`, so a stop/timeout in a
  continuation turn carries the previous turn's auth match; and `laneFailureTexts` (quota/auth)
  reads error segments from all turns. Not changed here.

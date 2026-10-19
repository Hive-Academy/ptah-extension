# Completion report - TASK_2026_698_4146

Estimated prompt-cache expiry tile in the right-sidebar session inspector.

## Result

- `SessionStatsEntry.cache` (`ttl`, `lastRequestAt`, `expiresAt`, `idleCompactAt?`) rides on the existing
  `session:stats` and `session:stats-live` payloads. No new RPC method, no polling.
- Expiry = the last main-thread request's start anchor + confirmed TTL (1h = 3,600,000 ms, 5m = 300,000 ms).
  A cache read refreshes it with the retained TTL. Subagent and synthetic frames are excluded.
- Only native Anthropic routes produce a `cache` field; proxy and non-Claude sessions show no tile.
- `idleCompactAt` is the pending idle attempt's real `fireAt` and is cleared on every other transition,
  on compaction and on owner release; a cache-only change is published even while no turn is in flight.
- The webview tile counts down from `expiresAt` with one shared, ref-counted clock that ticks only while a
  tile is mounted and the document is visible.

## Commits (branch feat/cache-expiry-timer)

| Commit | Content |
| --- | --- |
| 5b4452d07 | Batch 1a: wire type, parser, request evidence, stats owner |
| 8cae67a62 | Batch 1b: idle projection, native route gate, release hook |
| 5df5238b3 | Batch 1c: live publication of cache-only changes, teardown |
| 20199ac83 | Batch 2: inspector cache tile and shared clock |
| 1eb95b874 | Review fix round (S1, S2, M1-M4) |
| 5af88dc35 | Frontend review fixes (group role, clock sample) |
| d9cfec11a | Bounded correction (N1, N2, N3a) |
| f7bc25dea | Visual fix (full-row span, aria sentence breaks) |

## Verification (orchestrator-run, scoped, --parallel=1, Jest --maxWorkers=2)

- `@ptah-extension/shared`: typecheck, lint, test pass (3669 tests).
- `@ptah-extension/agent-sdk`: typecheck, lint, test pass (171 suites, 3653 passed, 3 skipped).
- `@ptah-extension/chat-ui`: typecheck, lint, test pass (1441 tests).
- `@ptah-extension/chat`: typecheck, lint, test pass (after Batch 2; not changed after that).

## Reviews

| Gate | Author | Reviewer | Verdict |
| --- | --- | --- | --- |
| Gate 2 plan | codex lane | Claude subagent | APPROVED round 2 |
| Code, backend | codex lanes | Claude subagent | APPROVED 8/10 after fix round + bounded correction |
| Code, frontend | codex lanes | Claude subagent | APPROVED 8/10 |
| Visual (dark + light, before/after) | codex lanes | Claude visual-reviewer | APPROVED 8/10 after f7bc25dea |

## Follow-ups (not fixed; see decisions.md rows 15-17)

- FM6: `lastEmitted` set after the callback can cause a harmless duplicate emit.
- M4: a real unknown-run projection miss is not logged.
- N3b: without partial-message streaming, the first-frame anchor can overestimate expiry by the response time.
- N4: `post-compact` ordering against the compaction turn's `turn-ended` is unproven by a spec.
- Frontend M1: the clock ticks every second after expiry when no idle attempt is pending.
- Visual: "Cache expired" and the 5m variant were not captured live (covered by unit specs).

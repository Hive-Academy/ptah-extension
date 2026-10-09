# Code Logic Review — B11 probe fix (PID-reuse false positive)

Score: 8/10. Verdict: APPROVED. Blocking: 0. Serious: 0. Moderate: 2. Minor: 3.

## Scope and evidence
Read the full diff of `open-handle-probe.ts` and `real-state-guard.ts`, `parseWindowsTreeReply`, `runCaptured` and `sample()`. Ran the PowerShell conversion and the tree loop on this machine (Windows PowerShell 5.1.26100) against the real process table. I did not re-run jest; the author reports 6 tests passing.

## Checks requested

1. **PS and TS rules match.** Both reject a child when its time is known and earlier than its parent's (parent in the list), or earlier than the root's. Either time unknown means the ppid rule applies. Both skip `pid == ppid`. The PS fixpoint loop and the TS adjacency walk produce the same set. The PS script runs correctly on 5.1:
   - The `[long]([DateTimeOffset](...)).ToUnixTimeMilliseconds()` line (`open-handle-probe.ts:270`) works on every process: 311 of 311 had a non-null `createdMs`, e.g. 1791287782118.
   - `$byPid[[long]$p.ppid]` returns `$null` for a missing key, with no error.
   - `$tree.Contains($p.ppid)` works with `long` keys.
   - The `commandLine = if (...) {...}` hashtable value parses, and the `-Depth 4` JSON round-trips (98 KB).

2. **False drops of real host children.** None found.
   - A real child cannot be created before its live parent or before the root. A parent that has gone away is absent from `byPid`, so no comparison is made. That child is not adopted either, but this is the same as before the change.
   - Equal timestamps pass because the comparison is strict `<`. Both times are floored to ms the same way, so same-ms creation is accepted.
   - A grandchild whose middle parent died has its pid reused by a newer process. The grandchild is then older than that process and is dropped. It was already unreachable, because it was never linked to the root through the dead parent.
   - The root's own entry is only used as a bound and is never filtered.

3. **PID reuse through another route.** I found none.
   - Reuse of an in-tree pid P means the new owner T was created after the stale child Y, so `Y.created < T.created` and Y is dropped. This holds at any depth, because every edge is checked against its direct parent.
   - A reused root pid is covered by the root check.
   - The residual case is a stale child with a null creation time. It falls back to the old ppid rule and the false positive can recur. In this run 0 of 311 entries were null. Only the Linux `/proc` path leaves them null, and there PIDs are rarely reused in a short window.

4. **Chain, truncation and ISO edge cases.** See findings 1 and 4.

5. **Performance.** On 311 processes: the CIM query took 382 ms and the tree loop 64 ms with 2 passes. The 60 s `PROBE_TIMEOUT_MS` and the 10 s interval are not at risk. The handle duplication scan is unchanged and still dominates. `runCaptured` has no `maxBuffer`, so the reply, now larger with command lines, is safe.

## Findings

1. **Moderate: `createdAt()` can throw inside `sample()`** (`real-state-guard.ts:463-467`).
   - `new Date(x).toISOString()` throws `RangeError` when `x` is out of range (a huge number, for example).
   - `parseProcesses` (`open-handle-probe.ts:419`) accepts any JSON `number`. The throw lands in `sample()`'s catch (`:451`), sets `sampleFailure`, and voids the run. That would be a diagnostics-only field failing a run, and in the same sample the real held path would be lost.
   - This is not reachable from the PS output today. Fix: guard with `Number.isFinite(ms)` plus a try/catch that returns null, or clamp in `parseProcesses`.

2. **Moderate: command lines in the error text can leak secrets** (`real-state-guard.ts:127-135, 459-461`). Holder argv, such as tokens passed as arguments, goes into the error message and from there into logs and reports. It is capped at 300 characters but not redacted. Consider redacting `--token`/`key=` patterns.

3. **Minor: a truncated parent chain is not marked** (`real-state-guard.ts:471-483`). If a mid-chain parent is missing from the tree map, the chain simply ends. It is not flagged, and a reader may think the chain is complete when it stops short of the root. Append a marker, or note the break in `describeHeld`.

4. **Minor: no coverage of the PS script itself.** All specs exercise the TypeScript `processTree` and the parser. The two PS/TS implementations can drift silently. The Windows-only check done here is a manual one. A guarded Windows integration spec, or a shared fixture, would help.

5. **Minor: the PS tree lookup runs the unfiltered `tree.Contains` first**, and `$childBefore*` is evaluated for every process on every pass. This costs nothing measurable at this size (64 ms for 311 processes). It is noted only for completeness.

## Five logic questions (short)
- **Silent failure:** an unknown creation time silently reverts to the old rule. This is documented and acceptable.
- **Unexpected action:** none found.
- **Wrong answer from input:** none found. There is a theoretical false positive only with null timestamps.
- **Dependency failure:** a CIM failure is not hidden by a catch, which is the correct behaviour.
- **Missing:** redaction (finding 2).

## Verdict
APPROVE. Confidence HIGH on rule equivalence and on the PS 5.1 behaviour, MEDIUM-HIGH on the absence of false drops. Top risk: finding 1, a diagnostics-only field failing a whole run.

# Batch 44.1 spec fix report

## Defect 1: registry reconcile wiring

Removed the candidate store import, double, and constructor argument. The catalog is constructed with logger, registry store, and mirror.

Tests removed: none. Tests kept: "Case B: fast-forward updates the catalog row source_hash, stays non-diverged"; "Case C: divergence sets skill_registry.diverged=1 + pending_source_hash"; "Case C divergence persists even if the catalog re-sync runs first (setDiverged wins)".

## Defect 2: boot defer spec

Deleted `skill-trigger.boot-defer.spec.ts` because every test covered removed boot scanning, deferral, or analysis.

Tests removed: "does not enqueue anything synchronously from start()"; "runs the scan once the delay has elapsed"; "re-arms instead of running when foreground chat is active"; "cancels a pending scan on stop()"; "runs immediately when the delay is configured to 0"; "ignores foreground activity when the backoff is configured to 0"; "boots paused arms nothing; the first resume event re-arms once and queues the session"; "boots paused arms nothing; an external resume (no event) re-arms on the next activity"; "a pause mid-scan stalls, keeps the watermark, and the resume re-queues the skipped session"; "an aborted older scan does not clear the newer scan’s arm (review finding 9)"; "releases the arm when the scan finds no workspace root, and enqueues nothing".

Tests kept: none.

## Defect 3: trigger integration spec

Replaced the 17 argument harness with the current 10 argument constructor and retained callback registries. Removed analysis expectations. Added integration coverage for retained hook registration and disposal, Skill and Task tool invocation telemetry, prompt and subagent telemetry, and Stop triggered spec harvesting.

Tests removed: "SubagentStop full loop: notifyAll → analyzeSession with subagent sessionId + subagent-stop event"; "Edit-then-test FSM full loop: 3 Edits + Bash npm test fires once, FSM resets, next test does not fire"; "SessionEnd clears FSM (R3): 3 Edits → SessionEnd → Bash test → no analyze".

Tests kept or replaced with retained behavior coverage: "registers and disposes the four retained hooks"; "captures Skill and Task tool invocations"; "captures prompt expansion and subagent completion invocations"; "harvests specs after Stop for a workspace".

## Defect 4: trajectory extractor spec

Removed only the enhancer minTurns describe block and its now unused `fs` and `path` imports. The extractor's own ten tests remain.

Tests removed: "still declares a threshold and still passes it to the extractor"; "rejects a 4-turn session at the enhancer's threshold"; "accepts a 5-turn session at the enhancer's threshold"; "still extracts that same 4-turn session for callers that do NOT ask".

Tests kept: all ten extractor behavior tests, covering short sessions, success markers, tool turns, hashing, transcript paths, and workspace path normalization.

## Decisions

- The boot defer file had no retained behavior to preserve.
- The old integration spec had no retained behavior tests. Its replacement covers the retained hooks through real callback registries.
- No test, typecheck, lint, build, serve, or e2e command was run. Read only search and diff inspection found no remaining removed behavior references in the edited specs; `git diff --check` reported no whitespace errors.

## Clarifications Needed

none

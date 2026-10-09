# Long live recordings, a hard timeout, and what it cost

> **Status:** neither Ptah benchmark (the MCP tool benchmark, TASK_2026_619, and the memory/skills benchmark, TASK_2026_620) has produced a valid scored result yet. The extraction recording described here ended without a usable cassette. Nothing below is an accuracy or quality result.

The memory/skills benchmark replays model calls from cassettes (see post 1). Someone has to record those cassettes against a live model first. This post is about the first full extraction recording, `extraction-record-v1`, and why it ended without a usable result.

## What happened

The run started on 2026-10-09 and was slow: about 0.4 entries per minute on the long-transcript cases. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:12-13 --> At roughly 16:38Z it was at about 173 of 255+ entries. <!-- source: .ptah/specs/TASK_2026_620_a13e/HANDOFF.md:93-94 -->

It then ended. The run summary reported that the host wrote no completion record, the graceful stop timed out, and the process tree was force-killed (exit code 1). Suite `mem.extraction` was `missing` with verdict `na` (`host-incomplete`) and 0 cases. No `recording-rejection.json` was written. Nx reported the target failed after 240 minutes 23 seconds. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:38-44 -->

## The cause was a constant, not a crash

The diagnosis: the run hit the runner's default host completion timeout. It ran 17:38 to 21:38 local, exactly 240 minutes. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:44-48 -->

```ts
const DEFAULT_HOST_COMPLETION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
```
<!-- source: tools/mcp-bench/src/memory-skills/runner/run-memory-skills.ts:142 -->

The runner uses `options.hostCompletionTimeoutMs ?? DEFAULT_HOST_COMPLETION_TIMEOUT_MS`. <!-- source: tools/mcp-bench/src/memory-skills/runner/run-memory-skills.ts:290 --> The command line exposes an override, `--host-timeout-ms`, which must be a positive integer. <!-- source: tools/mcp-bench/src/memory-skills/runner/run-memory-skills.args.ts:38-58 --> The recording was started without it.

The arithmetic made the timeout hard to avoid. The cassette held 229 distinct entries, at about 63 seconds per live call, so the suite needs roughly 4.5 to 5 hours. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:46-48 --> A 4-hour limit cannot contain a 4.5-hour job. The 229 entries sat in the staged cassette, but the run was recorded as incomplete, so there was no accepted recording.

## Why the plan kept growing

When the ground-truth set grew to 129 facts, the extraction plan grew to 255 recording cases: 129 one-fact seeded sessions plus 63 long sessions per placement. <!-- source: .ptah/specs/TASK_2026_620_a13e/HANDOFF.md:170-172 --> The handoff flagged this as far more live calls than the earlier 10-fact draft, and asked that the call volume be told to the user and an explicit OK be obtained before recording. <!-- source: .ptah/specs/TASK_2026_620_a13e/HANDOFF.md:170-173 --> The sources do not show the timeout being revisited when the plan grew.

## Cost awareness

Each recorded call is a paid live model call. The handoff's instruction: tell the user the call volume and get an explicit OK before recording, or agree a smaller recording subset. <!-- source: .ptah/specs/TASK_2026_620_a13e/HANDOFF.md:170-173 --> The same handoff says not to run any bench without asking the user. <!-- source: .ptah/specs/TASK_2026_620_a13e/HANDOFF.md:55-56 --> A recording that fails at hour four spends the full amount for no accepted output, so the questions to settle first are how many calls, how long they take, and whether the limit fits.

## Why not just re-run?

Record mode does not resume. `RecordedCuratorLlm.extract` always calls the live model, and `CassetteStore.record` replaces an entry for the same key, so a re-run re-records all roughly 260 calls. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:51-54 --> <!-- source: tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:168-185 -->

## Three options

The follow-up brief lists these. None has been run. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:50-57 -->

| Option | What it does | Trade-off |
| --- | --- | --- |
| `--host-timeout-ms` (for example `28800000`, 8 hours) | Raises the limit on the existing code path | The flag exists today; a failure at hour seven still wastes seven hours |
| `record-missing` mode | Serves keys already in the cassette, calls the model only for missing ones; would reuse the 229 entries | Entries would come from two runs, so provenance changes and needs a design decision first |
| Shards | Split the extraction suite into pieces that each finish well inside the timeout | A failure costs one shard; needs a way to assemble the shards into one accepted cassette |

Of these, only the first needs no new code. The other two trade engineering time against the risk of repeating the loss.

## Lessons

- Work out duration before starting: entries times seconds per call, compared with the limit. Here it was 229+ calls at about 63 seconds against 4 hours.
- Re-check the limit whenever the plan changes size.
- A default timeout is a decision made for a smaller job. Print it at startup.
- A long job with no resume path should be sharded, or the resume path should be built first.
- Treat live recordings as paid operations: state the call count, get approval, and record a subset first.

The record path itself works end to end: a one-case probe, `extraction-probe-7`, passed with the cassette and its provenance sidecar accepted. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:9-11 --> The remaining gap is scale, not mechanism.

# Antigravity `result.status: ERROR` investigation — TASK_2026_707

## Summary

**Best-supported hypothesis (moderate confidence):** the two earlier long coding lanes encountered an upstream `503 UNAVAILABLE` during generation, and `agy` eventually finalized them as `ERROR` despite written deliverables. This is correlation, not a reproduced causal link: three fresh short runs, including one using `write_file`, returned `SUCCESS` and exit 0. The adapter deterministically converts any non-`SUCCESS` final status to lane exit 1 at `antigravity-cli.adapter.ts:1009`; its token formatter does not set status. A separate later run logged an explicit `429 RESOURCE_EXHAUSTED`, which is a confirmed service-side failure for that run but does not explain the two earlier 503-associated failures.

## Question and scope

Decision supported: whether to fix a Ptah spawn regression or investigate an `agy`/service failure. Compared the current adapter, recent history, five recent pre-experiment logs, and three real CLI runs. No source files were edited. The original two failing stdout streams were unavailable, so their complete final result JSON and any step `ERROR` events cannot be recovered from the CLI logs; the earlier observation of `result.status: ERROR` and exit 1 comes from the caller's report.

## Recent changes

| Commit (date) | Change relevant to `agy` | Consequence for this question |
| --- | --- | --- |
| `c5f078f04` (2026-10-02) | Parse `agy models` as ID plus display name; pass ID to `--model`. | Model selection only; no result-status change. |
| `21060eff4` (2026-10-03) | Filter status/error lines out of model-list parsing. | Model discovery only. |
| `abe828c2b` (2026-10-03) | Cap/render lane roles and omit already-delivered tool and messaging preambles on restored resumes. | Prompt content changed; a first turn still receives these sections. |
| `30108c20c` (2026-10-03) | Track tool-policy and messaging-block delivery separately for resumed turns. | Prompt sections on resume only. |
| `15a8362d4` (2026-10-03) | Prefer `projectGuidance` over `systemPrompt` in shared prompt builder. | First-turn prompt prefix can change. |
| `86f6a37d4` (2026-10-06) | Re-export process-tree kill helper for a probe. | No `agy` argument/result change. |
| `ac43b0818` (2026-10-08) | Remove fallback from `projectGuidance` to `systemPrompt` in `buildTaskPrompt`; adapter comment updated. | Potentially less prompt prefix; not status handling. |
| `596a4c987` (2026-10-08) | For explicit models, encode effort in known model ID and omit conflicting `--effort`; remap stale `claude-sonnet-4-6` to `claude-sonnet-5-5-medium`. | Changes `--model` value and can remove `--effort`; was intended to fix startup rejection. |
| `6b4d6ef42` (2026-10-10) | Move asar binary path helper to agent-sdk. | No `agy` argument/result change. |
| `274ab477f` (2026-10-12) | Set `windowsHide` explicitly according to `needsConsole`; `agy` requests a console. | Spawn window behavior, not streamed status. |
| `225bf5a06` (2026-10-12) | Add MCP tool-name substring guidance to messaging prompt. | Prompt length/content change only. |

Reviewed `git log --oneline -20` for both specified files, `git show --stat` and targeted diffs for the above commits. No new `agy` flag, environment variable, usage/token computation, or `result` handling was introduced in these files during this interval beyond the model/effort change listed. The current `agy` argv builder is `antigravity-cli.adapter.ts:279-317`. Its default stream mode uses `--print= --input-format stream-json --output-format stream-json`, then approval, `--print-timeout 3600s`, optional model/effort, `--add-dir`, and optional `--conversation`. `runSdk` adds `NODE_PTY_USE_CONPTY=0` on Windows (`:675-677`); `spawnCli` merges process env and `CLI_CLEAN_ENV` (`cli-adapter.utils.ts:315-316`). MCP is configured in `agy` settings, not an argv flag (`antigravity-cli.adapter.ts:593-625`). The usage formatter at `:320-333` only produces display text; result usage is deliberately not re-emitted to avoid double counting (`:1129-1131`).

## Runs

All runs on 2026-10-20, working directory `D:/projects/ptah-extension`, using `C:/Users/abdal/AppData/Local/agy/bin/agy.exe`. Full stdout, stderr, stdin where applicable, and numeric exit code are under [`agy-repro`](agy-repro/). No secrets or tokens were passed explicitly. `NODE_PTY_USE_CONPTY=0` was not set by these direct shell runs; the adapter would set it. The live MCP port and exact role/project-guidance text from the earlier lanes were unavailable, so B reproduces the command-line flag shape and a small representative prompt, not the full in-process Ptah spawn environment. B-write uses the same flags with a file-write prompt. These differences limit the conclusion.

| ID | Variant / command | Exit | `result.status` | Key evidence / matching CLI log |
| --- | --- | ---: | --- | --- |
| A | Minimal: `agy --output-format stream-json --print 'Reply with the word OK. Do not use tools.'` | 0 | `SUCCESS` | `A-minimal.stdout.jsonl`; `cli-20261020_190440.log:166,184-185` shows user message then normal stream completion; no 503/429. No `ERROR` step events. |
| B | Adapter-style stream input: `agy --print= --input-format stream-json --output-format stream-json --dangerously-skip-permissions --print-timeout 3600s --model claude-sonnet-5-5-medium --add-dir D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard` plus one JSON `user` event on stdin. | 0 | `SUCCESS` | `B-exact.stdout.jsonl`; `cli-20261020_190526.log:179,206-207` shows user message then normal stream completion; no 503/429. No `ERROR` step events. |
| B-write | Same flags as B; prompt calls for `write_file` to `agy-repro/B-write-deliverable.txt`. | 0 | `SUCCESS` | File exists and contains `OK`; stdout has `tool DONE write_file`; `cli-20261020_190545.log:176,204-205` shows normal completion; no 503/429. No `ERROR` step events. |

Full final `result` events, copied exactly from the captured stdout:

```json
{"event":"result","result":{"conversation_id":"a7e9444f-cdd5-48e4-9ed4-7f947fc67d6e","status":"SUCCESS","response":"OK\n","duration_seconds":14.310439,"num_turns":1,"usage":{"input_tokens":10170,"output_tokens":5,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":10175}}}
{"event":"result","result":{"conversation_id":"18d31d57-09e8-4b01-a6b9-65e1fa73ef3f","status":"SUCCESS","response":"OK\n","duration_seconds":1.8657111,"num_turns":1,"usage":{"input_tokens":10149,"output_tokens":4,"thinking_tokens":0,"cache_read_tokens":5788,"total_tokens":10153}}}
{"event":"result","result":{"conversation_id":"605262c9-3da7-41c7-bbdb-410dea4e2e6e","status":"SUCCESS","response":"Done.\n","duration_seconds":4.2215662,"num_turns":1,"usage":{"input_tokens":10664,"output_tokens":141,"thinking_tokens":0,"cache_read_tokens":21312,"total_tokens":10805}}}
```

Three `agy` runs total; no bisect was warranted because A and B both passed. No fresh run reported a quota/limit message. The pre-existing 03:47 log's quota reset time had elapsed before these runs.

## Root cause evidence

- Verified: both earlier reported failing coding sessions had one retried `503 UNAVAILABLE` in their `agy` logs: `cli-20261020_031131.log:198` at 03:12:10 and `cli-20261020_032516.log:203` at 03:26:04. Their logs then continued until normal stream-stop/completion markers at `:236-237` and `:277-278`. The logs do not record the final stream-json `result` or why its status was `ERROR`. The 503 is therefore a plausible upstream trigger, not proven causation.
- Verified: the later `cli-20261020_034707.log:204-205,213-214` explicitly records `RESOURCE_EXHAUSTED (code 429): Individual quota reached`; it is distinct from the two 503 cases. This 429 had reset by the experiment time.
- Verified: short A/B/B-write runs had no retried 503 and all ended `SUCCESS`, including a real file write. The new model/effort argv does not by itself make `agy` return `ERROR`. `usage` values were present on all successful final events, so token accounting presence does not by itself trigger failure.
- Verified: `antigravity-cli.adapter.ts:1000-1014` parses the CLI's final status and maps every status other than `SUCCESS` to lane exit 1. `:1116-1127` emits only status and response on failure; the full event is discarded. Ptah does not compute the final status. A process can therefore write deliverables and still be marked failed if the CLI reports `ERROR` later.
- Inferred: long multi-step runs have more opportunities to meet a transient upstream error; the two earlier 503 events are the strongest observed difference from the successful short runs. A long run without 503 ending `ERROR`, or a 503 run ending `SUCCESS`, would weaken that hypothesis.

## Proposed fix

At `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:1000-1009`, retain the raw parsed terminal `result` and record it in a **local, redacted diagnostic artifact** alongside the lane's error status; at `:1116-1127`, include safe structured error fields if `agy` supplies them. Keep the non-`SUCCESS` to exit-1 mapping: treating written files as success would hide real failures. No status-mapping or token-computation change is justified by these experiments. For the next natural failing lane, capture complete stdout/stderr and corresponding `agy` log, then compare its full result and final step events to the three captures here before changing flags or prompt policy.

## Decisions

- Kept the current `SUCCESS`/exit-0 rule. Options were to relax it after file writes or preserve the CLI's terminal status; the adapter source and successful B-write run support preserving it. Reversible.
- Stopped after three `agy` runs. A and B both passed, so the requested flag bisect had no failing contrast. Additional short runs would not isolate the observed intermittent long-run failure. Reversible.
- Used `claude-sonnet-5-5-medium` for B because the earlier 503-associated logs resolved that exact model (`cli-20261020_031131.log:149-155`, `cli-20261020_032516.log:157-163`). Reversible.

## Open questions

1. What were the complete final `result` events and preceding step events in the two original failing streams? The existing CLI logs do not contain them; the smallest experiment is to capture stdout and stderr of the next naturally occurring coding lane.
2. Does a retry of 503 actually cause the final `ERROR`, or merely correlate with longer service degradation? Compare a future captured 503 run's final result with a long successful run on the same model.
3. Did the original lanes use a live Ptah MCP server and a different exact prompt prefix or environment? Those runtime values were not available for a byte-for-byte B replay. A natural lane capture should record redacted argv, selected env overrides, MCP URL presence, and prompt-section names.

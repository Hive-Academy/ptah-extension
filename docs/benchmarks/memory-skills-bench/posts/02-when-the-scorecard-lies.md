# When the scorecard lies: four failures the benchmark hid from itself

> **Status:** neither Ptah benchmark (the MCP tool benchmark, TASK_2026_619, and the memory/skills benchmark, TASK_2026_620) has produced a valid scored result yet. The numbers below are intermediate smoke results used to find bugs in the benchmark. They are not a quality result for Ptah, ripgrep or any model.

A benchmark scorecard is a summary, and a summary can hide the thing that broke. In building the MCP tool benchmark, four separate problems looked like something else, or like nothing, until someone read below the headline numbers. Each led to a change that makes the failure visible in the scorecard.

## 1. The native baseline that never ran

The tool benchmark compares Ptah's code-search tools with a native baseline built on ripgrep (`rg`). In one smoke (`b13e`), the symbols-exact suite showed hit@5 of 0 for both sides. The previous smoke had native hit@5 of 0.85 with error_rate 0. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:8 -->

The native side's tell was in the other columns: error_rate 1, latency 0, one call per answer. That pattern means every `rg` spawn failed instantly. The 619 notes record that the smoke was started from Git Bash and suspect that `where rg` resolved to a shim there. That is the notes' diagnosis ("likely"), not a confirmed one. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:8 -->

The code-level cause, from the decision record: the resolver accepted the first line of `where rg` and spawned it without a shell. The native error text was captured but never listed in failures, and the verdict read native quality without checking its error rate. <!-- source: .ptah/specs/TASK_2026_619_af7f/decisions-s6.md:25 -->

The fix (Batch 13f) made it loud, three ways. Native error text now appears in the JSON failure entries. Each baseline's `error_rate` renders in the Markdown. A suite fails when its deciding baseline's error rate is over `MAX_ERROR_RATE`. On win32, resolution picks a `.exe` candidate, and one `rg --version` preflight at startup fails the run with a message naming `RG_PATH`. <!-- source: .ptah/specs/TASK_2026_619_af7f/batches.md:1756-1758 -->

## 2. A guard that voided a 105-minute run

The benchmark must not touch the developer's real Ptah database, so a guard watches for processes holding it. The first full cli-headless run was voided at 105 minutes by that guard. The cause was a false positive: PID reuse in the open-handle probe's process-tree walk adopted the real Ptah `node.exe`. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:72 -->

The fix added a creation-time check, in both PowerShell and the TypeScript tree builder, so a reused parent PID does not adopt an unrelated process. The error now carries the holder's command line, creation time and parent chain. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:73 --> <!-- source: .ptah/specs/TASK_2026_619_af7f/batch-11-probe-fix-report.md:17-21 -->

A void run is at least an honest failure. The cost was 105 minutes before anyone learned about it.

## 3. Ptah hit@5 of 0 on a partial index

The first full scorecard (smoke `b13g`) had native hit@5 of 0.85. Ptah's error_rate was 0, but Ptah's hit@5 was also 0, because the questions ran while the code index was still partial. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:177-178 --> Notice what the scorecard shows here: no errors, and a clean zero. Only the lifecycle results point at the cause: the index was still building after 120 s, at about 150 symbols per 5 s. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:180 -->

An earlier version of the same symptom had a different cause. In `b13e`, Ptah's 0 came from the benchmark's own classifier: mid-census answers carried the reasons `["updating","unrecognised?","unchecked"]`, and the cap rule counted that shape as unknown coverage. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:7 --> Two different causes produced the same headline zero.

Batch 13h made the bench wait for the index before scoring `ptah_code_search_symbols`. The rule: `reindexInFlight` is false, `symbolCount` is above 0, the result is normal, and there is no `updating` reason. The wait has a 20-minute limit and aborts after 6 consecutive error replies. It records an `indexSettle` detail and renders a Markdown line. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:174 --> If the index never settles, the suite fails without issuing partial-index questions. <!-- source: .ptah/specs/TASK_2026_619_af7f/batches.md:2585 -->

## 4. Two defects behind a skip

During Batch 8, a codex lane's first pass hid two real defects (an env fallback and a stdin hang) behind a skip. The live-rg spec cases skipped silently when `rg` was absent. <!-- source: .ptah/specs/TASK_2026_619_af7f/handoff.md:96 --> <!-- source: .ptah/specs/TASK_2026_619_af7f/batches.md:1092-1093 --> The follow-up rule: under `CI=true` a missing `rg` must fail the spec, not skip it. <!-- source: .ptah/specs/TASK_2026_619_af7f/batches.md:1093-1094 -->

## What the four have in common

| Failure | What the scorecard showed | What was true |
| --- | --- | --- |
| Native baseline | hit@5 0, no failure text | Every `rg` spawn failed |
| Guard | A void run, 105 min in | A reused PID pointed at the real process |
| Partial index | Ptah hit@5 0, error_rate 0 | Questions asked before the index settled |
| `rg` skip | Green specs | Two defects never exercised |

The common shape is a *fallback that absorbs failure silently*: a zero, a skip, an unlisted error. Practices that came out of this:

- Show the error rate next to every score, for baselines as well as the system under test.
- Fail on a broken baseline instead of printing a comparison against it.
- Wait for the system under test to be ready, and record how long the wait took.
- Turn skips into failures in CI.
- Check a suspicious zero against latency and call counts before believing it.

None of this shows that Ptah's tools are good or bad. It only makes the next scorecard less likely to lie.

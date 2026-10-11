# Batch 13b smoke diagnosis — edit-then-query / add-then-query (2026-10-07, fifth session)

Session: `ptah-ptah-extension-continue-619-follow-0b15390000ktg2q3sqvco0a` (orchestrator, in-process; not a lane).

## Verdict

Watcher delivery is NOT the cause. The edit and add cases fail because the bench scores every
`ptah_code_search_symbols` answer as `unknown-coverage` (never a pass) while the census is in
flight, and on the copied corpus the census does not finish inside the 60 s / 120 s windows.

## Evidence

1. Native watch host (built `dist/tools/mcp-bench/workspace-watch-host.mjs`, forked directly,
   `tmp/watch-probe/watch-probe.mjs`): create + update events are delivered for a root inside
   `.claude-worktrees` and for a root under `%TEMP%`, with and without
   `NESTED_WORKSPACE_PATH_RULES`. The native ignore set is root-relative.
2. Built cli-headless bench host on a 3-file `%TEMP%` workspace (`tmp/watch-probe/host-probe.mjs`,
   620 session gave its OK): census finished at 15 s (embedder warm-up); then an appended
   function was found 2.1 s after the edit and a new file 2.0 s after the add. So the lifecycle
   receives watcher batches and `reindexFile` writes them in the bench host.
3. `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:36-70` (`searchSymbol`): when
   `classifyToolResult` returns any error class, the probe returns `found: false` WITHOUT reading
   the hits.
4. `tools/mcp-bench/src/transport/call-recorder.ts:117-140`: `"census":"unknown"` or a reason
   ending in `?` (e.g. `"census?"`) is `unknown-coverage`. The tool reports exactly that while a
   census has not completed in this host session.
5. `tools/mcp-bench/out/b13b-cli-smoke/scorecard.md:43-50`: every state of cold-start, edit 5 s,
   edit 60 s, add, large-file-3900 and index-age is `unknown-coverage` with
   `reindexInFlight: true`; symbols grew 4,356 -> 14,343 and the census never settled in 120 s.
6. The same rule most likely explains ptah symbols-exact hit@5 = 0 (native 0.85) in B11/B13/B13b:
   the suite queries while the census is in flight. Not yet verified per question.

## Consequence

13b.1 (per-file reindex during a census) works but cannot move the smoke while coverage is
unknown. 13b.2 (one full-run owner) is still correct to keep (no competing censuses), but it
does not change the smoke verdict either. The open question is a scoring/product decision:
- product: report a known, honest partial coverage while a census runs (no `unknown`/`?`), or
- bench: score a positive hit for the expected file as found even when coverage is unknown
  (a positive hit is verifiable; a miss under unknown coverage stays a non-pass), or
- speed: make the census finish inside the window (does not help cold-start on a large corpus).

## Not done

No smoke was re-run. No product or bench code was changed for this diagnosis.

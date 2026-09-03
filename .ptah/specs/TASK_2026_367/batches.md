# TASK_2026_367 — Batches

Source: `implementation-plan.md` §14. User approved all batches including B9
(2026-09-02). Executors are CLI agents chosen by complexity; max 3 concurrent.
Orchestrator verifies each batch report, runs the batch gate, and commits.

| Batch | Item                                          | Complexity | Executor              | Plan § | Status                                                                            |
| ----- | --------------------------------------------- | ---------- | --------------------- | ------ | --------------------------------------------------------------------------------- |
| B1    | C1 stderr classifier + C2 spawn log line      | medium     | antigravity           | 1, 2   | DONE (gate passed: test 5/5, lint 5/5; commit deferred until no agent is editing) |
| B2    | C6a preflight coalesce + external-pass credit | medium     | antigravity           | 8      | IN PROGRESS                                                                       |
| B3    | C6b PulseMCP removal                          | mechanical | ollama cloud (sonnet) | 9      | DONE (gate passed: test 5/5, lint 5/5; commit deferred until no agent is editing) |
| B4    | C4 chunked map/reduce curation                | heavy      | claude cli (opus)     | 4      | DONE (gate passed: test 5/5, lint 5/5; commit deferred until no agent is editing) |
| B5    | C7b pendingTaskIds buffer                     | mechanical | ollama cloud (sonnet) | 12     | IN PROGRESS                                                                       |
| B6    | C5b Logger error args + C5a-now abort guard   | medium     | antigravity           | 5, 6   | IN PROGRESS                                                                       |
| B7    | C3 OAuth typed reason + discovery probe       | heavy      | claude cli (opus)     | 3      | PENDING (after B3)                                                                |
| B8    | C7a-1 PtahCliRegistry off-thread SDK spawn    | medium     | antigravity           | 11a    | DONE (diff matches plan §11a; awaiting codex review + commit)                     |
| B9    | C7a-2 off-thread spawnCli / probeCliVersion   | heavy      | claude cli (opus)     | 11b    | IN PROGRESS (wave 3, with FIX-B10 and FIX-F2)                                     |
| B10   | C5c synthesized message_start                 | medium     | antigravity           | 7      | DONE (diff matches plan §7 exactly; awaiting codex review + commit)               |
| B11   | C7c mojibake sweep (LAST, alone)              | mechanical | ollama cloud (sonnet) | 13     | PENDING (wave 4)                                                                  |
| B12   | C5a-later alreadyEnded wire field             | medium     | —                     | 5      | BLOCKED on TASK_2026_362 merge                                                    |

## Executor rules (in every spawn prompt)

- Edit only the batch's listed files. Other agents edit other files in the same
  tree concurrently.
- Never touch the Group A files (plan §0.1) or any Group B file.
- Never run `git add`, `git commit`, `git stash`, `git checkout`, `git reset`,
  `nx format:write`.
- Run the batch's test + lint commands; fix failures inside the batch's files.
- Write `batch-report-B<N>.md` in this folder; last line `DONE: B<N> — …` or
  `BLOCKED: B<N> — …`.

## Commit log

| Batch | Commit                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| B1    | `1d5933d9e fix(cli-agent-runtime): classify child stderr once and log the resolved spawn model`             |
| B3    | `0c7347068 fix(cli-agent-runtime,vscode-lm-tools,rpc-handlers,shared): remove the PulseMCP registry source` |
| B4    | `4906edf04 fix(memory-curator): curate long transcripts as bounded windows instead of one clamp`            |
| B2    | `298b59d27 fix(harness-sync): coalesce concurrent preflight passes and credit any completed pass`           |
| B5    | `a1179ad75 fix(vscode-core): buffer a subagent taskId that arrives before its registration`                 |
| B6    | `ec431d4cc fix(vscode-core,agent-sdk,chat): serialize Error log args and stop re-aborting an ended session` |

| B7 | `f2bdd4a25 fix(cli-agent-runtime,rpc-handlers,marketplace,shared): say when an MCP server needs an API key` |
| B8 | `f17440800 fix(cli-agent-runtime): spawn the headless claude CLI off the main thread` |
| FIX-F1 | `ecf62776b fix(chat): scope the abort dedupe to a turn and clear it when the abort fails` |
| FIX-F3 | `2c5d62c1a fix(harness-sync): store the shared preflight promise before its cleanup can run` |
| B10 + FIX-B10 | `a2071b763 fix(agent-sdk): keep an early content block by synthesizing its message_start` |
| FIX-F2 | `651aab906 fix(cli-agent-runtime): strip ANSI before classifying stderr and type the spawner fakes` |
| B9 | `bacf829e7 fix(agent-sdk,cli-agent-runtime,platform-core): spawn rival CLIs off the main thread` |
| B11 | DONE: 68 files, 462 replacements; verified byte-exact against HEAD + the ten-pair map (4 files differ by CRLF only, normalized by `eol=lf` on commit; 14 BOMs pre-existed). Commit pending the affected-project test run. |

Second mixed-commit incident: the B10 subject exceeded commitlint's 72
characters, its files stayed staged, and the FIX-F2 commit absorbed them.
Undone with a soft reset (local branch), re-committed as two commits.

Note: a first B3 attempt failed in the pre-commit hook (transient Nx
"Failed to process project graph"), and the hook's revert left the B3 files
staged so the B4 commit absorbed them. That mixed commit was undone with a
soft reset (local branch, no upstream) and re-committed as two commits.

Wave 2 (started after the commits): B7 claude cli, B8 antigravity, B10
antigravity (pulled forward: its blocker, the uncommitted 366 work, is
committed as 3ec94740a). All three DONE, uncommitted, awaiting the commit
window (a TASK_2026_368 architect from another session is writing in the tree).

## Codex review of antigravity Wave 1 (code-review-antigravity-wave1.md)

| Finding                                                                          | Severity | Batch | Fix batch                                     | Executor                      |
| -------------------------------------------------------------------------------- | -------- | ----- | --------------------------------------------- | ----------------------------- |
| F1 abort guard keyed by session, not turn; survives failed RPC                   | HIGH     | B6    | FIX-F1 (libs/frontend/chat)                   | claude cli opus — IN PROGRESS |
| F2 registry classifies raw ANSI stderr; coloured error demoted to debug          | MEDIUM   | B1    | FIX-F2 (+F4) — after the B8 commit, same file | pending                       |
| F3 preflight IIFE cleanup can run before `inFlight.set`; rejected promise cached | MEDIUM   | B2    | FIX-F3 (harness-sync/preflight)               | claude cli opus — IN PROGRESS |
| F4 `terminated` does not pin the `abort` word boundary                           | LOW      | B1    | folded into FIX-F2                            | pending                       |
| F5 B2 edited harness-sync/CLAUDE.md outside the plan's file list                 | LOW      | B2    | accepted as a documented deviation, no change | —                             |

Verdicts: B1 approve-with-fixes, B2 approve-with-fixes, B6 REJECT until F1.
FIX-F1 and FIX-F3 landed (claude cli opus), both with mutation-proven specs.

## Codex review of antigravity Wave 2 (code-review-antigravity-wave2.md)

| Finding                                                                                                                             | Severity | Batch | Fix                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------ |
| W2-F1 a real `message_start` after a synthesized one clears the tool-call map and opens a second message; later deltas are orphaned | HIGH     | B10   | FIX-B10 (claude cli opus) — B10 is NOT committed until this passes                         |
| W2-F2 spec harnesses pass the spawner as `as unknown as never`; no DI smoke resolves PtahCliRegistry                                | LOW      | B8    | folded into FIX-F2 (typed `ISdkProcessSpawner` fake + a cli-agent-runtime container smoke) |
| W2-F3 eight spec edits not recorded as a plan deviation                                                                             | LOW      | B8    | recorded here; accepted                                                                    |
| W2-F4 report claimed 7 new tests, there are 5                                                                                       | LOW      | B8    | recorded here; accepted                                                                    |

Verdicts: B8 approve-with-fixes (committed; fixes follow), B10 REJECT.

## Wave 3 (FIX-B10, FIX-F2, B9) — all DONE, uncommitted

- FIX-B10 (claude cli): keeps the synthesized id, reconciles the real
  message_start into it (no second envelope, tool map and skill tracking kept),
  `isMessageSynthesized` flag on TransformerState cleared with the message id.
- FIX-F2 (antigravity): ANSI strip via the adapters' `stripAnsiCodes` before
  classify; `abortive attempt` boundary spec; typed `FakeSdkProcessSpawner`
  in ptah-cli/testing replaces 8 `never` casts; DI smoke resolves
  `SDK_PTAH_CLI_REGISTRY` with the real OffThreadProcessSpawner.
- B9 (claude cli): `spawnProcess` on OffThreadProcessSpawner implementing the
  new platform-core `IProcessSpawner`; host-side cross-spawn `_parse`; worker
  protocol gains stderrMode/detached/windowsHide/windowsVerbatimArguments and
  stderr-chunk/stderr-end; handles expose pid/whenSpawned/close; R1/R2/R3 each
  pinned by a spec that ran green on this Windows machine. Deviations recorded
  in batch-report-B9.md §8 (close event, nullable stdio, parse in agent-sdk,
  stderrMode replaces wantStderr, optional adapter ctor param).
- Gate: tests 3/3 green (agent-sdk 1381, cli-agent-runtime 550, platform-core
  540), lint 0 errors, lib tsc clean. Typecheck:all pending.
- Codex review of FIX-F2: APPROVE WITH FIXES, 1 LOW — wave-1 F2 and F4 closed;
  wave-2 F2 only partly closed because `FakeSdkProcessSpawner` still uses
  `as never` / `as unknown as` and derives its signature from the port it
  guards, so it cannot fail typecheck on drift. Accepted as a follow-up
  (future-enhancements): give the fake an independently written concrete
  signature with real Node stream/EventEmitter doubles.
- Codex review of FIX-B10 + B9 in flight (code-review-claude-wave3.md).
  Commits follow it.

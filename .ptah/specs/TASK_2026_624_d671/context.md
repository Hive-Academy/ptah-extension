# TASK_2026_624 — Memory and skills bench: recordings and first scored run

## RESUME HERE (2026-10-10 — start brief for a new session)

This is the follow-up to TASK_2026_620 (PR #686, merged into `main` as `927cba509`). 620 shipped the
product changes and the committed memory/skills bench WITHOUT recordings. This task produces the first
recorded cassettes and the first scored memory/skills scorecard.

**The full brief is on `main`:** `.ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md`. Read it first,
then `.ptah/specs/TASK_2026_620_a13e/HANDOFF.md` ("Phase 4 seams", standing rules) and `batches.md`
(Batch 24 at ~line 840, Batch 26 at ~line 892).

**Start by:** creating a worktree from `origin/main` on a new branch (e.g. `feat/task-624-bench-recordings`).
The 620 branches and worktrees were deleted after the merge.

## User decisions (2026-10-10)

- Start after #686 merged — done.
- **Extraction: add a `record-missing` mode** and reuse the 229 entries already in
  `%LOCALAPPDATA%\ptah-mcp-bench\cassettes\memory\extraction.v1.jsonl` (serve keys already in the
  cassette; call the live model only for missing keys). This changes the cassette provenance contract
  (entries from two runs). **Design it first and ASK THE USER before choosing:**
  - how the provenance sidecar records both runs;
  - which run id, corpus SHA and prompt SHA each entry carries, and what happens when they differ
    between runs (e.g. a changed prompt invalidates old keys);
  - how acceptance treats a mixed cassette.
    Get a code-logic review of the design and the code before any recording.
- Never start the extraction plan in plain record mode: it re-records and replaces every key.
- Backup of the 229-entry cassette: `extraction.v1.jsonl.bak-20261010-229` in the same folder
  (SHA-256 prefix `70f427c4158ceccb`, identical to the original at backup time).

## Order of work

1. **Per-call provenance gate** (review defect 3, `code-logic-review-model-free-resolve.md` in the 620
   folder): correlate dispatches per call, not in aggregate. Code only, no paid calls.
2. **`record-missing` mode** + `--host-timeout-ms` with headroom (the 4 h default stopped
   `extraction-record-v1` at 229 of ~260 calls; ~63 s per live `gpt-5.6-terra` call). Code only.
3. **Recordings, one at a time** (paid live calls — ask the user first, and ask them to refresh the
   Codex login just before): extraction (record-missing), `b18-record-v1`, `scope-write-record-v1`,
   `funnel-record-v1`. Copy accepted cassettes into the committed fixtures and replay once.
4. Batch 24 (CI workflow + first recorded run on Windows and Linux/WSL), U3 (matcher validation by a
   cross-family model panel), Batch 26.

## Rules

- Memory-safe verification (CLAUDE.md): scoped projects only, one heavy check at a time,
  `--maxWorkers=2`, `--parallel=1`; never `nx run-many`, build, serve, e2e, or the full mcp-bench test
  target. A worktree needs a `node_modules` junction: `cmd /c mklink /J <wt>\node_modules
D:\projects\ptah-extension\node_modules`; remove it with `cmd /c rmdir`, never a recursive delete.
- Never run a bench or recording without asking the user. One bench at a time on this machine.
- Ask the user before any scoring-rule or provenance-contract decision.
- Never commit private bench data from `%LOCALAPPDATA%\ptah-mcp-bench` (only accepted cassettes copied
  into the committed fixtures, per the brief).
- Lanes never read `~/.codex/auth.json` or the real `~/.ptah`, and never run git operations.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The user merges PRs.

## Related

- Docs PR #691 (`docs/task-620-bench-posts`): charts of the 229-entry cassette and three bench lessons
  posts in `docs/benchmarks/memory-skills-bench/`. Re-run `generate-cassette-charts.mjs` when the
  cassette is complete, and replace the "unscored" status once a scored run exists.

## Rescope (2026-10-14, TASK_2026_659_cec4)

Scope is now **memory only**. The skills suites measure the skill-synthesis pipeline, which is switched off and proposed for removal. Memory stays as is.
Evidence: `.ptah/specs/TASK_2026_659_cec4/evaluation-report.md` and `task-triage.md`. Approved by the user on 2026-10-14.

## Retired sources (2026-10-30)

This task cites `TASK_2026_659_cec4`. That folder was retired from `.ptah/specs`. Read it in git history: `git show ff531866f:.ptah/specs/<folder>/<file>`.

## Triage 2026-10-30 (premise audit)

Verdict: STALE-REWRITE (lane antigravity, verified by Claude).

- #788 (7a4a307e7) deleted the skill funnel, namer and trigger suites; `main:tools/mcp-bench/src/memory-skills/suites/skills/` keeps only rubric-agreement / rubric-ground-truth / rubric-panel-manifest. The skills recordings in the original scope cannot be made.

New scope: per-call provenance gate + record-missing cassette mode; after user approval for paid calls, record extraction, dedup and scope-write suites and publish the first scored memory scorecard.

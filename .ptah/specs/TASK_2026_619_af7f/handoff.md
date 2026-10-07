# Handoff - TASK_2026_619_af7f (2026-10-07)

## Update (2026-10-07, second session) — read this first

- Batches 5 and 6 are COMPLETE: `7e1572272` (Batch 5), `629e4f719` (Batch 6). 9 of 41 batches done (the team-leader corrected the count: 1-37 + 4b/4c/4d + 34b = 41). The sections below this update describe the state before these commits and are kept for history.
- New user decisions in context.md: relevance truth = PRs + commits (200 test / 1,427 tune); SCIP indexers installed globally (scip-typescript 0.4.0 and scip-go 0.2.7 on Windows, scip-go at `%USERPROFILE%\go\bin`; scip-python 0.6.6 only in WSL Ubuntu-24.04 via nvm Node 22, because it crashes on Windows).
- Batch 7 in progress: opencode lane writes `scip-cross-check.ts` + spec + `corpus.config.json` `polyglot` pins (attrs 25.4.0 `9a98e00a`, logrus v1.9.4 `b61f268f`, both MIT). The orchestrator makes the indexes outside the lane: `%TEMP%\mcp-bench-scip-go.scip`, `%TEMP%\mcp-bench-scip-python.scip` (WSL: `scip-python index . --environment /tmp/scip-env.json` with `[]`), `%TEMP%\mcp-bench-scip-ts.scip` (`tsconfig.scip.json` in `%TEMP%\mcp-bench-b5-corpus`).
- Ground-truth generators run outside lanes via an esbuild bundle of a throwaway driver kept in `%TEMP%\mcp-bench-drivers` (never in `tools/mcp-bench/out/`: ESLint lints that folder).
- `batches.md` has one uncommitted edit (Batch 6 SHA in its header) and `batch-6-executor-report.md` an executor-line fix; commit both with the next batch.
- TASK_2026_620 requests (2026-10-07, accepted by the orchestrator; the next team-leader Mode 2 adds them to Batch 9 as a first small task): (1) export a core per-suite zod schema from `scorecard.types.ts`; (2) an explicit `env` option on `launchBenchHost`, merged after isolation, refusing isolation keys; (4) export the bench-host argument and shutdown helpers. (3) answered: `guard: { ci: true }` is correct for the 620 Linux CI job. 620 commits so far: 179a5bbc6, 44a3329c4 (only project.json targets). Send 620 the Batch 9 SHA.
- Batch 7 COMPLETE `90de07275` (10/41). Batch 8 in progress on codex (agent 195947f4, then rev 1 agent 3fc64e43, session `01a113cc-3ee1-7163-a357-6deeba9bdd1e`).
- ripgrep: no `rg` on the Windows PATH (`rg` in Git Bash is a shell function). Local runs set `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe` (14.1.1, transitive). CI installs ripgrep via apt (Task 10).
- Lane evidence: opencode Batch 7 (code+spec, 11 tests, report delivered, then process exit code 1 at close after the deliverable = false failure; 1 orchestrator correction: win32 path separators); codex Batch 8 (first pass hid 2 defects behind an rg-absent skip: env fallback, stdin hang).
- Lane evidence added: codex Batch 5 rev 1 (7 defects, 3 m 17 s, 2 orchestrator corrections after); opencode Batch 6 rev 1 (25 m 21 s, clean scoped checks, report delivered).

The orchestrator session stopped at the user's request after the Batch 5 / Batch 6 step. This file is the entry point for the next session. Read it first, then `context.md` (all user decisions), then `batches.md`.

## Where things are

- **Worktree:** `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`
- **Branch:** `fix/task-619-tool-benchmark`, based on `origin/main` 7910f34cf. Never commit to `main`. Never work in the main checkout.
- **Flow:** orchestration skill, BUGFIX, Full depth, plan-free. Phase 1 = benchmark (Batches 1-11, no product change). Phase 2 = fixes (Batches 12-37).
- **Progress:** 7 of 39 batches committed. Batches 5 and 6 are IN_PROGRESS and NOT committed.

### Commits on the branch

| Commit | Batch |
|---|---|
| 122a9dd7b | 1 - mcp-bench scaffold, retrieval and cost metrics |
| 4fc9d147c | 2 - scorecard model, writers, pinned corpus checkout |
| b538e8fb6 | 3 - HTTP transport, isolated cli-headless bench host |
| d995a1e1a | 4 - Electron host (launch/attach), real-DB guard modes (hash / process-watch) |
| 1ae06c824 | 4b - generic scorecard core shared with TASK_2026_620 |
| d716e0e8f | 4c - shared bench-host boot helper, bench data folder |
| f22b604fe | 4d - shutdown classification, partial guard report, spawn errors |

### Uncommitted in the worktree (intentional)

- `batches.md` (state edits from the 4d Mode 2: Batches 5/6 IN_PROGRESS, parallel rules) and `context.md` (new sections: "User Requests (2026-10-07)", "Workspace hygiene").
- `.ptah/specs/TASK_2026_622_2d05/` — a separate product-bug task (see below), moved here from the main checkout at the user's request. Commit it with the next batch commit.
- `batch-5-executor-report.md`, `tools/mcp-bench/src/ground-truth/` (8 files), `tools/mcp-bench/questions/7910f34cf/` (8 JSON files).

## First actions for the next session (in this order)

1. **Verify the tree.** `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed at the stop. Re-run it once: a TASK_2026_620 subagent ran the full `mcp-bench:test` in parallel at about 02:00, and the two corpus-spec runs can see each other's temp folders.
2. **Finish Batch 5** (Codex lane, session `01a1135e-53f4-7f70-a3cf-4f06026e5fd8`). Code and spec are done (`ground-truth.spec.ts`, 3 tests pass), but the five question files are EMPTY envelopes: `symbols-exact.json`, `symbols-concept.json`, `references.json`, `definitions.json`, `dependents.json`. Cause: every Codex command was killed at 30 s, so the `git archive` extraction and the generator never ran. **Do not commit empty files as ground truth.** Run the extraction and the generator from a subagent or the orchestrator Bash (long timeout), not from a Codex lane: `git -C <worktree> archive 7910f34cf | tar -x -C %TEMP%\mcp-bench-b5-corpus`, then a throwaway driver with `node --max-old-space-size=8192` (see `batch-5-executor-report.md` line 29). Check the stratum counts against the Batch 5 spec in `batches.md`.
3. **Finish Batch 6** (Glm lane, session `cb9f49bd-22c1-486d-8780-00b908996ed5`; it exited with `no-deliverable`: no report, no `ptah_agent_report`). State: `file-tools.json` 400 questions and `memory.json` 489 questions were generated; `relevance.json` has 0, because `gh pr list --state merged --limit 1000 --json ...files...` failed (truncated JSON, then HTTP 502 from the GitHub GraphQL API). Fix: page the gh query (smaller `--limit`, several calls) or use `gh api` REST with pagination, then regenerate `relevance.json` (target: 200 held-out `test` PRs + `tune`). Write `batch-6-executor-report.md` (missing). The Batch 6 spec is `relevance-memory.spec.ts`.
4. **Format:** 11 files under `tools/mcp-bench/src/ground-truth` and `tools/mcp-bench/questions` fail `npx prettier --check`. Run `npx prettier --write` on them.
5. **Review** both batches yourself (read the generators; spot-check 10 questions per file against the corpus), then a **fresh team-leader in Mode 2** with both report paths. Each batch gets its own commit. Include `TASK_2026_622_2d05/` and the uncommitted `context.md`.
6. Continue with Batch 7 per `batches.md`.

## Lane evidence so far (for the final per-lane table the user asked for)

| Lane | Batches | Result | Notes |
|---|---|---|---|
| codex | 1, 2, 4b, 5 | 1 ok; 2 needed 1 revision (corpus.ts cleanup defects); 4b needed 1 revision (API design) + a queued addition; 5 incomplete | Skipped Prettier in 1 and 2. **Each command is killed at 30 s** in this environment: it cannot run the nx check (1-2 min), long git, or generators. Unsuitable for batches whose verification or output needs long commands. A queued message arrives only as a later turn: wait for it before starting another lane on the same files. One resume failed at 1 s (SDK exit 1). |
| Glm (ptah-cli, Ollama Cloud, tier opus) | 6 | Partial; exit `no-deliverable` after 18 m 47 s, $6.13 | Generated 2 of 3 outputs; got stuck waiting on a background gh retry; wrote no report. |
| subagents (backend-developer) | 3, 4, 4c, 4d | All complete | 4d found a real product bug with a careful bisect. |
| opencode, antigravity | — | not used yet | Plan: opencode for Batch 7 (no messaging support: no report, no steering); antigravity as the Phase 1 lane reviewer of subagent-authored code. |

Re-check the plan in `context.md` "User Requests (2026-10-07)": given the Codex 30 s limit, prefer subagents (or lanes with no command limit) for Batches 7-8, and keep lanes for pure-code tasks whose verification the orchestrator runs.

## Decisions to keep (full text in context.md)

- Prompt claims stay unchanged; fix the tools until they meet them.
- Language-server manager with TS/JS, Python (pyright), Go (gopls) in this task; others in a follow-up. Warm at session start in a separate process with a memory ceiling. SCIP is benchmark ground truth only.
- One coverage line when clean.
- Real-DB guard: `hash` mode, or `process-watch` when the desktop app writes the DB; CI always `hash`.
- Scorecard core is owned by 619; TASK_2026_620 registers its own suite kinds.
- **Open a PR at the end** (base `main`). Never merge it.
- New Phase 2 item: worktree-aware task tools (`workspaceRoot` argument on the five `ptah_task_*` tools), with Fix 7 / Batch 34. Not yet in `batches.md`: the next team-leader Mode 2 adds it.
- Workspace hygiene: nothing is written in the main checkout. After any `ptah_task_create`, move the new folder into this worktree at once (the tool writes to the main checkout).

## Open findings already assigned in batches.md

- Corpus cleanup race in `withPinnedCorpus` (`corpus.ts:30`, `:116-129`): Task 9.3 (owner liveness check). Also: the corpus spec should use a private temp root.
- Model download on every run: Task 9.1 (shared model cache under the bench data folder).
- `countEligibleFiles` is not the product's eligibility rule: Task 11.1.
- Guard `unprobed` → scorecard `run.guard.unprobed`: Task 9.3.

## Related tasks

- **TASK_2026_622_2d05** (in this worktree): product bug. `SqliteConnectionService.close()` (`libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:526`) dies with 0xC0000409 in `wal_checkpoint(TRUNCATE)` in 50-80% of win32 shutdowns after vectors are written to `vec0` tables. Not part of 619. The user was told it may affect the desktop app and the real DB; recommend starting it soon.
- **TASK_2026_620_a13e** (other session, `ptah-ptah-extension-skills-trajectory-an-10a89600005aw2q23htdi0c`): memory + skills benchmark. It reuses `tools/mcp-bench` (code in `src/memory-skills/`, two targets of its own in `project.json`). Agreements: 619 is the only writer of the scorecard core files; 620 does not run a bench that calls `withPinnedCorpus` while a 619 bench may run, and messages 619 before its first recorded run (its Batch 24). Send 620 the SHA of any commit that changes `tools/mcp-bench/src/scorecard/`, `transport/bench-host-boot.ts` or `bench-data.ts`.

# implementation-plan.md — Gate 2 review (round 1)

- Author: codex lane 254d9236 (CLI side), role software-architect
- Reviewer: orchestrator (in-process side, Claude family)
- Verdict: **REVISE**

Strong plan: cron-discovers / worker-owns-deadline split, SQLite outbox with marker reconciliation,
exact-SHA detached worktrees with argv-only git, dependency policy, head re-check before every
mutation, Zod-validated lane output where invalid output fails the stage, honest replay isolation.
Five defects must be fixed before batching.

## Findings

1. **Serious — Nx module boundary violation (Library layout).** `review-core` and `review-github`
   are tagged `scope:shared`, but `eslint.config` (line ~278-279) allows `scope:shared` to depend
   only on `scope:shared`. `review-core` depends on `cron-scheduler`, `cli-agent-runtime`,
   `persistence-sqlite` (all `scope:extension`) and `rpc-handlers` is `scope:extension`. Fix: tag
   the backend libs `scope:extension` (as the libs they compose with), keep `review-contracts`
   `scope:shared` so the webview can import it, and re-prove the dependency direction including
   the CLI host (`cli-engine` tags) for P4.

2. **Serious — `findingKey` is not stable (Contracts, AC-8.1/8.4/8.5).**
   `sha256(repo + PR + canonical failure mode + affected behavior)` hashes LLM-written prose. Two
   runs over the same bug will word it differently, so dedup and "addressed"/"reopened" tracking
   break, and the PR gets duplicate root comments. Define an identity-matching stage instead:
   (a) shortlist prior open/addressed findings on the PR by anchor (path + enclosing symbol from
   the AST/symbol index, not line) and category; (b) decide "same finding" with a deterministic
   rule plus a bounded semantic judge (the verifier lane, or embeddings — `sqlite-vec` is already in
   the stack), record the match evidence; (c) the key is an assigned ID, not a hash of prose.
   Include tests for reworded-same-bug and two-distinct-bugs-same-symbol.

3. **Serious — Lane deliverable location conflicts with lane sandboxes (Prompt and worktree
   policy).** Lanes write `triage.json`/`lens-*.json`/`verdict.json` under the Ptah state
   directory while their source is a separate worktree. Codex runs `workspace-write`
   (`libs/backend/codex-runtime/tools/evidence-harness.ts:1052`) and in this task a codex lane got
   `Access denied` for every write outside its working directory. Specify the per-attempt layout
   so every lane's `workingDirectory` contains both the read-only source and its writable output
   dir (e.g. `<attempt>/src` worktree + `<attempt>/out`), declare deliverables there, and enforce
   "source is read-only" by a post-lane check (`git -C <src> status --porcelain` empty and HEAD
   unchanged → else the stage fails and the worktree is discarded). Verify the equivalent
   constraint for each other family the selector can choose.

4. **Moderate — Replay isolation has no concrete mechanism (Evaluation harness).** "OS sandbox with
   network namespace/firewall deny" is stated but not designed. Specify per host OS and per lane
   family how no-network/no-`gh`/no-credentials is enforced (e.g. Ubuntu: `bwrap`/`unshare -rn`
   wrapper; codex: its own network-off sandbox), which families are therefore replay-eligible,
   and how the attestation in AC-17.7 is produced. Otherwise the first report is invalid by
   construction.

5. **Moderate — Machine-wide concurrency is unbounded across PRs (Orchestration).** Two concurrent
   PRs × up to four parallel lenses + verifier + checks can exceed `maxConcurrentAgents`
   (`agent-process-manager.service.ts:~2540`) and starve the operator's own lanes on the same
   machine. Add a global review lane cap (default e.g. 3 concurrent lanes for review), state how
   it interacts with `maxConcurrentAgents` and the verify lock, and what a run does when it cannot
   get a slot before its deadline (coverage-limited, not hung).

## Minor

6. P1 table: `tsconfig.base.json` edits — say "via Nx generator" so path aliases are not hand-written.
7. Add the file-size rule note: prompt builders and the orchestrator must stay under the repo's
   file-size lint limit; plan a split for `review-orchestrator.service.ts` (stage runner per stage).

---

# Round 2 re-review

- Revision by: codex lane f26e5fe9 (resumed session 01a1a28d)
- Reviewer: orchestrator (in-process)
- Verdict: **APPROVED**

| # | Status | Evidence in plan |
|---|---|---|
| 1 | Resolved | lines 60-62, 195, 241-244: contracts `scope:shared,type:util` (owns `IGitHubReviewPort`); core/github `scope:extension` |
| 2 | Resolved | lines 130-152: assigned ULID, path/symbol/category shortlist, same/distinct/uncertain adjudication, uncertain cannot create a root |
| 3 | Resolved | lines 185-187: attempt-root cwd with src/out/meta; HEAD + `status --porcelain` integrity check before parsing |
| 4 | Resolved | lines 228-229: Ubuntu + codex-only replay in bwrap, broker, attestation |
| 5 | Resolved | line 167, 174: global review semaphore 3, capped at maxConcurrentAgents-1 |
| 6-7 | Resolved | revision log |

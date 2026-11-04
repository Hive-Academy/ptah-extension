# task-description.md — Gate 1 review (round 1)

- Author: codex lane (CLI side), agent 18564f96, role project-manager
- Reviewer: orchestrator (in-process side, Claude family)
- Verdict: **REVISE**

Strong document: 17 FRs with testable ACs, honest partial-coverage rules, correct user-reserved
items, phasing that keeps every phase shippable. Four gaps must be closed before Gate 1.

## Findings

1. **Serious — Evaluation contamination (FR-17).** The 15 replay PRs exist on GitHub with the
   CodeRabbit comments and our fix commits on them. A lens or verifier lane that can reach the
   network, `gh`, or the git history after the pre-fix head can read the answers. Add a
   requirement and AC: replay lanes get no GitHub API/`gh` access and no network fetch of the PR,
   the replay worktree contains no commits after the pre-fix head (no refs to later commits), and
   the report records how isolation was enforced.
2. **Serious — Dependency state of the review worktree (FR-5, FR-15).** ESLint config, the
   degradation audit and dependents analysis execute repository code and need `node_modules`.
   The document does not say how a PR-head worktree gets dependencies, or what happens when the
   PR changes `package.json`/`package-lock.json`. Add a requirement: the dependency policy (reuse
   the reviewer's installed dependencies when the lockfile is unchanged; otherwise either an
   isolated install under the verify lock or mark lockfile-dependent checks unavailable), with an
   AC for a lockfile-changing PR. Never run install scripts from an untrusted source.
3. **Moderate — Unknown lane limit treated as unavailable (FR-14 bullet 2).** On the reviewer
   machine several lanes routinely report "unknown (reader failed)". Treating unknown as no
   capacity can leave one family, which breaks cross-family lens/verifier independence. Change to:
   confirmed-room lanes first, unknown-limit lanes next (marked unverified), at-limit lanes never;
   a limit error during a run marks that lane at limit for the rest of the run. Also state whether
   the verifier must be a different family from the lens that raised the finding (recommend: yes
   when available, else recorded same-family with a weaker-evidence label).
4. **Moderate — No latency or throughput target (NFRs).** Add an NFR with a proposed target, e.g.
   walkthrough posted within 10 minutes and review within 30 minutes of a new head for a PR under
   ~1,500 changed lines at default depth, plus how the target is measured (run record timestamps).
   Mark the numbers as a proposal.

## Minor (fix if local)

5. P1 includes the new Electron surface and its design gate. Keep it, but state that P1's core
   pipeline must be usable without the UI (artifacts on disk + cron run history) so the UI design
   does not block evaluation.
6. FR-11: say what happens to CodeRabbit during the transition (both bots post on one PR). Suggest:
   P2 publication can be enabled per repository while CodeRabbit stays on; Ptah does not read or
   react to CodeRabbit comments except in the evaluation harness.

---

# Round 2 re-review

- Revision by: codex lane 50c306a9 (resumed session 01a1a275)
- Reviewer: orchestrator (in-process)
- Verdict: **APPROVED**

| # | Status | Where |
|---|---|---|
| 1 | Resolved | FR-17, AC-17.6, AC-17.7 (no gh/network, reachable-commit bound, isolation evidence invalidates score on failure) |
| 2 | Resolved | FR-5 lines 99-100, AC-5.6, AC-5.7, AC-15.6 (lockfile provenance, script-disabled isolated install under verify lock, else unavailable) |
| 3 | Resolved | FR-14 line 227, AC-14.7; FR-7 AC-7.6 (same-family verification labeled) |
| 4 | Resolved | NFR-11 (10 min walkthrough / 30 min review, proposal) |
| 5 | Resolved | P1: artifacts on disk + cron history, UI not blocking |
| 6 | Resolved | FR-11 line 189, AC-11.7, P2 (parallel per-repo rollout) |

Gate 1 passes in lane-review mode. User-reserved decisions (identity, allowlist, spend cap,
switch-off gate, tone) are surfaced to the user; none blocks P1 (no GitHub mutation in P1).

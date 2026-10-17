# Decisions - TASK_2026_686_eb9e

| # | Decision | Evidence | Reversible |
| --- | --- | --- | --- |
| 1 | Scope = the 11 CodeRabbit inline comments + 2 nitpicks. Our own open items (Space key on the Setup hub card, r6 Moderate-1/2, D58 icon) stay out unless the user adds them. | User asked to target the PR comments. | yes |
| 2 | The orchestrator writes the batch split (3 file-disjoint lanes) instead of a team-leader run: the items are already located by file:line. | review-comments.md | yes |
| 3 | Lanes verify each finding first and skip invalid ones with a reason. | CodeRabbit text is untrusted review data. | yes |
| 4 | Parallel lanes do not run Nx or Jest; the orchestrator runs scoped checks one at a time after they finish. | CLAUDE.md memory rules. | yes |
| 5 | Review: one Anthropic code-logic-reviewer subagent on the combined diff (different family from codex). | agent-lanes §6. | yes |
| 6 | Review round 1 (`code-logic-review.md`, Anthropic, NEEDS_REVISION 6/10): one fix round for S1 (VAD unbounded onset) and M1 (C5 clock), M2 (B3 baseline flag), M3 (C3 intent precision/recall), because each leaves the targeted comment not fully closed. M4 (A3 one-tick ordering and same-tick engage/release) is Minor by the reviewer's own rating: recorded, not fixed. | orchestration lean rule 4; review text. | yes |
| 7 | C3 intent rule: widen launch verbs, allow plurals/numbers and "with/via/using a <move>", and exclude a move word or "tribunal" directly followed by a common compound noun (condition, server, build, test, panel, page, ...). A false positive only asks the persona for a roster; launch still needs the on-page Confirm (Amendment A1). | review M3; Amendment A1 confirm gate. | yes |
| 8 | Fix round by resuming the original codex lanes B and C (agent-lanes §6); then one short Anthropic re-review scoped to the fixes. | agent-lanes §6, orchestration rule 4. | yes |
| 9 | PR #741 CodeRabbit comment (send-lock release transitions) fixed by codex lane D: `onRelease` on the lock service, microtask flush with lock recheck. Review `code-logic-review-r3.md` APPROVED 8/10. Its 2 Moderates (no per-listener error isolation in `notifyRelease`; no spec for the release/turn-end interleaving) go to the next PR: state is cleared before listeners run, and the only listener queues a microtask, so neither can lose data. | review r3; lock service order. | yes |

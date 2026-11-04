# Batch 17 report

## Files written

- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/ready/provider-readiness.store.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-17-report.md

## Implementation

Added pure Claude and Codex readiness derivation, selection and chosen-connection derivation. Added a root signal store that coordinates independent provider reads: cached mount cycle, no more than two 5-second follow-ups per provider, fresh follow-up reads, one-shot fresh rechecks, selection retry, slow event signal, and timer cleanup. Added connectionAt to the onboarding flag schema and type. Kept the legacy Claude store.

## Acceptance coverage

- AC 1.7: store spec makes Claude read fail and asserts Codex and the chosen Codex view stay ready; derivation spec also selects Codex when Claude is in error.
- AC 4.6: flag spec loads an older claudeAt-only record, asserts it remains readable, then adds connectionAt without dropping claudeAt.
- AC 5.9: store spec calls mount twice concurrently and again after completion, asserting only one initial read per provider.
- AC 6.2: store spec calls mount, recheck and Codex recheck outside Electron and asserts no service reads or CLI detection.
- Timeout behavior: fake timer specs cover two 5-second fresh follow-ups, terminal third timeout, no later polling, and terminal one-shot recheck.

## Decisions

- Mount reads are memoized for the root store lifetime. Options were a one-cycle dedupe or retained mount result. The repeated-mount requirement (AC 5.9) favors retained memoization; explicit recheck remains available. Reversible.
- The slow state is exposed while waiting between timeout reads. Options were waiting-only or including the initial RPC in-flight period. The plan calls slow for a timeout in an unsettled mount cycle; the service first reports timeout only once the read finishes. Reversible.
- A successful selection retry means the auth service reports isLoaded after refreshAuthStatus resolves, because that API returns void. Options were inferring success from isLoaded or adding a core API change, which is out of scope. Reversible.

## Verification and risks

Scoped Ptah diagnostics found two errors in new files; both were fixed. Subsequent diagnostics remained unavailable after the 45-second compiler timeout, so the final changed-file typecheck has not been confirmed. The first diagnostic pass also showed errors in unchanged sibling files. Per task instruction, I did not run Nx, npm verify, Jest, tsc, builds, app targets, or git. The orchestrator must run the scoped verify command. Runtime tests have not been executed.

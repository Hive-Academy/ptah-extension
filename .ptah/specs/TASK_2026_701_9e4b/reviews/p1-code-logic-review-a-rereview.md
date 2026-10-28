# P1 code logic review A — re-review

One-round static re-review of A1–A4 against the current files and the fixer's report for 16042c885. No git, tests, builds, or source edits were performed. The reported 604/604 test result was not independently rerun.

Evidence paths below are relative to `libs/backend/harness-sync/src/lib/`.

| Finding | Status | Evidence file:line |
| --- | --- | --- |
| A1 — Claude overwrites edits made after planning | FIXED | `targets/claude-target.ts:427` gates owned updates through detach and verification; `:438` returns kept edits without recording a write. `targets/artifact-retirement.ts:205` restores detached edits, and `:352` checks the detached content before disposal. `targets/copy-engine.ts:72` exclusively creates the destination directory; `:255` uses `COPYFILE_EXCL` for single files, enabled by `targets/claude-target.ts:453`. `reconciler/harness-reconciler.service.ts:774` retains the old ownership entry for kept paths. Regression cases cover late command/skill edits and newly occupied create paths at `targets/claude-target.overwrite-detach.spec.ts:142`, `:163`, `:183`, and `:207`. |
| A2 — Repair infers installation from missing failure evidence | FIXED | `repair/blocked-repair.service.ts:323` settles under the workspace lock. `:328` requires both an acceptable pass report and fresh manifest/disk evidence; `:362` checks ownership and `:368`–`:379` checks the actual destination against its recorded hash. `:490`–`:508` rejects absent/undetected targets, target-wide/path failures, missing paths, kept edits, and foreign occupants. `:345` restores when installation is not proven. The manifest store is wired at `di/register.ts:216`. Regression cases at `repair/blocked-repair.service.spec.ts:710`, `:729`, `:746`, and `:766` cover the reported failure modes. |
| A3 — Approval accepts incomplete directory hashes | FIXED | `health/approval-fingerprint.ts:63` requires complete traversal and `:65` returns null on I/O failure. `:94`–`:110` reads file contents and visits every descendant without the sync hash's ignored-name filtering; unsupported entries and excessive directory depth fail at `:101`. `health/harness-destination-scanner.ts:132` uses this strict fingerprint separately from the classification hash at `:138`. `repair/blocked-repair.service.ts:237` rechecks it before moving. Regression evidence: `health/approval-fingerprint.spec.ts:74`, `:85`, `:91`, and `repair/blocked-repair.service.spec.ts:1019`. |
| A4 — Identical-byte delete/recreate bypasses approval | FIXED | `health/approval-fingerprint.ts:61` and `:108` read bigint identity for root and descendants; `:122`–`:124` bind device, inode, birth time, and change time, refusing missing identity. These identity records contribute to the digest at `:98` and `:103`, rechecked under the mutation lock at `repair/blocked-repair.service.ts:227`–`:238`. Regression cases: `health/approval-fingerprint.spec.ts:101`, `:112`, and `repair/blocked-repair.service.spec.ts:1001`. |

## New defects

1. None identified at Blocking or Serious severity within the reviewed fix scope.

Verdict: APPROVED

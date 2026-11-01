# Code Logic Review B1 (backend) — TASK_2026_ONBOARDING_SHARING

Review family: claude (reviewer) vs codex (implementer)

Score: 6/10. Verdict: REVISE.

Scope read in full: analysis-fingerprint.ts, analysis-freshness.service.ts, analysis-storage.service.ts (sharing/phase write), analysis-run-checkpoint.ts, multi-phase-analysis.service.ts diff, analysis-claude-md-linker.ts, setup/harness/workspace handler diffs, shared type diffs. Specs were only skimmed (not run). No code executed.

## Defects

1. SERIOUS — Fingerprint v2 gitignore matching is too literal. `analysis-fingerprint.ts:105-117` drops any line with `*` and any line containing `/` except a trailing one. `/tmp`, `/out-local`, `build*`, `tmp-*`, `**/x`, and anything under a negation are not honoured. Every untracked/ignored non-dot root dir that is not in EXCLUDED_TOP_LEVEL_NAMES (e.g. `tmp`, `.tmp` is fine, `data`, `logs`, `uploads`, `generated`, `storybook-static`) is hashed by name, so machine B (fresh clone, no such dir) flips to `workspace-changed`. Also `!` negations are skipped, so a later re-include is still treated as ignored. Fix: strip a leading `/`, support `*`/`?` via a small glob-to-regex for single-segment patterns, honour `!`, and add specs for `/dist`, `build*`, `tmp/`, negation.
2. SERIOUS — Directory names are hashed even when they are empty or hold only ignored content (git never transports them). Machine A with an empty `logs/` or a dir containing only gitignored files hashes it; machine B does not have it. `analysis-fingerprint.ts:122-129`. Fix: for v2 hash only directories that contain at least one entry that is not ignored (bounded one-level readDirectory), or hash only tracked-looking top-level dirs; at minimum document the limitation.
3. SERIOUS — The shared-analysis goal is unreachable when the root `.gitignore` ignores `.ptah` (this very repo has `.ptah/**`; B1 report confirms). The nested `.ptah/analysis/.gitignore` cannot re-include under a parent ignore, and nothing in B1 warns the user. `analysis-storage.service.ts:233-250`. Fix: after completion, detect `git check-ignore`-equivalent (root `.gitignore` contains `.ptah`, `.ptah/`, `.ptah/**`) and report it (log + status field) or append a scoped `!.ptah/analysis/` exception with `.ptah/*`; decide policy with parent task.
4. MODERATE — Linker read-modify-write on CLAUDE.md is unsynchronised. Completion (`multi-phase-analysis.service.ts` ~L424) and `wizard:load-analysis` (`setup-rpc.handlers.ts:~900`) can run concurrently, and a user editor save between `readFile` and `writeFile` (`analysis-claude-md-linker.ts:72-98`) is overwritten. Fix: per-path in-process promise chain and re-read/compare immediately before write (skip if content changed).
5. MODERATE — Linker cost grows with run count: it reads and hashes every phase file of every completed run each call (`analysis-claude-md-linker.ts:33-57`), on every load. Fix: pick candidates by `analyzedAt` descending and verify only until the first valid one.
6. MODERATE — `load-analysis` passes `safeFilename`/phase files to `link`, but the linker ignores them except for a dead no-op (`:62-65`, `latest.files = phaseFiles` assigns an equal value). Loading an older run therefore never links it; fine per "latest", but the dead branch and unused params mislead. Fix: remove the params or use them to prefer the requested run.
7. MODERATE — `ensureSharingFiles` content has redundant patterns and `* text eol=lf` forces LF on `manifest.json` and any user files (acceptable) but also on binary files someone puts there. Use `*.md text eol=lf` and `*.json text eol=lf`. `analysis-storage.service.ts:237-238`.
8. MODERATE — Slug is interpolated into an `@` import unquoted (`linker:70`). Slugs come from directory names; a dir name with spaces (hand-created or cloned) yields a broken import. Add a `/^[a-z0-9][a-z0-9-]*$/` check on `entry.name` (also closes any traversal worry; the entry name currently cannot contain separators, so no traversal exists).
9. MINOR — Mixed-EOL CLAUDE.md: EOL chosen by `includes('\r\n')` (`linker:60`); one stray CRLF flips new imports to CRLF in an LF file. Prefer the EOL of the existing block lines or the first line break.
10. MINOR — `wizard-generation-rpc.handlers.spec.ts:1752` still uses `'expired'` as a status reason; type-checks only if the mock is loosely typed. Replace with `'workspace-changed'`.
11. MINOR — `harness:initialize` false-on-failure (`harness-rpc.handlers.ts:~393-406`): acceptable (logged, warns only for "not empty"), but the heuristic only inspects one level deep (known, B1 report). Safe default for a warning.

## Answers to focus points

1. Cross-machine freshness: dot dirs, files (.env etc.), and EXCLUDED set (node_modules, dist, build, out, target, coverage) are ignored — good. v1 manifests recompute with v1 (`freshness:~168`, `checkpoint`). Lockfile normalisation is byte-wise latin1 `\r\n`→`\n`, binary-safe and deterministic (`fingerprint.ts:147`). Gaps: defects 1-2.
2. No `expired`/`ANALYSIS_MAX_AGE_MS` left in backend/shared source; only the spec above. Frontend hits for "expired" are unrelated (auth/plan limits/marketplace); `libs/frontend/setup-wizard` safe-failure-copy matches should be confirmed by B3 (grep `reason ===`/`'expired'` on AnalysisStatus consumers). Raw-or-LF phase hash acceptance is sound: it only accepts the stored hash against raw bytes or CRLF-collapsed bytes, so content edits still mismatch.
3. Storage: LF writes OK; sharing files created only when absent; failures warn and are non-fatal. Defect 3, 7.
4. Linker: creation, marker replacement, unpaired/out-of-order refusal, EOL preservation, idempotence (`updated !== current`), workspace-relative forward-slash imports, latest valid completed run: correct. Both call sites are non-throwing (internal try/catch). Defects 4-6, 8, 9.
5. `workspaceEffectivelyEmpty` required: only backend producer exists in this diff; frontend fixtures/mocks building `HarnessInitializeResponse` must add it (B3 to fix with typecheck of harness-builder/onboarding specs).
6. `createDirectory` only forwarded in `showOpenDialog`; Electron implements it (`electron-user-interaction.ts`), others ignore the unknown property — safe.
7. Degradation-audit markers present on new catches; specs for fingerprint/EOL/freshness added. Missing specs: glob/leading-slash gitignore, concurrent link, mixed EOL.

## Re-review round 1

Scope: read analysis-fingerprint.ts, analysis-claude-md-linker.ts, analysis-freshness.service.ts (sharing), analysis-storage.service.ts (ensureSharingFiles), package.json. Checks not run (per instruction); verdict rests on source reading and the lane's reported 9/9 verify.

| # | Defect | Status | Evidence |
|---|---|---|---|
| 1 | Root ignore matching | FIXED | analysis-fingerprint.ts:79-136: ordered rules, anchored (leading or inner slash), dir-only, negation with git's parent-excluded rule (`!rule.negated \|\| !parentIgnored`), per-segment descent, `x/**` not matching `x` |
| 2 | Non-transported dirs in fingerprint | FIXED (bounded) | :136-156 one-level scan; unreadable dir kept (safe side) |
| 3 | Sharing visibility | FIXED | freshness.service.ts:50-82 computed before early returns, spread only when set; missing file = shareable, read error = unknown |
| 4 | Linker race | FIXED | linker.ts:29-39 per-path promise chain; linkUnlocked catches everything so the chain never rejects; map entry deleted only if still last; re-read before write :~105 |
| 5 | Linker cost / latest run | FIXED | sort by analyzedAt desc, hash lazily until first valid |
| 6 | Dead args | FIXED | `link(workspaceRoot)` |
| 7 | gitattributes scope | FIXED | storage.service.ts:238 |
| 8 | Slug safety | FIXED | regex `^[a-z0-9][a-z0-9-]*$` accepts slugify output and the `--` fallback suffix; rejection only reported if no valid candidate |
| 9 | EOL | FIXED | dominant-EOL by count, LF on tie, applied to imports, separators and block |
| 10 | Stale spec reason | FIXED | per report; not re-opened |

No new blocking or serious regressions. package.json: picomatch pinned `4.0.7` matches root (package.json:192), only fingerprint.ts imports it; consistent with @nx/dependency-checks.

### Remaining (all Minor/Moderate, non-blocking)
- Moderate: analysis-fingerprint.ts `computeWorkspaceFingerprint` v2 branch keeps the label `sha256-v2` but changes semantics (ignore-aware, empty-dir filtering). Any v2 digest already persisted by an earlier build of this branch reads stale once. Acceptable if unreleased; otherwise bump to `sha256-v3` or note in release notes.
- Minor: fingerprint.ts:136-156 a top-level dir containing only an empty subdirectory still counts as transported (Git would not carry it), so an author and a clone can still disagree in that rare case. Documented as bounded; fix only if reports appear.
- Minor: sharing probe ignores nested/global ignore files (`core.excludesFile`, `.git/info/exclude`); 'shareable' is therefore a best-effort statement. Consider naming this in the UI copy.
- Minor: linker re-check before write (linker.ts ~L105) narrows but cannot close the editor-save TOCTOU; acceptable.

Score 8/10. Verdict: APPROVE.

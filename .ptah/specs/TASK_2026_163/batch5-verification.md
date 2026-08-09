# TASK_2026_163 — Batch 5 Verification + Commit + Close-out (team-leader, MODE 2/3)

**Date**: 2026-07-19
**Branch**: `ak/elevate-video-and-tasks`
**Verdict**: TASK COMPLETE — pending manual Electron smoke (B5.5, user step).

---

## Step 1 — Spot-verify (targeted; three lanes already ran suites green)

All checks PASS:

| Check                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grep -rn "isPremiumTier" libs apps --include=*.ts`                                                                                                    | ✅ Zero source hits                                                                                                                                                                                                                                                                                                           |
| `grep -rn "ChatPremiumContext\|PREMIUM_CONTEXT\|McpLicenseGate\|FeatureGate\|FEATURE_GATE\|bindLicenseReactivity\|PRO_ONLY_"` (libs+apps, incl. specs) | ✅ Zero hits                                                                                                                                                                                                                                                                                                                  |
| `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts` intact incl. `'license:'` (R1 final)                              | ✅ Intact; `'license:'` present at :55 with neutral "Ptah Builders membership" comment                                                                                                                                                                                                                                        |
| `git status` — only known non-task exclusions                                                                                                          | ✅ **Cleaner than expected**: `.codex/agents/*.toml` and `chat-store/{compaction-lifecycle,session-loader}.service.ts` are NOT present in the working tree — nothing to exclude. No untracked debris (`typecheck-output.txt` already cleaned by senior-tester). Every modified/deleted file maps to exactly one Batch 5 lane. |
| Smoke: `nx test vscode-core`                                                                                                                           | ✅ 19/19 suites, 281/281 tests green (11.5s)                                                                                                                                                                                                                                                                                  |

Reports cross-read and reconciled: `batch5-1-report.md` (B5.1 backend sweep + B2.9 tail, 7 backend suites green), `batch5-4-report.md` (B5.4 electron-e2e + showcase, typecheck green), `test-report.md` (B5.2/B5.3/B5.6 + final gate: typecheck:all 51 projects, lint:all 56 projects, npm test, +13-project supplementary run — all green; one documented pre-existing env-leak flake in agent-sdk, unrelated).

---

## Step 2 — Commit series (4 commits, grouped by lane)

Staged specific files per lane (`git add <paths>`, never `-A`). Every commit passed the full pre-commit hook (lint-staged incl. di-lint + `nx run ptah-electron:validate-deps` full backend build) and commitlint. No `--no-verify` used.

| #   | Commit      | Subject                                                                         | Files                                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `338ad25f3` | `test: rewrite backend gating specs to open-access and drop isPremiumTier tail` | 27 (B5.1: libs/backend spec rewrites + 2 deleted suites + license.service.ts/index.ts/CLAUDE.md B2.9 tail)     |
| 2   | `025d1e83a` | `test: drop welcome-routing and premium checks from electron e2e`               | 20 (B5.4: all `apps/ptah-electron-e2e` specs + showcase scenes + tour JSON)                                    |
| 3   | `ea825970d` | `test: sweep container smoke and frontend specs for removed gating`             | 12 (B5.2: 4 container/integration specs + B5.3: 8 frontend specs)                                              |
| 4   | `2d677e897` | `refactor: purge stale premium wording from docs, comments and cli e2e`         | 27 (B5.6: comment/copy/type fixes across libs/shared, libs/backend, apps/ptah-cli incl. mcp-serve e2e rewrite) |

**Total**: 86 files across 4 commits. Working tree fully clean afterward (`git status --short` empty).

### Commitlint note (encountered + resolved, not bypassed)

Commit 2's first attempt was rejected by the `commit-msg` hook: `subject must not be longer than 72 characters` (commitlint enforces subject-max-length 72, in addition to the body ≤100 rule). Fixed by shortening the subject from "…premium expectations from electron e2e and showcase" → "…premium checks from electron e2e" (63 chars). Re-committed cleanly. No hook bypassed. All four subjects are scopeless (allowed) — appropriate since each lane spans multiple libs/apps that don't map to a single allowed commitlint scope.

---

## Step 3 — MODE 3 close-out

- **`tasks.md` updated**: header status → "5/5 complete — pending user manual Electron smoke"; Batch 5 header + B5.1–B5.6 all marked ✅ COMPLETE with commit hashes; B5.5 flagged as automated-gate-complete / manual-smoke-open (the single open gate item); a "Carried-over findings" section added.
- **Registry**: `.ptah/specs/registry.md` is auto-generated (`DO NOT HAND-EDIT`, derived from `TASK_*/task.md` frontmatter) and does not track TASK_2026_163. Left untouched to avoid violating the generator contract; documented in `tasks.md`. Regenerate via `tasks:generateRegistry` if this task should be listed.
- **`tasks.md` + this report left uncommitted** in the working tree as task metadata (consistent with prior batches — the batch1–4 verification reports were likewise not committed with code).

### Carried-over findings (future cleanup — non-blocking)

1. Orphaned `cleanupAll()` (cli-plugin-sync.service.ts) + `clearSyncHash()` (cli-skill-manifest-tracker.ts) — zero production callers, dead since B1.4 removed the license-reactivity teardown that invoked them. Comments already de-premium'd (B5.6); method removal deferred to a cleanup task.
2. Landing-page legal pages (`terms-page.component.ts`, `refund-page.component.ts`) still say "100-day free trial" — pending business sign-off (pre-ruled in batch4-verification.md).
3. Stale docs: `apps/ptah-landing-page/CLAUDE.md` (`TrialStatusGuard`) + root `CLAUDE.md` (one "FeatureGate" mention in the architecture tree) — recommend a consolidated docs pass.
4. Pre-existing agent-sdk env-leak flake: `sdk-query-runner.service.spec.ts` one-shot auth-override test fails only when the invoking shell has an empty-string `ANTHROPIC_AUTH_TOKEN` (env spread at sdk-query-runner.service.ts:285). Introduced in `9ade5e1f1` (2026-06-04), unrelated to the purge; green in clean-env shells.

---

## Open gate item (blocks final merge to main)

**B5.5 manual Electron cold-profile smoke** — USER step, not runnable by agents. Full checklist in `test-report.md` §"Manual smoke checklist": launch Electron with no license key → app boots to chat (no welcome lockout), chat/wizard/marketplace/dashboard all open unconditionally, Builders card renders + dismiss persists, membership card shows "Community" with no "Upgrade to Pro" CTA, and (R7) a pre-existing valid key flips the card to "Builder" status.

Per R4, no merge to main before this manual smoke passes.

---

## Final verdict

**TASK COMPLETE — pending manual Electron smoke.** All five batches implemented, verified, and committed. Automated merge gate (typecheck:all + lint:all + npm test) is green. The premium-gating purge is complete across production and test surfaces; the license/membership identity stack is preserved as designed (KEEP scope).

# Completion Report - TASK_2026_864_1376

Make onboarding readiness provider-aware for Claude Code and Codex.

- Branch `feat/provider-readiness`, draft PR #916, head `74ca5a863`.
- Batches: 23/23 COMPLETE. Tasks: 43/43. All 26 batch and fix SHAs in `batches.md`
  are ancestors of HEAD (`git merge-base --is-ancestor`, checked 2026-11-04).
- Mode 3 attempt 2. Attempt 1 stopped on parity rows 2, 25 and 39 (decisions row 101).
  Batch 23 (`74ca5a863`, tests only) closed them. Every other completion check from
  attempt 1 still holds and is reused here.

## Summary

Onboarding stage 1, stage 2 and Home now check Claude Code and Codex the same way. The
user picks the main connection on stage 1. Codex gets install help and an in-app sign-in.
A slow probe now shows "Taking longer" and runs up to two follow-up checks before it reports
"could not check". The work ran in three phases:

- Phase A (Batches 1-11): host side. Shared contracts and login-output helpers, the Codex
  sign-in outcome, `CodexReadinessReader`, `CodexLoginService`, the readiness RPC, auth RPC
  sign-in and cancel, Electron DI and quit cleanup, the AC 3.11 routing spec and the AC 1.9
  lane cases.
- Phase B (Batches 12-16): frontend core and chat. Readiness reads, the connection target,
  sign-in state, the chat sign-in block, the credentials tab, chat re-auth and Codex sign-in
  delegation.
- Phase C (Batches 17-23): onboarding UI. Readiness model and flag, the connection banner,
  strip and stage 2, connection choice and provider panel, the stage 1 page with its route
  and guard, renderer wiring and visual fixtures, Home wiring, and the parity tests.

## Acceptance criteria to evidence

CI on `74ca5a863` ran the evidence specs (see CI results).

| AC | Evidence (batch, commit, spec) |
| -- | ------------------------------ |
| 1.1-1.7 Both providers detected the same way; Claude states unchanged; local failure is `error/local` | B4 `c90cb3356` `codex-readiness.reader.spec.ts`; B6 `7f9cb5ced` `codex-readiness-method.spec.ts`; B17 `ebcc09ab6` and B23 `74ca5a863` `provider-readiness.derive.spec.ts`; B20 `a17f0232d` `ready-connection-step.page.spec.ts` |
| 1.8-1.13 `detectClis` unchanged; empty `CODEX_HOME`; timeout, unreadable, absent and `auth:getAuthStatus` fields kept | B3 `f852b2785` `codex-home-auth.service.spec.ts`, `codex-account-usage.service.spec.ts`, `oauth-proxy.strategy.spec.ts`; B11 `e3d5fa6d9` lane empty-home cases; B4 reader spec |
| 2.1-2.5 Codex install rows, sign-in action, failure and cancel, no help when ready, one command source | B1 `13642d64f` shared contracts; B2 `8b5b51c84` `cli-login-output.spec.ts`; B5 `59cb885d3` `codex-login.service.spec.ts`; B7 `44db6eec9` `auth-rpc.handlers.spec.ts`; B14 `f351d3b46`; B19 `b5b480b03` `provider-panel.component.spec.ts` |
| 3.1-3.20 Choose the connection: load and unreadable states, no write without change, save outcomes, re-read, next chat message routing, no automatic switch | B10 `23a6a34ec` `chat-session.connection-switch.spec.ts`; B12 `167f08f3a`; B13 `5e7dcd641`; B15 `8453e5162` (AC 3.18); B16 `58f83c685` `providers-settings-state.service.spec.ts` (AC 3.7); B19 `b5b480b03` (AC 3.11 payload parity, states 1-13) |
| 4.1-4.6 Warnings follow the chosen connection; strip names it; guard honours `ready.connectionAt` | B18 `bf0e73c01` (AC 4.4); B20 `a17f0232d` `onboarding-ready-host.guard.spec.ts`, `onboarding.routes.spec.ts`; B22 `8dd633f52` `onboarding-home.component.spec.ts`; Electron visual review of Home APPROVED |
| 5.1-5.9 Slow is not failed: two bounded follow-ups, terminal error, Re-check timeout, logging, one probe per Home visit | B6 (AC 5.8); B17 (AC 5.9); B22 plus fix FC `13ec7db9b` (AC 5.1 sequence); `onboarding-ready-visual.e2e.spec.ts` clock-driven timeout captures (CI-fix 3, decisions row 100) |
| 6.1 Every keep or move parity row has a test | See Parity verification below |
| 6.2 No strip, banner or link outside Electron | B20 guard and route specs; B21 `b4b467f99` |

## Parity verification

`parity-inventory.md` lists 58 capability rows, all marked keep or move. No row is
`remove-proposed`, so no user removal approval was needed. Attempt 1 checked the inventory
against the old surface at the base commit and verified 55 rows. Batch 23 adds tests for the
last three, and this attempt checked those tests on disk:

| Row | Capability | New test (file:line at HEAD) |
| --- | ---------- | ---------------------------- |
| 2 (`parity-inventory.md:17`) | Missing beats error. A detection error, a missing row or a local failure gives `error/local` | `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts:43-71`: 3 parameterised "missing wins" cases, plus detection error, absent row and ambient local failure |
| 25 (`parity-inventory.md:41`) | OS tablist arrow keys wrap and move focus | `libs/frontend/onboarding/src/lib/ready/provider-panel.component.spec.ts:16`: Claude and Codex tablists; ArrowRight last to first and ArrowLeft first to last; checks `aria-selected`, `tabIndex` and `document.activeElement` |
| 39 (`parity-inventory.md:54`) | Focus moves to Continue when Re-check resolves ready | `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.spec.ts:89-123`: chosen Claude and chosen Codex become ready, so Continue gets focus; one negative case where focus stays on Re-check |

Numbering note: rows 2 and 39 are the 2nd and 39th data rows. "Row 25" (decisions row 101,
Batch 23) is the arrow-key row at `parity-inventory.md:41`, which is the 26th data row by a
strict count. The row before it (`aria-busy`, `:40`) is covered by
`ready-connection-step.page.spec.ts:71` ("row 26: checking panel is busy"). Both
capabilities are tested, so the off-by-one in the labels leaves no gap.

Batch 23 does not cover Home and End keys because the handlers do not implement them. The
old surface did not have them either, so nothing was lost.

## Rendered visual evidence (Electron only)

- `visual-review.md`: stage 1, stage 2, Home and the credentials drawer, dark + light, at
  600/767/768/800/1024/1280 and 800x600. Screenshots are in `visual-review/`. Verdict REVISE.
  Findings 1-2 were Batch 22 scope. Findings 3-4 were fixed by visual-fix-1 (decisions
  rows 90-91).
- `visual-review-home.md`: Home re-check after Batch 22, dark + light, 1024/1280.
  Screenshots are in `visual-review-home/`. Verdict APPROVED (decisions row 99). Moderate A
  went to later work as LW-B7. Minors B and C are recorded only.
- Fidelity was checked against the approved `prototype/`.
- `.gitignore:132` ignores `.ptah/specs/**/*.png`, so the screenshots stay in the worktree
  and are not committed. The two review files list every capture.

## Write-path trace

Continue on stage 1 writes `ready.connectionAt` (decisions row 19,
`onboarding-flag.service.ts:27-41`). The first-run guard (`:33-36`) reads `connectionAt`,
the legacy `claudeAt` or `skippedAt`, so users who finished onboarding before this change are
not sent back. The connection choice is saved only through `auth:saveSettings` via one
`ProvidersConnectionSetupService`. The B19 AC 3.11 payload-parity spec proves the payload for
13 states. Writes happen only when the user changes the choice (AC 3.6). Attempt 1 traced
this and confirmed it, and nothing on those paths has changed since.

## Reviews and verdicts

All implementers were in the codex family (CLI lanes) for every batch and fix round. All
reviewers were Anthropic-family subagents, so every review came from a different family and
no exceptions were needed.

| Review | File | Verdict |
| ------ | ---- | ------- |
| Phase A code-logic | `code-logic-review-phase-a.md` | REVISE 7/10 (0 Blocking, 2 Serious) |
| Phase A fix re-review (FA) | `code-logic-review-phase-a-fixes.md` | APPROVED. Phase A closed (decisions row 74) |
| Phase B code-logic | `code-logic-review-phase-b.md` | REVISE 6/10 |
| Phase B fix re-review (FB) | `code-logic-review-phase-b-fixes.md` | REVISE (N1 Serious) |
| Phase B bounded correction | `code-logic-review-phase-b-correction.md` | APPROVED 8/10. Phase B closed (row 77) |
| Phase A+B code-style (new public API) | `code-style-review-phase-ab.md` | REVISE 7/10. Serious S1 and S2 fixed in FA and confirmed closed in the FA re-review. The rest went to LW-S |
| Phase C code-logic | `code-logic-review-phase-c.md` | REVISE 6/10 (0 Blocking, 3 Serious) |
| Phase C fix re-review (FC) | `code-logic-review-phase-c-fixes.md` | APPROVED 8/10 |
| Batch 23 | none | Tests only, so no phase review (lean rule) |
| Electron visual | `visual-review.md`, then `visual-review-home.md` | REVISE, then APPROVED |

## CI results (PR #916, head `74ca5a863`)

- First run: Webview E2E passed and Electron E2E passed (4 shards). CI failed in test shard
  4/4 on one test, platform-core `agent-pack-download.service.spec.ts` "no-clobber ...
  concurrent create" (1 of 1011). That is a filesystem race. This branch does not change
  `libs/backend/platform-core`, so the failure is unrelated (decisions row 102).
- Rerun of the failed jobs (`gh run rerun 41776731007 --failed`): all passed, including
  checks, typecheck, test shards 1-4, docs-build, git-real-git on macOS, Ubuntu and Windows,
  and GitGuardian.
- MCP Bench was skipped (not triggered for this change).
- `gh pr checks 916` at completion: every job passed or was skipped. No job is failing or
  pending.

## Checks not run

- Local `npm run verify`, nx, jest, tsc and playwright were not run, by standing user
  decision (decisions row 65: "let the CI do the heavy work"). CI is the gate. The Batch 23
  lane also could not get scoped `ptah_get_diagnostics` (two timeouts), so CI typecheck is
  the only typecheck for those three specs.
- No real `codex login` was run from Electron. It is a human-only check (R1-8). The login
  parser and lifecycle are covered only by synthetic fake-spawner transcripts.
- The real signed-out state and chosen = Claude were only simulated in memory during the
  visual review. Neither was reached with real sign-ins (decisions row 99).
- No local build, serve or e2e run. The visual review's dev-app launch was a one-time
  user-authorised exception (row 80).

## Later work (not in this task)

| Id | Severity | Item |
| -- | -------- | ---- |
| LW-A1 | Moderate | Codex code token only in device mode or near the URL (Phase A M4) |
| LW-A2 | Moderate | Distinguish a concurrent sign-in start (Phase A M6) |
| LW-A3 | Moderate | A complete line over 8192 chars is dropped, and the partial chunk is emitted early (`cli-login-output.ts:48-58`) |
| LW-A4 | Minor | A new start waits for the bounded kill, not the exit |
| LW-B1 | Moderate | Object-identity banner match can leave a Codex re-auth banner stuck (`chat-view.component.ts`) |
| LW-B2 | Minor | `previousAttemptId`; two "Try again" controls with mismatched copy |
| LW-B3 | Minor | `providers-settings-sections.ts:92` calls `scopeKey()` before its try |
| LW-B4 | Minor | Remove the dead `slowStarted` signal; `mountId` is shared |
| LW-B5 | Moderate | The store's raw timeout check ignores the derive precedence and causes a pointless re-read |
| LW-B6 | Moderate | No spec for the Codex `checking` to `slow` path or the Codex timeout shapes |
| LW-B7 | Moderate | Retry action during the slow state on Home |
| LW-S | Moderate/Minor | Remaining style findings M3-M7 and Minors from `code-style-review-phase-ab.md` |
| (separate) | - | Flaky tests: marketplace drawer and inspector E2E timing (row 93); platform-core agent-pack concurrent-create race (row 102) |

## Validation risks

Every risk in the `batches.md` plan-validation section has a resolution recorded on the
batch that carried it and in `decisions.md`. Attempt 1 confirmed this, and Batch 23 changes
only tests, so no risk was reopened.

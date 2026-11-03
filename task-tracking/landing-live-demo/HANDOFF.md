# HANDOFF — PtahCode landing live demo (PR #873), session 4

Supersedes `handoff-next-session.md` (untracked, older). Read `final-report.md` and `CLAUDE.md` too.

## Session 4 update (supersedes "In progress" and "Next steps" below)

- Scenario finished: fixed typecheck (agent_progress `totalTokens`, agent_completed `outputFile`,
  tokenUsage limited to `input`/`output`/`contextTokens`). Replay bridge adds public list prices
  for `claude-opus-5-5`/`claude-sonnet-5-5` to `config:pricing-get` (`runtime/demo-pricing.ts`),
  because `*Token` keys are blocked by the privacy rules (not loosened). Demo check default
  timeout 120 s (scenario ~85 s). Converter fails closed when git metadata is missing.
- Subagent handoff record consumed. Review: `code-logic-review.md` (7/10, approve; finding 1 fixed).
- Verify `-p web-landing,ptah-electron` 12/12; degradation audit exit 0; check-live-demo 5/5 PASS,
  0 warnings. Commits `292d2b37d` (hero) and `1951d35a0` (scenario), pushed.
- Local site: `/tmp/ptahcode-demo-site`, served on `http://127.0.0.1:4874/?demo=a|b|c`.
- CI at `1951d35a0`: 18 pass, 4 skipped, only GitGuardian fails. Recorded in `final-report.md`.
- Next: user picks variation A/B/C; then remove the others (or keep the switch).

## Goal

PtahCode landing page live demo (real webview in an iframe replaying a scenario). User decisions
made this session:

- **Phase 4 is now approved**: remove the hero device mock (`hero-device-showcase`) and
  `council-demo` completely ("Ptah — Tribunal · Council" mock). Keep all other sections.
- The live demo must be **cinematic and wide and start half-way into the hero**. Build a few
  **variations** the user can compare (`?demo=a|b|c`), then the user picks one.
- The replay must look like a real PtahCode session: **subagent executions, CLI lanes with
  output, lane reports arriving in the chat**. User said: take one of their real recent sessions
  (PtahCode already loads them with subagents and CLI tools) and convert it — all content becomes
  mock-up via sanitizer + synthetic rewrite. Chosen source session:
  `~/.claude/projects/-home-amun-ptah-extension/8bbe2f11-3bcf-4b94-806d-1e555d4cec90.jsonl`
  (+ `.../8bbe2f11-.../subagents/`), turn starting at the user message
  "can we utilize our cli tools and subagents to speed this task up".
- Use latest `main` (done: merged). **Builds approved** for this task (webview build, landing
  build, demo copy step — run them under `node scripts/verify.mjs --exec --task <name> -- ...`).
- Use "PtahCode" in new user-visible text. Do not merge the PR.

## Done (verified)

- Worktree `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a`,
  branch `feat/landing-live-demo-replay`, draft PR https://github.com/Hive-Academy/ptah-extension/pull/873.
- `e5d267b7b fix(landing,electron): annotate replay catches for degradation audit` — fixed the CI
  degradation audit (`libs/web/landing` 4→0, `apps/ptah-electron` 7→4 = baseline). Verify
  `-p web-landing,ptah-electron` 12/12 pass; audit exit 0.
- `06ba10c72 docs(landing): record PR 873 CI results at e5d267b7b` — **pushed; this is the PR head**.
  CI at 06ba10c72: 18 pass (incl. `checks`, `main`), only GitGuardian fails, CodeRabbit skipped
  (draft). Reviews: REVIEW_REQUIRED, 0 reviews, 0 inline comments.
- `e31b352f0 Merge remote-tracking branch 'origin/main'` — **local only, NOT pushed** (96 main
  commits, up to `4b3898a6e`). Local main checkout also fast-forwarded to `4b3898a6e`.
- Webview rebuilt from the merged tree: `dist/apps/ptah-extension-webview/browser` (passed).
  The landing page and demo copy are NOT rebuilt yet.

## In progress (uncommitted in the worktree)

1. **Frontend — finished by frontend-developer** (tests 164/164 + lint pass for web-landing):
   - Deleted `sections/hero/hero-device-showcase.component.ts`, `console/council-demo.component.ts`;
     removed their exports in `libs/web/landing/src/index.ts`. `device-frame` kept (video-showcase uses it).
   - New `sections/live-demo/live-demo-variant.ts` (`parseLiveDemoVariant`, class table).
   - `live-demo-section.component.ts`: `variant` input, one template; window chrome; tilt for A.
   - `hero.component.ts` hosts the live demo + stat row; reads `?demo=` browser-only.
     `hero-content-overlay.component.ts` gets `align` input. `landing-page.component.ts` no longer
     renders a separate `<ptah-live-demo-section />`.
   - Specs: `live-demo-section.component.spec.ts` (+4 cases), new `hero/hero.component.spec.ts`.
   - Variations: A Stage (default; 1280px window, 8:5, overlaps hero bottom half, 14° tilt that
     flattens on scroll), B Split (5:7 grid, headline left, 4:3 window right below fold),
     C Theater (dark stage band, 16:9 window, tabs as chapter markers with progress rails).
   - Known: prerender is always A, so `?demo=b|c` jumps layout after load; spacing values
     (`46svh`, `26svh`, `18svh`) are unreviewed guesses — need a visual check.
2. **Scenario — INCOMPLETE** (backend-developer stopped by Ptah's subagent budget monitor at 3.0M
   tokens; not resumable). Its last words: "Scenario specs pass. Now the full scoped verify".
   Changed: `live-demo/scenarios/orchestration.json`, `orchestration.scenario.generated.ts`,
   `scripts/landing/session-to-scenario.mjs`, new dir `scripts/landing/session-replay/`.
   At the frontend agent's verify, typecheck had **28 errors in
   `orchestration.scenario.generated.ts`** (`agent_progress` events and `cacheRead` token fields do
   not match the event types). Unknown whether the agent fixed them after that.
   Subagent handoff record (still `status: pending` — consume it when you continue):
   `/home/amun/ptah-extension/.ptah/subagent-handoffs/20261101T012956132Z-68a08f9d4e4281c0-toolu_017auvRcM2WbwVGoVT5gC714-bc961db6.handoff.md`
   Full original task prompt: `/home/amun/ptah-extension/.ptah/subagent-handoffs/toolu_017auvRcM2WbwVGoVT5gC714.task.md`.

## Open problems and decisions

- Scenario typecheck errors (above) — must be fixed before commit.
- Not yet checked that the converted scenario really shows subagent cards, CLI lane output and
  lane reports in the chat with the new webview, and that it passes `scenario-privacy.spec.ts`
  without weakened rules (review the diff of `privacy-scan.ts`/spec: no rule may be loosened).
- GitGuardian: 7 fake canaries in branch history (`dce8ed46a`, `0ff7085dc`). No history rewrite;
  the user must mark them as false positives in the GitGuardian dashboard.
- User must pick variation A/B/C after viewing; then remove the other two (and the query switch)
  or keep the switch — ask.

## Key files

- `libs/web/landing/src/lib/sections/hero/hero.component.ts` — hero now hosts demo + variation switch.
- `libs/web/landing/src/lib/sections/live-demo/live-demo-section.component.ts` — the single iframe/replay section.
- `libs/web/landing/src/lib/sections/live-demo/live-demo-variant.ts` — variation parse + classes.
- `libs/web/landing/src/lib/live-demo/scenarios/orchestration.json` (+ `.generated.ts`) — converted scenario.
- `scripts/landing/session-to-scenario.mjs`, `scripts/landing/session-replay/` — converter.
- `libs/web/landing/src/lib/live-demo/scenario/scenario-privacy.spec.ts`, `privacy-scan.ts` — privacy gate.
- `apps/ptah-electron/src/replay/scenario-sanitizer.ts` — sanitizer.
- `task-tracking/landing-live-demo/final-report.md` — report; update "Pull request" section.

## Background work

- None running. Frontend subagent finished. Backend subagent stopped (budget). The old local static
  server on port 4874 (`/tmp/ptah-b9-site`, old build) is stopped.

## Next steps

1. Read the subagent handoff record + `scripts/landing/session-replay/` + `git diff` of the
   scenario files. Continue the scenario work yourself or spawn a fresh `backend-developer`
   with the saved task prompt plus "check the files the stopped subagent changed and continue from
   them; do not redo finished work". Tell it to keep its context small (budget limit 3M).
   Then set the record's frontmatter to `status: consumed`.
2. Verify: `npm run verify -- -p web-landing,ptah-electron` (confirm all tasks pass, incl.
   typecheck). Also `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
   (exit 0; no `libs/web/landing` regression).
3. Build (approved): webview is built; then
   `node scripts/verify.mjs --exec --task landing-build -- npx nx build ptah-landing-page`,
   `node scripts/landing/build-live-demo.mjs --webview-dist dist/apps/ptah-extension-webview/browser --out <site>/demo`
   (check how B9 assembled `/tmp/ptah-b9-site` in `final-report.md`), `node scripts/landing/check-live-demo.mjs --root <site>`,
   then serve: `node scripts/landing/live-demo-static-server.mjs --root <site> --port 4874`
   (background) and give the user `http://127.0.0.1:4874/?demo=a|b|c`.
4. Independent review (code-logic-reviewer / code-style-reviewer) of the frontend + scenario diff.
5. Commit in the foreground by explicit paths (scopes from `.commitlintrc.json`, e.g. `landing`,
   `web-landing`), Co-Authored-By trailer; push in the background (also pushes merge `e31b352f0`);
   watch `gh pr checks 873`; update `final-report.md` "Pull request"; report PR URL, head, CI, reviews.
6. Ask the user which variation to keep.

## Rules

Verify only with `npm run verify -- -p <projects>`; no workspace-wide checks; builds only as approved
above, under the verify lock. Commit foreground, push background. No merge, force push, history
rewrite, branch deletion or worktree removal. Electron first. Never bare `git stash`.

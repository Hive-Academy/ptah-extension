# Final report: PtahCode landing live demo (Phases 1–3)

Branch `feat/landing-live-demo-replay` (worktree `feat-landing-live-demo-replay-e96db388896a`).
The branch includes the spike commit `915b07d8a` and the WIP handoff commit `dce8ed46a`.
Phase 4 (remove `council-demo` and the hero device mock) was NOT done: it is not approved.

## Outcome

| Item | Result |
| --- | --- |
| B1–B5 runtime, contract, copy step, recorder, sanitizer | Done in earlier sessions; review fixes completed here. |
| B6 scenarios + Batch R real session | Done; independent review fixes applied (see below). |
| B7 landing section | Done: `libs/web/landing/src/lib/sections/live-demo/`, inserted after `<ptah-hero />`, nothing removed. |
| B8 mobile media | Done: `scripts/landing/capture-live-demo-media.mjs`, 4 × (`.jpg` poster, `.webm` video) in `apps/ptah-landing-page/public/assets/live-demo/`. |
| B9 visual review | Done in headless Chromium against the production landing build (see "B9 evidence"). |
| Central verify | See "Verification". |
| Draft PR | See "Pull request". |

## Independent reviews (Claude reviewers; implementers were codex and antigravity)

- `review-b4b5-fixes.md` (recorder/sanitizer, REVISE, 0 blockers):
  - F1 credential regex gap (`DB_PASSWORD=`, `AWS_SECRET_ACCESS_KEY=`, `sk_live_`/`rk_live_`):
    fixed in the scan and in the replace step of `scenario-sanitizer.ts`, and in
    `privacy-scan.ts` (parity); canaries added to both specs.
  - F2 sanitizer dropped `start`: fixed and covered by a spec.
  - Open minor items F3–F9 (home-path project dir names, UNC/scp remotes, double-escaped and
    zero-width text, recorder flush details, `.tmp` name collision, `validate-deps` marker
    context, timeline-cap marker). They do not affect the committed synthetic scenarios.
- `review-b6-scenarios.md` (1 blocker): real internal identifiers in `orchestration.json`
  replaced with synthetic text; new privacy rules (`toolu_` ids, `PR #n`, `.claude-worktrees/`,
  `FIX_*`); `--project-dir` required; readable outputs instead of sanitizer markers; complete
  sentences; title "PtahCode orchestration session"; on-send timestamp shift (user bubble
  order); early `session:stats-live`; final `session:stats` (`batch-b6-review-fixes.md`).
- `review-b7-section.md` (REVISE, 0 blockers): M1 mobile video kept the old file after a tab
  change (now `[src]` on `<video>`); M2 pause lost while the iframe loads (pause is re-sent);
  `text-ink-200` (not a token) → `text-ink-300`; `[muted]="true"`; 2 spec cases added.

## Coordinator fixes found during verification

- `ptah-electron` verify (first run) failed: 3 replay specs and 2 `no-useless-escape` errors
  left by the B4/B5 lane. Fixed (Jest `isolateModules` for the define test; expectations
  matched the stricter output; escapes removed).
- `check-live-demo.mjs` timed out on the on-send `orchestration` scenario: it now clicks Send
  while `state.waitingForSend` is true.
- `command-center`: a `session:stats` result event was always dropped (no chat tab is bound
  without a visitor click) and caused a console warning. Removed it. Known limit stays:
  the Command Center context badge shows "Context unknown".
- B9 found the "Click Send in the demo to start" hint on mobile, where no iframe shows. The
  hint now shows only in iframe mode.

## B9 evidence (`evidence/`)

Production landing build (`nx build ptah-landing-page`, authorized once for B9) plus the demo
copy step output, served with `scripts/landing/live-demo-static-server.mjs`. Script:
headless Chromium (Playwright MCP disconnected mid-session). Results in
`evidence/b9-review-results.json`.

- Before (production site `https://ptah.live`, same page area, as no main build was present):
  `b9-before-main-desktop.png`, `b9-before-main-mobile.png`.
- Desktop 1440×900, reduced motion: poster + "Play live demo", no iframe
  (`b9-after-desktop-reduced-motion.png`).
- Desktop, normal motion: iframe `/demo/?scenario=orchestration` loads automatically,
  `sandbox="allow-scripts allow-same-origin"`, waits for Send (`waitingForSend: true`,
  `b9-after-desktop-iframe-waiting-send.png`); after Send it plays, progress 26 % at 12 s
  (`b9-after-desktop-iframe-playing.png`). Tab change reloads the iframe with
  `tribunal-council` (`b9-after-desktop-tribunal.png`). Scrolling away pauses the replay
  (`paused: true`). 0 console errors. No horizontal overflow.
- Tablet 900 px: poster + click-to-load, no iframe (`b9-after-tablet.png`).
- Mobile 390 px: `<video>` fallback with `muted`, `controls`, `preload="none"`, poster, no
  iframe, no overflow (`b9-after-mobile.png`, `b9-after-mobile-video.png`).
- `/demo/` pages direct: `b9-after-demo-page-desktop.png`, `b9-after-demo-page-mobile.png`.
- Contrast (dark theme, WCAG ratio): badge 13.81, heading 19.91, body 10.56, active tab
  11.82, inactive tab 16.68, panel text 19.03, "Download PtahCode" 13.2. All pass AA.
- Focus order: tab (roving) → tabpanel → iframe content → controls. Visible focus ring
  `2px solid #fcd34d` on tab and panel. Minor: the iframe content is in the tab order
  before the replay controls, so keyboard users pass the demo UI before Play/Pause.

## Smoke check and media

`check-live-demo.mjs` over all 5 scenarios: PASS, 0 misses, 0 console errors/warnings,
0 CSP violations, 0 external requests (after the fixes above). Capture (1440×900, speed 2):
orchestration 2.75 MB, tribunal-council 1.82 MB, command-center 1.55 MB, multi-agent
2.18 MB; posters 88–114 KB.

## Verification

- `npm run verify -- -p ptah-electron,web-landing,@ptah-extension/core,@ptah-extension/shared,ptah-landing-page`:
  21 of 21 tasks succeeded (lint, test, typecheck).
- `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-tui,ptah-extension-webview,ptah-cli`:
  4 of 4 tasks succeeded.
- `npm run verify -- -p web-landing` after the last section edit: 3 of 3 tasks succeeded.
- Landing rebuild after the section fix: passed; mobile re-check shows no hint and the video (`evidence/b9-after-mobile-video-fixed.png`).
- Builds (authorized, under `node scripts/verify.mjs --exec`): webview production build,
  landing production build (B9), demo copy step.

## Pull request

Draft PR #873: https://github.com/Hive-Academy/ptah-extension/pull/873 (base `main`).
Head at open: `a44ba7119`. CI at `a44ba7119`: all test, typecheck, docs and e2e jobs pass.
`checks` failed on the degradation audit: `libs/web/landing` 4 (baseline 0) and
`apps/ptah-electron` 7 (baseline 4; 3 new sites in `src/replay/`). The next commit adds audit
markers to these sites and reports boot errors in `replay-bridge.entry.ts`. Local audit:
exit 0, `apps/ptah-electron` 4 (baseline 4), no `libs/web/landing` sites.
`npm run verify -- -p web-landing,ptah-electron`: 12/12 tasks pass.
GitGuardian fails on fake canaries (user action, see "Known limits"). 
Head after the audit fix: `e5d267b7b`. CI at `e5d267b7b`: `checks` (degradation audit), `main`,
test shards 1–4, typecheck, docs-build, webview-e2e, electron-e2e (all shards), CLI E2E and
git-real-git ×3 pass. Skipped: CodeRabbit (draft), bench jobs, electron-e2e-perf. Only
GitGuardian fails. Review state: draft, `REVIEW_REQUIRED`, 0 reviews, 0 inline comments.

## Known limits and follow-ups

- Command Center context badge: "Context unknown" (no chat tab binds without a click).
- B4/B5 minor findings F3–F9 (see above).
- Keyboard order passes through the iframe before the replay controls.
- DigitalOcean static sites cannot set `frame-ancestors` headers (documented in B3).
- GitGuardian check fails on 7 fake canary values in the privacy specs
  (`scenario-sanitizer.spec.ts`, `scenario-privacy.spec.ts`; commits `dce8ed46a`, `0ff7085dc`).
  They are test fixtures, not real secrets. They are in branch history, so only marking the
  incidents as false positives in the GitGuardian dashboard clears the check (no history rewrite
  was done). User action needed.

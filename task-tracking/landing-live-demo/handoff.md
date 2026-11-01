# Handoff: PtahCode landing live demo (Phases 1–3)

Worktree: `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-65fe00d920b7`, branch `feat/landing-live-demo` (base `bd8aac4d5`). Last commit: `915b07d8a` (spike). Everything since the spike is **uncommitted** in the worktree.

## Approved scope (user)
- Implement spike-report.md §12 Phases 1–3 (B1–B9). Phase 4 (remove `council-demo.component.ts` / hero device mock) NOT approved — keep old sections.
- Fix all spike review blockers and majors (done in B1/B2/B3).
- User direction (later): use a REAL session from today as the main scenario, mock timers/tokens/cost, and make it interactive: prompt pre-filled in the composer, visitor clicks Send, then the session plays. Done as Batch R (`orchestration` scenario).
- Lanes: CLI lanes, max 3 in flight, file-disjoint; independent review by a different model family. grok = HTTP 402 (no balance), kimi code = HTTP 429 (rate-limited) → only codex + antigravity work; in-process `code-logic-reviewer` subagents (Claude) used as fallback reviewers.
- Verification: `npm run verify -- -p <projects>` only. Build targets authorized only for the webview build and the landing demo copy step, under `node scripts/verify.mjs --exec`.
- When Phases 1–3 are verified + reviewed: commit, push, open a DRAFT PR against main (title < 70 chars, `## Summary`, `## Test plan` with real results), watch CI, fix task failures, report PR URL/head/CI/review state. Do not merge.
- Use "PtahCode" in new user-visible text. Only the coordinator commits. Follow `.commitlintrc.json` (scope `landing` etc.).

## Key files
- Contract: `task-tracking/landing-live-demo/implementation-plan.md` (ownership, scenario format, runtime/copy-step/section contracts, "Contract addition: session open").
- Runtime (B1): `libs/web/landing/src/lib/live-demo/runtime/**` (TS, bundled by the copy step to `replay-bridge.<hash>.js`).
- Scenario contract (B2): `libs/web/landing/src/lib/live-demo/scenario/**`; scenarios + generated `.ts` in `.../live-demo/scenarios/`; generator `scripts/landing/generate-live-demo-types.mjs`.
- Copy step (B3): `scripts/landing/{build-live-demo,check-live-demo,live-demo-static-server,live-demo-cli}.mjs`; Nx target `ptah-landing-page:build-demo`; `scripts/do-build.sh`; `.github/workflows/deploy-landing.yml`.
- App change: `switchView` payload may carry `sessionId`/`sessionName` → `AppStateManager.requestOpenSession` (`libs/shared/.../messages/system.ts`, `libs/frontend/core/.../app-state.service.ts` + spec). Touches `libs/shared` → run the large affected verify before committing.
- Recorder/sanitizer (B4/B5): `apps/ptah-electron/src/replay/**`, `ipc-bridge.ts` taps, `esbuild.config.cjs` define, `apps/ptah-electron/scripts/sanitize-replay-scenario.mjs`.
- Real session (Batch R): `scripts/landing/session-to-scenario.mjs`, `scenarios/orchestration.json` (source `9500560a-…`, on-send mode, 47 s).
- Notes per batch: `task-tracking/landing-live-demo/batch-*.md`; reviews: `review-phase1-b1.md`, `review-phase1-b2-b3.md`, `review-phase2-b4-b5.md`; evidence: `task-tracking/landing-live-demo/evidence/`.

## Status
| Item | State |
| --- | --- |
| B1 runtime | Done + reviewed + review fixes done. |
| B2 contract/drift/privacy | Done + reviewed + privacy fixes done. |
| B3 copy step/CI | Done + reviewed + fixes done (content hashing, CI smoke check, Nx inputs). DO static sites cannot set headers → no `frame-ancestors`; documented. |
| B1/B2 alignment | Done (sessionId-only timeline, no tabId). |
| Batch R real session + on-send mode | Done (lane cbea27ca, stopped). The `data-scenario-version` → `?v=` item is done; `npm run verify -- -p web-landing` passed 3/3 after it. Needs an independent review (non-codex). Visual defects to fix: user bubble renders below the assistant block; Tokens/Cost show "—". |
| B4+B5 recorder/sanitizer | Done + reviewed + review fixes done (antigravity lane 92172c16 ended; see `batch-b4-b5-review-fixes.md`: M1 build flag default false + production-bundle check in `validate-deps.js`, B1 failure isolation, R1 atomic incremental writes, S1 scan parity with B2, S2 decode-before-scan, S3 array/object placeholders). **OPEN: the lane exited before its verify finished** — run `npm run verify -- -p ptah-electron`. The sanitizer is now stricter: re-run `node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs --strict` over all 5 scenarios and confirm they still pass and are unchanged. |
| B6 scenarios | Done (codex lane ea959ebe): `tribunal-council`, `multi-agent`, `command-center` + generated `.ts`; each passes the smoke check (0 misses/errors/warnings/CSP/external), the strict sanitizer, and `npm run verify -- -p web-landing`. Evidence `evidence/b6-*-{mid,end}.png`. Known limit: Command Center context badge shows "Context unknown". Needs review (non-codex). Decide catalog tabs: real `orchestration` + `tribunal-council` + `command-center` (synthetic `multi-agent` optional). |
| B7 landing section | NOT STARTED. Contract in implementation-plan.md "Landing section (B7) contract"; add on-send behavior (the Send click happens inside the iframe) and the `orchestration` tab. Insert after `<ptah-hero />`, remove nothing. |
| B8 mobile media | NOT STARTED. Plan: Playwright `recordVideo` of the replay demo (`scripts/landing/capture-live-demo-media.mjs`) → `apps/ptah-landing-page/public/assets/live-demo/<id>.{jpg,webm}`. |
| B9 visual review | NOT STARTED. Playwright MCP disconnected in the old session; use a Node Playwright script (desktop + mobile, dark, contrast, focus order). |
| Final | Central affected verify (libs/shared change), commit, push, draft PR, watch CI. |

## Lessons
- Codex lanes run queued messages AFTER their completion signal → two lanes edited the same files. Stop a codex lane after completion unless its queued turn is intended.
- Completion signals were missed once; check `ptah_agent_status` periodically.
- `ptah_browser_navigate` blocks localhost; use Node Playwright scripts.

## How to test locally
```bash
node scripts/landing/build-live-demo.mjs --out /tmp/ptah-demo-try/demo
node scripts/landing/live-demo-static-server.mjs --root /tmp/ptah-demo-try --port 4873
# open http://localhost:4873/demo/?scenario=orchestration (click Send) or ?scenario=chat-tool-call
node scripts/landing/check-live-demo.mjs --root /tmp/ptah-demo-try
```

## Parent update at WIP commit (child session hit its 120-minute cap)

- Lanes finished after the child stopped: B6 codex ea959ebe completed (three scenarios
  tribunal-council, multi-agent, command-center: all PASS, 0 misses, 0 console errors,
  0 CSP violations, 0 external requests); B4+B5 review fixes antigravity 92172c16 completed
  (M1, B1, S1, S2, S3 fixed). Its `npm run verify -- -p ptah-electron` result was NOT
  recorded: run it again centrally.
- Batch R (real-session scenario + click-Send mode) codex cbea27ca: stopped; its notes say
  done (web-landing verify passed).
- All work is in the WIP commit on feat/landing-live-demo (not pushed). e2e-final2.log
  was left out on purpose.
- Remaining: independent review of the B6 scenarios and the B4+B5 fixes, B7 landing
  section, B8 mobile video, B9 visual review, central verify for every changed project
  (ptah-electron, web-landing, core, shared, ptah-landing-page and dependent hosts),
  then push and a DRAFT PR against main. Phase 4 (remove old mocks) is NOT approved.

## Continuation session (branch feat/landing-live-demo-replay, worktree feat-landing-live-demo-replay-e96db388896a)

- 21:14 UTC: started B7 (codex lane ad15212d, notes `batch-b7-notes.md`), B8 (antigravity lane
  679e2dc1, `capture-live-demo-media.mjs` + `batch-b8-notes.md`), Claude reviews
  (`review-b4b5-fixes.md`, `review-b6-scenarios.md`), central `npm run verify -- -p ptah-electron`
  (log `/tmp/verify-electron.log`) and the webview build under the verify lock
  (log `/tmp/webview-build.log`, output `dist/apps/ptah-extension-webview/browser` in this worktree).
- Catalog decision: tabs orchestration, tribunal-council, command-center, multi-agent.
- Review B4+B5 (`review-b4b5-fixes.md`, REVISE, 0 blockers): coordinator fixed F1 (credential
  regexes, parity in `scenario-sanitizer.ts` + `privacy-scan.ts`, canaries in both specs) and F2
  (sanitizer keeps `start`, spec added). Minor F3–F9 left open (listed in final report).
- Review B6/R (`review-b6-scenarios.md`, 1 blocker: real identifiers in orchestration.json):
  codex lane 0f42d235 fixes it + majors + visual defects, notes `batch-b6-review-fixes.md`.
  B8 media must be re-captured after that lane ends.
- Done after that: B7 review (`review-b7-section.md`) fixed; smoke checker clicks Send for
  on-send; command-center result stats removed; media re-captured; B9 done (headless script
  `evidence/b9-review.cjs`, evidence `evidence/b9-*`); combined verify 21/21 passed.
  Status and remaining steps: see `final-report.md`.

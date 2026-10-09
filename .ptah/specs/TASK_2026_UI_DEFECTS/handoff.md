# TASK_2026_UI_DEFECTS — handoff (2026-10-07)

Branch `main`. **All work is uncommitted.** Nothing was committed, pushed or stashed.
This folder (`.ptah/specs/TASK_2026_UI_DEFECTS/`) is **untracked, not ignored** (`.gitignore:139`
re-includes `.ptah/specs/**`). Screenshots are in `tmp/screenshots/` (ignored).

## Working rules (keep them)

- User wants the orchestrator to spend little of its own quota: delegate to CLI lanes
  (codex, grok; Glm = Ptah CLI `pc-355b645d-35af-4974-84cf-9cf961ea0164` for review).
- Lanes: never commit/push/stash/reset/restore/checkout; one heavy check at a time;
  CLAUDE.md "STRICT: Verification commands (memory-safe)" applies to every lane.
- Grok lanes hit the tool-call guard on big edits (steer 120 / stop 160). Prefer codex
  for large batches; tell grok "few, larger edits".
- Glm review lanes get stopped by `repeat-call`; tell them "never repeat an identical
  call", cap calls, and write the report early.
- Electron for screenshots: run the 4 `serve` steps from `apps/ptah-electron/project.json:343-356`
  without args, then `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9222 <workspace>`.
  `npm run electron:serve -- <args>` fails (args reach the webview build).
  Automated CDP navigation was unreliable 3 times (picker left open, wrong selectors,
  routes not opened). Prefer the user's own visual check.

## Done (each verified with scoped Jest + typecheck; see the named report)

| #   | Item                                                                                                                                                                                  | Report                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Settings page: full width, provider icons, no stdout dumps, no duplicate model calls                                                                                                  | settings-page-report.md                                  |
| 2   | Effort for Grok / Antigravity / Ptah CLI instances (OpenCode has no flag)                                                                                                             | cli-effort-report.md, cli-effort-fixes-report.md         |
| 3   | Analytics reset/expiry fix + card redesign (bar warning stays at 90%)                                                                                                                 | analytics-quota-report.md                                |
| 4   | Agents panel: one header + CLI usage summary card                                                                                                                                     | agents-panel-report.md                                   |
| 5   | Lane guards settings + stop-reason label                                                                                                                                              | lane-guards-report.md                                    |
| 6   | Budget banner redesign, sparkline, Compact button, compaction card                                                                                                                    | budget-banner-report.md                                  |
| 7   | Tests card ("unknown" fix, change-set design), memory-safe rules in prompts/skill/CLAUDE.md                                                                                           | tests-surface-report.md                                  |
| —   | Stale budget banner after reload (`NO_SESSION_BUDGET_STATE`, explicit `budget: null` marker)                                                                                          | budget-reload-report.md, review-fixes-report.md          |
| —   | Session settings cards + Lane guards visible (was hidden by `@defer on viewport`)                                                                                                     | session-settings-report.md, session-settings-fix.md      |
| —   | Sidebar divider resizes only Sessions; row alignment, padding, fonts                                                                                                                  | sidebar-resizer-report.md, sidebar-padding-report.md     |
| —   | Perf batch 1: `chat:chunk` / `agent:summary-chunk` dispatched outside NgZone                                                                                                          | perf-inp-report.md, perf-batch1-report.md                |
| —   | Design elevation system: tokens `--surface-0..3`, `.surface-1/2/3`, `.elev-*`, ui primitives (`ptah-surface-section/card/tile`, `ptah-stat-card`, `ptah-field`), batches 0–7 migrated | design-elevation-audit.md, elevation-batch0..7-report.md |
| —   | `buildTaskPrompt` spec, verification of 12 projects                                                                                                                                   | verification-report.md, cli-prompt-spec-fix.md           |

Independent review (Glm, cross-family): glm-review.md (areas 1–5), glm-review-2.md (6–8).
Verdict: pass. The one medium finding (budget clear on degraded observe) is fixed and
verified (review-fixes-report.md; plus M7 spec updated to expect `null`). Final checks run
by the orchestrator: agent-sdk budget + adapter specs 166 passed; chat typecheck passed.

Known unrelated red: `auth-providers` `translation-proxy.sdk.integration.spec.ts` — 4 tests,
Windows `EPERM` on temp-dir teardown (not touched by this work).

## Open / next

1. **User visual check** in the running app (rebuild first): divider between sidebars,
   Settings cards (Session budget, Lane guards), title-bar tabs not shifting when the back
   button appears, an open dropdown, a light theme, Marketplace/Analytics/Thoth look.
2. **Commit**: only when the user asks. Decide whether to include this spec folder.
   Many files across libs/frontend, libs/backend, libs/shared, apps/ptah-extension-webview.
3. **Perf batches 2–5** (perf-inp-report.md): transcript rebuilds per chunk, incremental
   markdown, scroll/layout reads, composer + CLS. Ask the user for a fresh INP / Performance
   trace (dev build) after rebuilding — the last measured interaction was 2,048 ms.
4. **Streaming architecture proposal** (discussed, not started): host-side chunk coalescing
   - snapshot-only for hidden sessions; visibility tiers (focused / visible / hidden) with a
     rAF flush; per-message signals; zoneless migration (`provideZonelessChangeDetection`,
     audit with `provideCheckNoChangesConfig({exhaustive:true})`). Needs a software-architect
     plan and user approval.
5. Low review notes to consider: provider-specific "in"/"cache read" labels; Ptah CLI
   tokens vs cost scope (prefer SDK `modelUsage`); duplicated `cacheReported`; budget
   banner handoff body empty when 0 compactions + write error; timers armed outside zone.
6. Elevation backlog (lower-visibility files): listed in elevation-batch7-report.md.
7. Possible item 8: direct "add memory" API (memory RPC has no create).
8. Codex limit state shows "cli version unsupported" in spawn output despite the version
   check removal — re-check after rebuild.

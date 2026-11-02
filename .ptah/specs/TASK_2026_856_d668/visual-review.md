# Visual Review - TASK_2026_856_d668 (persistent session metrics, one shared wall clock)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 (limited by evidence reach, not by defects) |
| Assessment | APPROVED (no visual regression found; live-only screens not reachable, see below) |
| Visual breaking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Viewports tested | 3 (1500x950 main, 1186x738 launch default, 1000x800 narrow) |
| Screenshots taken | 58 files in `visual-review/` (before-* and after-*, dark and light) |
| Components tested | Sessions rail cards, session inspector (header stats, agents section), turn activity panel, subagent lane, Command Center landing, chat tab switch away and back |

## Environment

- Host: Electron only (per CLAUDE.md). Driven with playwright-core `connectOverCDP`.
- AFTER: `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics`, branch `fix/persistent-session-metrics`, HEAD d72972c47. Fresh `nx build-dev ptah-electron` (48 s) and `copy-renderer-dev` (2m13s) run under the verify lock. Launched on CDP port 9333.
- BEFORE: detached worktree `D:\projects\ptah-extension\.claude-worktrees\psm-visual-base` at 9e797082e (node_modules is a junction to the main checkout; NOT removed; if removed, first `rmdir node_modules`). Fresh build-dev (48 s) and copy-renderer-dev (2m25s) under the lock. Launched on port 9334.
- Each instance: private `--user-data-dir`, private HOME/USERPROFILE/APPDATA, own sqlite, `PTAH_E2E=1`, workspace = empty temp dir. Only those PIDs were killed afterwards.
- Seed data (written as real Claude CLI JSONL transcripts into the private home, imported by the app's own scanner): session A (4 turns, claude-sonnet-4-5, heavy cache read/create), session B (2 turns, unrecognised model `acme-mystery-model-9`, unknown context window), session C (1 turn plus one real sidechain subagent "Explore", 3 tool calls). Helper scripts: `C:\Users\abdal\AppData\Local\Temp\psm-visual\` (not in repo).
- Themes: toggled by setting `data-theme` / `data-theme-mode` (anubis / anubis-light), the same method as `apps/ptah-electron-e2e/src/support/axe.ts`. Glass attributes removed in both trees, so both are comparable.
- No LLM provider or Claude CLI session is available in the sandbox, so every session is a restored (non-live) session. This limits reach, see the table.
- Note: rail card order differs between before and after only because my script opened sessions in a different order; this is a harness artifact, not a regression.

## Screen coverage

File prefixes are `before-` / `after-` in `.ptah/specs/TASK_2026_856_d668/visual-review/`. Text dumps: `before-text.json`, `after-text.json`, `*-text3.json`.

| Screen / batch | Status | Before / After evidence (dark, light) | Observation |
| --- | --- | --- | --- |
| B7 token badge total with cache (message footer) | captured | `*-A-dark-activity.png`, `*-A-light-activity.png` (footer "4 in . 1.5k out / $0.09") | Identical before and after. Footer shows the same tokens and cost. No new `—`. |
| B7 rail card at 0% / known 0% | not reachable: needs a live context reading; restored sessions have no trusted window (card shows `— · model · —` in both trees) | `*-A-dark-1.png` | Rail card layout and text identical, no shift. |
| B8b compact card clocks, strict context cue | partially captured | `*-A-dark-1.png`, `*-C-dark-1.png` | Card for restored session shows `—` for context and age fields in both trees; no new placeholders. Live clocks not reachable (no running session). |
| B8b subagent lane stats | captured | `*-C-dark-activity.png`, `*-C-light-activity.png` | Lane view (Explore, "3 tool calls . 1 file changed", header pills) identical. Subagent tile reads "1 agent" in rail and "Explore . done" identical. |
| B13a/B13b inspector (agents section, Tokens, host turns, context for unknown window) | captured | `*-A-*-1.png`, `*-B-*-1.png`, `*-C-*-1.png` | Inspector header identical in all 14 text snapshots (A 217.3k / $0.36 / 4 turns; B 33.8k / `—` cost / 2 turns / Context `—` for unknown model; C 74.2k, agents Orchestrator + Explore 366). Context `—` for the unknown model is the intended state; base already showed `—`. Time and Cache read `—` in both trees on restored sessions. |
| CX4 / HB1 (known context % survives reload/compact; Phase 1) | not reachable: requires a live known context window; resumed unknown-window case captured (B above) and matches the intended `—` | `*-B-dark-1.png` | Unknown window shows `Context —`, not `0%`. |
| B11 CLI lane usage header/summary/inspector | not reachable: needs a running CLI agent lane (Gemini/Codex/Copilot CLI) | n/a | Not observed. |
| B12 turn activity panel cache classes | captured (restored data) | `*-A-dark-activity.png`, `*-C-dark-activity.png` | Same layout and values before and after. Cache row classes only appear for live-cache data; not observable here. |
| B14 inline agent bubble duration while running; subagent tile count | partially captured: finished agent bubble "Explore done" only | `*-C-light-3-back.png` | Running-duration timer not reachable (agent already done). Tile count text identical. |
| B16 system prompt drawer during regeneration, close, reopen | not reachable: regeneration needs an LLM provider; Settings > Advanced reached (`*-adv-dark.png`) | `*-adv-dark.png` | Page identical; drawer run state not triggered. |
| B18 Command Center with root tab in background workspace | partially captured | `*-cc-dark-1.png`, `*-cc-light-1.png`, `*-cc-*-2-after6s.png`, `*-cc-*-3-back.png` | Landing renders identically. Resuming a seeded session was refused with "already open in another tab" (expected guard because the session was open in Chat); the session header with context cue and a background-workspace root tab could not be set up. |
| Persistence after navigation (Analytics and back, Voice and back) | captured | `*-nav-away-*.png`, `*-C-*-3-back.png` | Values after returning identical to before navigating away and identical across trees. |
| Clock advance (two shots 6 s apart) | captured as a negative: `*-C-*-1.png` vs `*-2-after6s.png` | no visible timer on restored sessions (Time `—`), so no tick is observable | Equal in both trees, no flicker. |
| Narrow 1000x800 | captured | `*-C-dark-narrow.png` | Same reflow in both trees. |

## Regressions

None found. Automated comparison of the inspector and activity text across 14 paired states (dark and light, sessions A/B/C, activity panel, back from navigation) returned identical content; screenshots of paired states show no layout shift, no clipped text and no new `—` placeholders.

## Prototype fidelity

- Approved prototype: None (UI change with no new or redesigned surface).
- Fidelity assessment: NOT APPLICABLE.
- Before/after comparison: dark and light pairs listed in the table above (`before-*` vs `after-*`), result: no visual regression.

## Accessibility, performance

Not changed by this branch and not re-measured beyond the visual comparison; no focus or contrast regressions seen in the paired screenshots. No layout shift observed on switching sessions, opening the activity panel, or tab navigation.

## Residual uncertainty

The main value of this branch (live clocks, running agent durations, cache-class rows, known context percent surviving reload, drawer regeneration state, CLI lane usage, background-workspace Command Center) needs a live LLM or CLI session that this sandbox cannot run. Those screens are unverified visually and should be covered by one manual live pass (or the existing component specs). Only restored-session behaviour was compared, and it is unchanged.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (clean on every reachable screen; live-only screens not exercised)
- Key concern: live-only surfaces (B11, B14 running timer, B16, B18 with a context cue, CX4/HB1 reload) have no visual evidence.
- Leftovers: base worktree `D:\projects\ptah-extension\.claude-worktrees\psm-visual-base` kept (detached, node_modules junction).

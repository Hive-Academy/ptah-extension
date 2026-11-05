# TASK_2026_875_8be2 — Hidden feature analysis

## Request

The main GitHub README is out of date. In the last 3-4 weeks the user built many new features and
enhanced existing ones. They want a heavy, code-grounded analysis of the unique and hidden Ptah
features that exist in the code but are not written (or not emphasized) in markdown/HTML. The
output feeds: the README refresh, the landing page, and social campaigns for the PtahCode v2
desktop (Electron) launch.

## Classification

- Type: RESEARCH (switch to CREATIVE/DOCUMENTATION later only if the user asks for copy/pages).
- Depth: Partial — research only, no product code changes.
- Worktree: `.claude-worktrees/hidden-features-analysis`, branch `docs/hidden-features-analysis`.

## Gate 0.1 — CLI lanes

- Preference source: memory (`orchestration-executor-preference`, `cli-lane-executor-preferences`)
  plus user global CLAUDE.md: lanes first, non-Claude vendors, max 3 lanes in flight.
- Memory conflicts on codex; codex is not used in this run to avoid the conflict.
- Glm and kimi code rows are AT LIMIT. Spawnable: antigravity, opencode, grok.
- Mode: enabled. Approval: lane-review (no document gates apply to pure research).

## Lane recovery log

- opencode (lane B) failed in 8 s: `Model unavailable: opencode-go/glm-5.3` (Glm family at limit,
  reset unknown). Skipped for the rest of this run. Lane B moved to codex (only lane with
  confirmed room); disclosed to the user because codex preference memories conflict.

## Plan

1. Three parallel research lanes (read-only on code), one per domain:
   - A antigravity: agent orchestration and runtime backend libs.
   - B opencode: intelligence, memory, MCP tools, integrations, Electron host.
   - C grok: frontend UX libs and the renderer, plus the documentation gap baseline.
2. One synthesis lane writes `hidden-features-analysis.md` (master doc).
3. Orchestrator spot-checks claims against code, commits, pushes and opens a PR.

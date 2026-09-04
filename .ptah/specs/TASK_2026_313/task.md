---
id: TASK_2026_313
status: backlog
type: BUGFIX
title: >-
  Neither harness disclosure surface has any e2e coverage, and the Dashboard
  card's blocked list is uncapped in page flow
description: >-
  Two gaps in the blocked-path disclosure shipped by TASK_2026_306. (1) **No e2e
  references either surface.** Greps for `harness-blocked`, `ptah-harness-card`,
  `harness-health`, `repairBlocked` and the card heading across
  `apps/ptah-electron-e2e/src` and `apps/ptah-extension-vscode-e2e/src` return
  nothing. Both surfaces have thorough unit specs, but a green e2e run currently
  proves nothing moved AND would equally not catch either card silently
  disappearing from the app — which for a disclosure surface whose entire job is
  to be seen by a user without a terminal is the failure that matters most. (2)
  **The Dashboard card's list is unbounded.** The Marketplace popover caps
  itself with `w-80 max-h-[26rem] overflow-y-auto`
  (`libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:95`)
  because a popover has to fit; the Dashboard `ptah-harness-card` sits in normal
  page flow with no equivalent bound. At the 13 blocked paths that motivated the
  feature this is fine. At 500 — a workspace where someone checked in a full
  `.claude/skills` tree — the card pushes every other card off the first screen
  of the home, so the disclosure surface damages the surface it lives on. Cap it
  the way the popover does, or show the first N with a "+M more" that routes into
  the popover, matching the doctor's existing 20-per-group convention. Recorded
  as follow-ups by TASK_2026_306.
---

# Harness disclosure: no e2e, and an uncapped list on the home

Machine-owned metadata carrier. Prose lives in `./context.md`.

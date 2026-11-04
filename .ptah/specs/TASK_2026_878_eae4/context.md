# TASK_2026_878_eae4 — Landing page revamp below the hero

## Request

The user likes the hero section and its video animation. Every other section needs a revamp in
content and style, to continue the hero's quality. Copy today reads like generic SaaS; it must sell
the actual Ptah v2 features from the hidden-features analysis (TASK_2026_875_8be2, PR #931).
Equal priority with the README refresh (TASK_2026_877_85fa).

## Classification

- Type: CREATIVE, Full. Flow: designer → prototype → cross-side review → Gate 1.7 → content
  writer → frontend developer → visual review → code review.
- Worktree `.claude-worktrees/landing-revamp`, branch `feat/landing-revamp`.
- Gate 0.1: lanes enabled; approval mode `lane-review`. The orchestrator will still show the
  prototype screenshots to the user, because the visual direction is the user's taste.

## User decisions (2026-11-04)

- Removals APPROVED: problem chart, Demo vs Production comparison + its rows, lifecycle rail,
  stale drag-and-resize canvas point.
- Tribunal IS shipped as a chat skill (its duplicated UI page was removed) → feature it.
- "Free, no account, no license key" is TRUE → may be used.
- Design round 1 (antigravity, HTML prototype) REJECTED by the user: copy is good, but the
  visual design ignores the hero identity and is text-bloated ("slide deck, not a landing page").
  Revision lane stopped. Review: design-spec-review.md (REVISE).

## Process change after rejection

- No standalone HTML prototype. Build the new sections directly in Angular by extending the
  hero's own components, CSS and GSAP patterns; pilot ONE section first, screenshot it next to
  the hero, user approves, then the rest.
- Copy is cut to landing density first (headline, one line, a visual; ≤3 short points).

## Scope

- Keep: `libs/web/landing/src/lib/sections/hero/*` and the live-demo video assets (no visual change).
- Revamp: problem, pillars (spine), provider-strip, comparison, cta sections, plus navigation and
  footer copy where it is stale. Sections may be replaced, merged or added; any removed section is
  listed in `parity-inventory.md` for user approval.
- Source of truth for claims: analysis § Landing page plan, § Positioning pillars, § Claims to
  verify. Unverified claims stay out.

## Pilot race (decision-loop section)

- codex pilot: `.claude-worktrees/landing-pilot-codex` (66 lines; no awwwards MCP in Ptah codex lanes;
  sandbox blocked browser and Nx). Orchestrator captured screenshots.
- agy pilot: `.claude-worktrees/landing-pilot-agy` (1,152 lines incl. spec; used awwwards MCP).
  Lane hit a usage limit mid-run: antigravity RESOURCE_EXHAUSTED 429, reset in ~164 h
  (about 2026-11-11). Skip antigravity for the rest of this run.
- Comparison shots: `pilot-compare/`.

---
id: TASK_2026_555
status: in-progress
type: FEATURE
title: 'Providers settings: restore lost capabilities and replace the flat button-heavy UI'
depends_on: []
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-29T00:00:00.000Z"
description: "PR #575 (TASK_2026_523) shipped a flat, button-heavy Providers settings UI and removed 16 working capabilities. PR #581 (TASK_2026_534) fixed the runtime regressions and dead controls only and left the visual design out of scope. No task owned the rest."
executor: ui-ux-designer
estimate: L
labels:
  - providers-settings
  - ui
  - priority-medium
---

# TASK_2026_555 — Providers settings: parity and visual rework

Priority: **medium** (the page works, but it has fewer capabilities and a poorer UI than before #575).

## Why

- TASK_2026_533 records that PR #575 (TASK_2026_523) "shipped a flat, button-heavy UI, removed 16
  working capabilities, and introduced 4 runtime regressions". TASK_2026_533 then changed the
  skills (design gate, prototype, parity inventory, Gate 1.7) so this cannot happen again.
- TASK_2026_534 (PR #581) fixed the 4 runtime regressions, the dead controls and the CLI model
  lists. Its `task.md` says: "Scope is correctness only. The visual redesign is a separate task —
  do not restyle." That separate task was never created. This is that task.
- #581 restored some lost behavior (the Copilot auto-approve toggle, deep links, CLI model
  lists). Nobody has checked which of the 16 capabilities are still missing.

## Scope

1. **Parity inventory first.** Compare the page before #575 (`git show 7ecdefa45^1:<path>` for
   the old settings components) with `main`. Write `parity-inventory.md`: every capability of the
   old surface, whether `main` has it, and for each missing one: restore, or remove with a reason
   for the user to approve.
2. **Design.** The ui-ux-designer writes `design-spec.md` and a `prototype/` for the Providers tab
   (and the Agent Orchestration tab if the inventory shows gaps there). Use the existing daisyUI
   tokens and `libs/frontend/ui` components. Do not introduce rules the user did not ask for.
3. **Gate 1.7.** The user approves the design spec and the prototype before any implementation.
4. **Implementation** by batches, with a visual-reviewer before/after pass and a write→reader trace
   for every control that writes a setting (the TASK_2026_533 rule 5).

## Out of scope

- The items in TASK_2026_551, TASK_2026_552, TASK_2026_553 and TASK_2026_554.

## Acceptance

- `parity-inventory.md` has no capability that is missing without the user's approval.
- The approved design spec and prototype match the shipped page (visual-review.md, PASS).
- No setting write changes runtime behavior without a trace in the report.

## Process

FEATURE, Full workflow under the TASK_2026_533 gates: PM → parity inventory → designer →
Gate 1.7 (user) → architect → team-leader → batches with cross-side review → visual review.

## Decisions (2026-09-29)

- Gate 1.7 APPROVED by the user for Providers + Agent Orchestration: `prototypes/final/` (variant C
  "Routing map" as base, with variant A's calm tone, side drawer, "Follows main agent →" links and
  "Used by" list). The prototype is the visual source of truth; the drawer content must be
  per-connection (known prototype defect, fixed before handoff).
- Parity: restore all 17 missing capabilities in `parity-inventory.md`; drop only the post-save Reload
  button. Fix every item in "Regressed UX".
- Save model: popovers for short choices (model, effort, role provider, scope) save on selection with a
  toast + Undo; connection details in a side drawer; connect flow in a command-palette modal + wizard;
  credentials still require a passing connection check.
- Scope widened by the user ("fix all degradation we found"): TASK_2026_551, 552, 553 and 554 are
  folded into this task.
- Advanced and Search & Voice tabs: redesign requested; separate prototype + Gate 1.7 before they
  join the build.
- Design-spec §6 deviations (2026-09-29): #1 and #2 REJECTED by the user — keep the prototype's
  centered modals (command-palette catalog → wizard, tier mapping, add Ptah CLI instance) by building a
  shared `NativeModalComponent` in `libs/frontend/ui` on the native `<dialog>`. #3 (per-tab actions, no
  single drawer Save), #4 (roles matrix collapsed by default), #5 (up/down chevron reorder, no grip
  icon — per the design-spec review) proposed as technically required; shown to the user with the
  spec summary.
- Implementation-plan clarifications (2026-09-29, user): (1) main-agent provider switch and provider-key
  scope clear keep an explicit confirm ("ends running chat sessions"); the SDK reset is not changed in
  this task. (2) The Ptah CLI "Tiers" modal writes that instance's own `tierMappings` via
  `ptahCli:update`. (3) Model search is Settings-only, via an opt-in `searchable` input. (4) Design-spec
  deviation 6 APPROVED: colour on icons/dots/badges, text stays `text-base-content`. Deviations 3-5
  accepted.
- Lanes (2026-09-29, user): the Glm lane (Ollama Cloud) reached its usage limit; opencode is out of
  quota. Cross-side reviews and small lane batches now use **codex + antigravity**.
- Lanes (2026-09-30, user): continue with **Glm + antigravity** (codex limited until 2026-10-03 20:10;
  opencode still excluded).
- Execution (2026-09-30, user): Providers (21-28) and Orchestration (29-36) stay **sequential**, no second worktree.
- Advanced and Search & Voice tabs (2026-09-30, user): **no new prototype and no Gate 1.7**. They reuse the approved
  `prototypes/final/` patterns for one unified settings UI. Gate: a short pattern map (control → approved pattern) plus a
  preserve list from `investigation/tabs-advanced-search-voice-audit.md`, approved once by the user; then batches with
  Gate G and Gate V against the approved patterns. This replaces the "separate prototype + Gate 1.7" line above.
- Reviews (2026-09-30, user): no per-batch code review from Batch 22 on. Each batch still passes typecheck/test/lint,
  Gate G and captures before the team-leader commits it. The cross-side code review is combined: one over the whole
  Providers diff (21-28) at Gate V 28, one over the whole Orchestration diff (29-36) at Gate V 36, and one for the
  Advanced / Search & Voice batches at their Gate V.
- Pattern map APPROVED (2026-09-30, user): `pattern-map-advanced-search-voice.md` (+ antigravity review APPROVED).
  Gaps G1-G3, G5-G7, G11-G13 accepted as proposed; G9 resolved (same setting). Proposed Removals PR-1 (dead
  "Default for new sessions" preset radios) and PR-2 ("Workflows require a paid plan." sentence) APPROVED. Batches
  39-50 run after 36; the close-out (37) and the final visual review + live Electron pass (38) run after Batch 50.
- Gate V 28 (2026-10-01, user):
  - Electron fold: the user asked for "the most visible and clean layout" and left the choice to the orchestrator.
    Orchestrator choice: container-width grid, 2 columns of 80 px cards in Electron; when the routing map wraps, the
    third node spans the full row. The Electron fold asserts tabs, routing map and Connections heading <= 660 px;
    VS Code keeps the full budget (card 5 <= 660 px). Rejected: 3-column cards (100-111 px tall), a narrow 3-node map
    (crowded, still over budget), collapsing the shell sidebar (outside scope).
  - Main Agent popover: a compact searchable model picker in `libs/frontend/ui` (new Batch 28b).
  - Accepted as a deviation: only the "VS Code" App-layer label (Batch 27b).
  - NOT accepted, so they become work: the drawer key hint ("•••• 8f21"), the Overview per-connection latency, and
    Codex CLI under "Used by" for OpenAI Codex (new follow-up batches after 28b).
  - PR 611 Sonar (same session): the 3 `ci.yml` install-step findings were accepted on SonarCloud (user choice).

---
status: in_progress
type: documentation
title: 'Skills: design gate, prototypes, parity inventory, lane decision checks'
---

# TASK_2026_533 — Close the process gaps that let PR #575 ship

## Why

PR #575 (TASK_2026_523, providers settings page) shipped a flat, button-heavy UI,
removed 16 working capabilities, and introduced 4 runtime regressions. Root causes
in our skills:

1. `orchestration` has no gate for a design spec. A Codex lane wrote
   `design-spec.md`, it went straight to implementation, the user never saw it.
2. `agent-lanes` §6 treats lane decision documents (spec, design, plan) like
   facts: the orchestrator checked line numbers and component names, not whether
   the spec matched the user's request. The spec invented rules the user never
   asked for ("override actions are text buttons, never a tooltip", "no
   btn-primary / badge-success").
3. Nothing required an inventory of what the replaced surface could do, so 16
   capabilities were deleted silently.
4. UI batches were accepted on typecheck/test/lint only. Nobody looked at the
   rendered result.
5. UI code changed what gets written to persisted settings; each write was valid
   alone but changed runtime behaviour (no write→reader trace).

## Source of truth

Edit the PLUGIN SOURCE, not only the `.claude` copies:

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/**`
- `libs/backend/agent-generation/templates/agents/*.template.md`

Then mirror into the tracked workspace copies `.claude/skills/**` and
`.claude/agents/*.md`, and regenerate `content-manifest.json`
(`npm run manifest:generate`, then `npm run manifest:check` must pass).

## Requirements

### R1 agent-lanes (`skills/agent-lanes/SKILL.md`)
- §3 Task contract, new item 9 **Preserve list**: when the lane replaces,
  consolidates or deletes an existing surface, the task lists what that surface
  can do today (or passes `parity-inventory.md` in `files`) and says: every item
  stays, moves, or is listed under `## Proposed Removals` for user approval —
  never removed silently.
- §6 table, new rows:
  - **Decision artifacts (spec, design, plan)** → a proposal, not a decision.
    Diff every rule against the user's request; list each rule the user did not
    ask for under `## Lane-introduced constraints` (tag: user-requested /
    project-rule / lane-proposed). The user approves the artifact (orchestration
    Gate 1.7 or 2) before any lane builds from it.
  - **Code that deletes or replaces a surface** → check against
    `parity-inventory.md` row by row; a missing, unapproved capability blocks
    the batch.
  - **UI code** → typecheck/test/lint are not proof. Require rendered evidence
    (visual-reviewer screenshots, dark + light theme, compared with the approved
    prototype) shown to the user before merge.
- Under "Code that will ship": **Write-path trace** — when lane code changes what
  is written to persisted settings/config/storage, trace each write to its
  runtime reader (key, scope, value format, side effects such as env vars) and
  confirm behaviour is unchanged or intended.

### R2 orchestration (`skills/orchestration/SKILL.md` + references)
- Flow table: FEATURE and CREATIVE show `[designer → prototype → Gate 1.7]`.
- Gate table: **1.7 Design** — after `design-spec.md` and `prototype/`, before
  the architect; plain message, wait for `APPROVED`. Mandatory whenever a
  designer ran or any UI surface is added/redesigned.
- Task folder: `parity-inventory.md` is REQUIRED when the task replaces,
  consolidates, rebuilds or redesigns an existing surface. Written by the PM (or
  architect when no PM) from the OLD code before design starts. Columns:
  capability, where today (file:line), backing RPC/API, decision
  (keep/move/remove-proposed), new location, test that proves it.
- Never list: never let a lane-authored spec/design/plan reach implementation
  without the user seeing it; never delete a capability that is not an approved
  removal in `parity-inventory.md`.
- `references/checkpoints.md`: add a Gate 1.7 template (prototype path + how to
  open it, screenshots, screen/state list, `Lane-introduced constraints` list,
  parity deltas, who authored the spec — which lane/agent, reply APPROVED or
  revisions). Add a `Lane-introduced constraints` block and parity deltas to the
  Gate 1 and Gate 2 templates too.
- `references/team-leader-modes.md`: completion mode verifies
  `parity-inventory.md` row by row and requires visual-reviewer evidence
  against the approved prototype for UI batches; write-path trace for settings
  writes.
- `references/strategies.md` and `references/agent-catalog.md`: add the
  prototype step and designer responsibility where FEATURE/CREATIVE/designer are
  described.

### R3 ui-ux-designer prototypes (`skills/ui-ux-designer/`)
- New `PROTOTYPING.md` reference + a SKILL.md section **Prototype for user
  confirmation** (the designer OWNS this):
  - Deliverable: `<taskFolder>/prototype/` — self-contained static HTML (one file
    per screen or one file with in-page navigation), plain JS allowed, no build,
    no backend, never imported by the app.
  - Uses the project's REAL design tokens and component library (for this repo:
    Tailwind + daisyUI themes from `apps/ptah-extension-webview/tailwind.config.js`;
    a CDN build with the same theme names/colours is acceptable).
  - Shows every state: populated, empty, loading, error, and each relevant
    theme (at least one dark, one light) and width (narrow sidebar ~400px, wide).
  - `prototype/README.md`: how to open it, screen/state list, what is
    interactive, the `Lane-introduced constraints` list, and a link to
    `parity-inventory.md` showing where each kept capability appears.
  - Screenshots in `prototype/screenshots/` (use `ptah_browser_screenshot` when
    available; otherwise say so).
  - Rules: prefer the project's existing components over custom markup; never ban
    a project component wholesale (e.g. "no badges", "no tooltips") — an
    accessibility concern is solved with tokens/contrast, and any ban needs
    evidence and user approval; status and secondary info are hints, badges or
    tooltips, not buttons; each surface has one primary action.
  - Iteration: revise the prototype until the user replies APPROVED at Gate 1.7;
    the approved prototype is the visual source of truth.
- `DEVELOPER-HANDOFF.md`: the handoff references the approved prototype;
  frontend implementation must match it; deviations go back to the designer.

### R4 agent templates (`libs/backend/agent-generation/templates/agents/`)
- `ui-ux-designer.template.md`: prototype is a required deliverable for any
  UI surface; lists lane-introduced constraints; stops for Gate 1.7.
- `project-manager.template.md`: writes `parity-inventory.md` when replacing a
  surface.
- `team-leader.template.md`: parity check + visual evidence + write-path trace
  at completion.
- `visual-reviewer.template.md`: compares the build with the approved prototype.
Mirror the equivalent edits into `.claude/agents/<same>.md` (those are rendered
copies with project detail; edit, do not regenerate).

## Constraints
- Match each file's existing voice, density and formatting. Additive, concise.
  No vendor rosters. Do not restructure unrelated sections.
- Keep `agent-lanes/SKILL.md` under ~230 lines.

# Code Style Review — `TASK_2026_533`

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 6/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 3                                    |
| Serious issues  | 2                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 17 (16 changed + 1 new)              |

Scope: uncommitted diff in `D:\projects\ptah-extension\.claude-worktrees\skills-design-gate`
(branch `docs/skills-design-gate-parity`) against `task.md` R1–R4, cross-checked with
`lane-report-a.md` (Codex, R1/R2) and `lane-report-b.md` (Antigravity, R3/R4). `npx nx test
agent-generation --skip-nx-cache` run from the worktree: **34 suites / 1120 tests passed**
(includes `template-sharing.guard.spec.ts`), no vendor-roster or template-guard failures.

Each requirement bullet of R1–R4 is present somewhere in the file the spec names — I did not
find scope creep (`git diff --stat` matches exactly the files R1–R4 name, no unrelated files
touched). The failure mode is not missing content; it is two lanes each writing a self-consistent
half of a pipeline that does not connect: Lane A's orchestration files were rewritten to expect a
`design-spec.md` that Lane B's designer skill never produces, and Lane B's own new reference file
uses a heading casing that the rest of the pipeline (including Lane B's own `SKILL.md`) does not
recognize. Both are the exact class of defect this task exists to prevent — a document nobody
downstream can actually find or match.

## Five style questions

### 1. What breaks in six months?

An orchestrator that follows `checkpoints.md:289` literally (`📄 **Document**:
<taskFolder>/design-spec.md`) will look for a file the designer never writes — see
[Blocking #1](#1-gate-17-points-at-a-file-the-designer-never-writes). Today an agent will
probably paper over it by showing whatever file does exist; six months from now, once this
skill is machine-parsed more literally (e.g. a script that greps `design-spec.md` to decide
whether Gate 1.7 is satisfied), the gate silently no-ops instead of blocking — the same failure
mode PR #575 caused, reintroduced by the fix meant to close it.

### 2. What would a new team member misread?

Someone implementing the designer role from `PROTOTYPING.md` would copy the "minimal,
production-grade template" (`PROTOTYPING.md:33-178`) verbatim, ship a prototype whose colors
don't match the project's real `anubis`/`anubis-light` palette (`apps/ptah-extension-webview/
tailwind.config.js:70-127`), get it "APPROVED" at Gate 1.7, and only discover the mismatch when
`visual-reviewer` compares the real build against the approved-but-inaccurate prototype. See
[Serious #1](#1-the-reference-html-skeleton-does-not-reproduce-the-projects-real-theme-colors).
They would also copy the `README.md` template's `## Lane-Introduced Constraints` heading
(`PROTOTYPING.md:254`) and not understand why Gate 1.7's own template
(`checkpoints.md:303`) and `agent-lanes/SKILL.md:150` never find it.

### 3. What does this cost to maintain?

Two names for the same artifact (`design-spec.md` in five orchestration locations vs.
`visual-design-specification.md` in five designer/template locations) means every future edit to
either side has to remember to check the other, or the drift widens. That is exactly the
"duplication with drift" pattern the hunt list calls out, except here it is a **naming** split
rather than a logic split — cheaper to fix now (one rename) than to carry indefinitely.

### 4. Where is this inconsistent with the rest of the repository?

- `checkpoints.md`, `strategies.md`, `agent-catalog.md`, `orchestration/SKILL.md` (Lane A) name
  the designer's deliverable `design-spec.md`; `ui-ux-designer/SKILL.md`,
  `DEVELOPER-HANDOFF.md`, `ui-ux-designer.template.md`, `.claude/agents/ui-ux-designer.md`
  (Lane B) still name it `visual-design-specification.md`. Neither lane touched the other's
  half of this rename.
- `PROTOTYPING.md:254` capitalizes `## Lane-Introduced Constraints`; every other file that
  defines or looks for that heading (`agent-lanes/SKILL.md:150`, `checkpoints.md:186,303,371`,
  `ui-ux-designer/SKILL.md:131`, `ui-ux-designer.template.md:84`,
  `.claude/agents/ui-ux-designer.md:58`) uses sentence case.

### 5. What would you have done differently, and why is that better rather than merely other?

Reconcile the two lanes' outputs against each other, specifically diffing every new proper noun
(`design-spec.md`, `Lane-introduced constraints`, `Proposed Removals`, `parity-inventory.md`
columns) each lane introduced against what the other lane's new text already assumed, before
calling either R1/R2 or R3/R4 done. A one-line grep for each new term across the whole diff (as
done for this review) would have caught both blocking issues in under a minute — cheaper than
finding them at Gate 1.7 runtime.

## Blocking issues

### 1. Gate 1.7 points at a file the designer never writes

- File: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/checkpoints.md:289,297`;
  also `orchestration/SKILL.md:61`; `strategies.md:41,73,405,443,455,488,520`;
  `agent-catalog.md:84`
- Problem: These Lane A files rename the ui-ux-designer's primary deliverable from
  `visual-design-specification.md` to `design-spec.md`. But the ui-ux-designer skill and its
  templates (Lane B) never picked up the rename: `ui-ux-designer/SKILL.md`'s untouched Output
  Format block, `DEVELOPER-HANDOFF.md:431,484`, `ui-ux-designer.template.md:103`, and
  `.claude/agents/ui-ux-designer.md:77` all still write/reference
  `visual-design-specification.md`. Nothing in the repository, before or after this change,
  produces a file literally named `design-spec.md`.
- Impact: Gate 1.7's own template (`checkpoints.md:289`) tells the orchestrator to open
  `<taskFolder>/design-spec.md`. Followed literally, the checkpoint references a file that does
  not exist. This is precisely the class of gap R2 exists to close (a document the user is
  supposed to see but can't reliably find).
- Fix: Pick one name. Recommend renaming the designer's actual output to `design-spec.md` in
  `ui-ux-designer/SKILL.md`, `DEVELOPER-HANDOFF.md` (`Write(...)` calls and prose), and the
  `ui-ux-designer.template.md` / `.claude/agents/ui-ux-designer.md` Output contract tables —
  since Gate 1.7's whole template (title "DESIGN READY FOR REVIEW", `design-spec.md` references
  throughout `strategies.md`) already assumes that name.

### 2. `## Lane-Introduced Constraints` casing mismatch in `PROTOTYPING.md`

- File: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ui-ux-designer/PROTOTYPING.md:254`
- Problem: The README template — the artifact text an agent copies verbatim into
  `prototype/README.md` — uses `## Lane-Introduced Constraints` (title case). Every other
  occurrence of this heading in the diff uses sentence case `## Lane-introduced constraints`:
  `agent-lanes/SKILL.md:150`, `checkpoints.md:186,303,371`, `ui-ux-designer/SKILL.md:131`,
  `ui-ux-designer.template.md:84`, `.claude/agents/ui-ux-designer.md:58`.
- Impact: An agent that follows `PROTOTYPING.md`'s own template will write a heading string
  that Gate 1.7's presentation template and `agent-lanes/SKILL.md`'s verification table don't
  name — the exact "casing vs. the heading other files tell agents to look for" mismatch this
  review was asked to catch by name.
- Fix: Change `PROTOTYPING.md:254` to `## Lane-introduced constraints`.

### 3. The reference HTML skeleton does not reproduce the project's real theme colors

- File: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ui-ux-designer/PROTOTYPING.md:36-178`
  (theme-relevant CSS at `:56-74`), vs.
  `apps/ptah-extension-webview/tailwind.config.js:70-127` (`anubis` theme: `primary: '#2563eb'`,
  `secondary: '#d4af37'`, `base-100: '#131317'`, etc. — a full daisyUI theme object compiled by
  the daisyUI Tailwind plugin at build time).
- Problem: The skeleton loads stock `daisyui@4.12.10/dist/full.min.css` from CDN, which ships
  only its ~30 built-in theme names (`light`, `dark`, `cupcake`, …) — `anubis` and
  `anubis-light` are not among them, so the file contains no `[data-theme="anubis"]` rule
  setting daisyUI's actual color variables (`--p`, `--s`, `--a`, `--n`, `--b1`-`--b3`, `--bc`,
  `--su`, `--wa`, `--er`, …). The skeleton's own `<style>` block only overrides `--bcm` (a
  project-specific muted-text variable), not the palette. Toggling `data-theme` therefore
  switches an attribute but does not apply the project's actual blue/gold/charcoal palette —
  `btn-primary`, `badge-success`, `alert-error` render with whatever un-themed fallback the CSS
  cascade produces, not the real colors.
- Impact: `task.md:99` requires the prototype use "the project's REAL design tokens... a CDN
  build with the same theme names/colours is acceptable"; `PROTOTYPING.md:27` restates this
  itself ("matching theme names and color definitions"). The shipped example violates its own
  stated rule. Since this file is presented as "a minimal, production-grade template," a
  designer copying it verbatim produces a prototype a user approves at Gate 1.7 believing it
  reflects the real UI when the colors are wrong — the same "user approved something that
  wasn't real" failure this task exists to close, reintroduced at the visual layer.
- Fix: Inline the real daisyUI CSS custom properties for `anubis` / `anubis-light` (derived from
  `tailwind.config.js:70-207`) into the skeleton's `<style>` block, or note explicitly in the
  skeleton that the designer must substitute the project's real theme variable values before use
  — the template as given does not do this and cannot be trusted as a drop-in.

## Serious issues

### 1. `PROTOTYPING.md`'s "project-agnostic" framing is asserted, not built into the skeleton

- File: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ui-ux-designer/PROTOTYPING.md:27,33-178`
- Tradeoff: Line 27 frames Tailwind + daisyUI as an example (`e.g., Tailwind CSS + daisyUI
  themes from apps/ptah-extension-webview/tailwind.config.js`), but the entire runnable
  "Minimal HTML Skeleton" that follows has no inline caveat that non-Tailwind projects must
  substitute their own token/component system. A designer working a different repository (this
  skill ships to any project via the plugin) has nothing in the file telling them where the
  project-specific part ends and the reusable pattern (theme toggle, width toggle, state
  switcher) begins.
- Recommendation: Add one sentence directly above the skeleton: "This example uses this
  repository's Tailwind + daisyUI tokens; substitute the target project's own token and
  component system, keeping the toggle/state-switcher pattern."

### 2. Cross-lane rename left five dependent files unreconciled (see Blocking #1)

- File: `libs/backend/agent-generation/templates/agents/ui-ux-designer.template.md:103`;
  `.claude/agents/ui-ux-designer.md:77`
- Tradeoff: Listed here separately from Blocking #1 because these are R4 deliverables Lane B
  owns directly (not just prose references) — the Output contract table itself still commits
  to `visual-design-specification.md` as "Visual specification," so an agent generated from this
  template has no path to ever write `design-spec.md`. Fixing Blocking #1 without touching this
  table leaves the template silently wrong.
- Recommendation: Same fix as Blocking #1, applied to the Output contract table row.

## Minor issues

- `ui-ux-designer/SKILL.md:31` — two consecutive blank lines after the new
  `PROTOTYPING.md` bullet in the reference list (before the `---`); cosmetic only, no content
  impact.
- `ui-ux-designer/DEVELOPER-HANDOFF.md:549` — new trailing blank line at end of file (diff shows
  `+` on an empty line); harmless but inconsistent with the file's prior EOF state.

## File-by-file

### `agent-lanes/SKILL.md`

Score 9/10 — 0 blocking, 0 serious, 0 minor. All three R1 bullets present (`§3` item 9 at
line 75, `§6` rows at 150-153, write-path trace folded into the "Code that will ship" row).
Stays at 206 lines, under the ~230 constraint. No vendor roster introduced.

### `orchestration/SKILL.md`

Score 7/10 — 1 blocking (shared with checkpoints.md/strategies.md/agent-catalog.md), 0 serious,
0 minor. Flow table, Gate table, task-folder `parity-inventory.md` rule, and Never-list entries
all match R2 and match task.md's wording closely. The `design-spec.md` naming it introduces
(line 61) is the file no downstream file actually writes — see Blocking #1.

### `orchestration/references/checkpoints.md`

Score 7/10 — 1 blocking (Gate 1.7 template references `design-spec.md`, line 289), 0 serious,
0 minor. Gate 1.7 template structure mirrors Gate 1/2 exactly (same "PLAIN MESSAGE, NOT
`AskUserQuestion`" heading, same Response Handling table shape); `Lane-introduced constraints`
and `Parity deltas` blocks correctly added to Gates 1 and 2 as required.

### `orchestration/references/strategies.md`

Score 8/10 — 0 blocking (references the same `design-spec.md` name as checkpoints.md, so
internally consistent with the rest of Lane A even though it disagrees with Lane B), 0 serious,
0 minor. FEATURE and CREATIVE flows both updated with the prototype step and Gate 1.7,
consistent with R2's "strategies.md and agent-catalog.md: add the prototype step... where
FEATURE/CREATIVE/designer are described."

### `orchestration/references/agent-catalog.md`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Selection matrix and Invocation Profiles both
updated; designer row (`Invoke When`) correctly changed from "FEATURE with new UI" to "FEATURE
with added/redesigned UI," matching the parity-inventory trigger language used elsewhere.

### `orchestration/references/team-leader-modes.md`

Score 8/10 — 0 blocking, 0 serious, 0 minor. New "Completion checks" section covers all three
R2 bullets (parity row-by-row, dark+light visual evidence, write-path trace) concisely, in the
file's existing voice.

### `ui-ux-designer/PROTOTYPING.md` (new)

Score 5/10 — 2 blocking (heading casing at line 254; theme-color fidelity at lines 36-178),
1 serious (project-agnostic framing not carried into the skeleton), 0 minor. Structurally sound
and well organized (Folder Layout → Skeleton → State Checklist → Rules → Screenshot step →
README template → Gate 1.7 loop mirrors the lifecycle correctly), but the two blocking defects
sit in the parts of the file agents will copy most literally: the heading text and the runnable
example.

### `ui-ux-designer/SKILL.md`

Score 8/10 — 0 blocking, 0 serious, 1 minor (double blank line). New "Prototype for User
Confirmation" section correctly summarizes and links to `PROTOTYPING.md` rather than
duplicating it at length; rules (never ban components, status-not-button, one primary action)
match `PROTOTYPING.md` and `task.md` wording closely.

### `ui-ux-designer/DEVELOPER-HANDOFF.md`

Score 7/10 — 1 blocking (shared `visual-design-specification.md` reference, part of Blocking
#1), 0 serious, 1 minor (trailing blank line). "Approved Prototype Reference" section and
Phase 3/4 workflow updates are clear and correctly renumbered (5→11 with no gaps); deviations
policy language matches PROTOTYPING.md and the templates.

### `libs/backend/agent-generation/templates/agents/ui-ux-designer.template.md`

Score 6/10 — 1 blocking (Output contract table still names `visual-design-specification.md`,
part of Blocking #1 / Serious #2), 0 serious, 0 minor. Method, Output contract and Refusals
sections otherwise match R4's ask precisely (prototype required deliverable, constraint
tagging, Gate 1.7 stop, component-ban refusal).

### `libs/backend/agent-generation/templates/agents/project-manager.template.md`

Score 9/10 — 0 blocking, 0 serious, 0 minor. New item 9, Output contract, and
`parity-inventory.md` template block match `task.md`'s column list and `## Proposed Removals`
heading exactly.

### `libs/backend/agent-generation/templates/agents/team-leader.template.md`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Completion-mode checks (parity, visual evidence,
write-path trace) match R4 and are consistent with `team-leader-modes.md`'s orchestrator-facing
summary of the same checks.

### `libs/backend/agent-generation/templates/agents/visual-reviewer.template.md`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Prototype comparison pass, Prototype fidelity
review dimension, and severity-table addition are well integrated into the existing review
flow structure (baseline → viewport sweep → interaction states → accessibility → prototype
comparison).

### `.claude/agents/*.md` (four files)

Score 9/10 — 0 blocking (mirrors correctly propagate the plugin-source blocking issues rather
than introducing new ones), 0 serious, 0 minor. Diffed each against its
`libs/backend/agent-generation/templates/agents/*.template.md` counterpart; content is
line-for-line equivalent (only the `{{...}}` template markers and rendered-copy framing
differ, as expected for rendered copies).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Gate table semantics: plain message + wait for `APPROVED`, doc-review checkpoints only | PASS | `checkpoints.md:274-281`, matches Gate 1/2 pattern exactly |
| `agent-lanes` line budget (~230 lines) | PASS | `agent-lanes/SKILL.md` = 206 lines |
| `agent-lanes` "no vendor rosters" | PASS | No vendor name added anywhere in the diff (`grep vendor` across all changed files) |
| Mirror parity: `.claude/agents/*.md` equivalent to `*.template.md` | PASS | Diffed all four pairs; content equivalent modulo template markers |
| `template-sharing.guard.spec.ts` / agent-generation test suite | PASS | `npx nx test agent-generation --skip-nx-cache`: 34 suites / 1120 tests passed |
| Same artifact name used consistently across producer and consumer files (`design-spec.md`) | FAIL | `checkpoints.md:289` vs. `DEVELOPER-HANDOFF.md:431`, `ui-ux-designer.template.md:103` |
| `## Lane-introduced constraints` heading casing consistent everywhere it's defined/read | FAIL | `PROTOTYPING.md:254` vs. `agent-lanes/SKILL.md:150`, `checkpoints.md:186` |
| `## Proposed Removals` heading consistent | PASS | `agent-lanes/SKILL.md:76`, `project-manager.template.md`, `.claude/agents/project-manager.md` all match |
| `parity-inventory.md` column list matches `task.md` | PASS | `orchestration/SKILL.md:47-49` and `project-manager.template.md` table both match `task.md:74` |
| Would this have stopped a lane banning badges/tooltips? | PASS (structurally) | `agent-lanes/SKILL.md:150` (Decision artifacts row forces diffing against user request + Gate 1.7/2 approval); `PROTOTYPING.md:204`, `ui-ux-designer/SKILL.md:136` (explicit ban prohibition) |
| Would this have stopped silently deleting 16 capabilities? | PASS (structurally) | `agent-lanes/SKILL.md:75,151`; `orchestration/SKILL.md:83`; `project-manager.template.md:100-101` |
| Would this have stopped shipping without the user seeing the design? | PASS with a caveat | `orchestration/SKILL.md:61,81`; `checkpoints.md:274` create a real blocking gate, but the gate's own document pointer (`design-spec.md`) is not what the designer produces (Blocking #1) — the gate blocks *something*, just not reliably the thing it names |
| PROTOTYPING.md project-agnostic in substance, not just in one caveat sentence | FAIL | Skeleton is Tailwind/daisyUI-specific with no adaptation note (Serious #1) |

## Maintenance debt

- Introduced: a documented Gate 1.7 design-review checkpoint, a `parity-inventory.md` contract,
  a `PROTOTYPING.md` reference, and consistent refusal language across four agent templates and
  their rendered copies — genuinely closes the process gaps `task.md` names for PR #575's root
  causes.
- Introduced (unintended): a two-name split for the designer's primary deliverable
  (`design-spec.md` vs. `visual-design-specification.md`) that now has to be carried or
  reconciled, and a heading-casing fork in a template agents copy verbatim.
- Retired: nothing removed; this is a pure addition to existing skill/template files.
- Net: positive once Blocking #1/#2 are fixed (they are single-point renames, not redesigns);
  negative as currently staged, since the two new blocking gaps sit exactly on the seam this
  task's cross-lane split created.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: Gate 1.7 (`orchestration`) and the designer's actual deliverable
  (`ui-ux-designer`) name the same artifact two different ways, so the gate this task's entire
  premise rests on points at a file that is never written.
- What a 10/10 version would do differently: (1) one shared rename pass reconciling
  `design-spec.md` across both lanes' files before either was marked done; (2) a single
  case-sensitive grep for every new heading/filename introduced, run across the full diff, as
  part of each lane's own verification step; (3) the `PROTOTYPING.md` skeleton either inlining
  the real `anubis`/`anubis-light` color tokens or explicitly flagging itself as
  structure-only, so a designer can't ship it as visually accurate by mistake.

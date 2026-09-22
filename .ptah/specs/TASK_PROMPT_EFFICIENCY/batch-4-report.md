# Batch 4 report — generator templates brought in line with batch 2

Scope: `libs/backend/agent-generation/templates/agents/**`. Nothing committed. No spec
under `libs/backend/agent-generation/src` needed a pin update.

## How assembly works

`TemplatePartialResolver` (`src/lib/services/template-partial-resolver.ts`) expands
`<!-- STATIC:ID --> … <!-- /STATIC:ID -->` pairs in each `*.template.md` from
`_shared/<kebab-id>.md`, then substitutes `{{SLOT}}` values from the template's
frontmatter `variables` map (an undeclared or residual slot fails the load). The
resolver inserts `\n\n<body>\n\n` between the marker lines;
`OrchestratorService.buildAgentFileContent` strips the marker lines on emit.
`TASK_SPEC_CONTRACT` has no file — it is rendered by `renderTaskSpecAgentBlock()` in
`libs/shared/src/lib/types/task-spec.contract.ts`.

## Byte totals (`wc -c`)

| Path | Before (HEAD) | After | Delta |
|---|---|---|---|
| `templates/agents/**` (all 20 `.md`) | 146,115 | 142,785 | -3,330 (-2.3%) |
| `_shared/*.md` (5 partials) | 5,304 | 1,755 | -3,549 (-66.9%) |

Per partial (before -> after): tooling-precedence 1,149 -> 212; clarification-protocol
662 -> 356; replacement-policy 818 -> 153; cli-delegation 1,195 -> 395; reviewer-stance
1,480 -> 639.

The four preamble partials total **1,116 bytes**, under the ~1,300 target.
`reviewer-stance.md` (639 B, three templates only) is not part of the preamble; with it
the five total 1,755.

The `*.template.md` files themselves grew a little on net: the per-role rules added below
(scoped verification, tool-call budget, batch cap) outweigh the shortened `CLARIFY_*`
frontmatter values. The saving that matters is per generated agent file, where the
preamble expansion drops from ~3,824 B to ~1,116 B — measured end to end, a rendered
`backend-developer.md` body is 11,328 B against 10,526 B for the hand-edited
`.claude/agents/backend-developer.md`.

## Edits

Shared partials — wording copied verbatim from the batch 2 output in
`.claude/agents/backend-developer.md`, split back across the files:

- `tooling-precedence.md` — now carries the `## Working rules` H2 plus the single
  `ptah_*`-first bullet (renames before, diagnostics after, fallback named, no probing).
- `clarification-protocol.md` — one bullet for the protocol plus one
  `- Clarification trigger: {{CLARIFY_TRIGGER}}; stop before {{CLARIFY_ARTIFACT}}.
  Proceed when {{CLARIFY_BYPASS}}.` line.
- `replacement-policy.md`, `cli-delegation.md` — one bullet each. The CLI bullet keeps
  list-first / no vendor hardcoding / self-contained prompts / 3-lane cap /
  `<agent-lane-completed>` wait / `resume_session_id` / no git / own-synthesis.
- `reviewer-stance.md` — prose + table replaced by three bullets holding the same score
  bands, shares and no-manufactured-finding rule.

Per-role frontmatter: the `CLARIFY_TRIGGER` / `CLARIFY_ARTIFACT` / `CLARIFY_BYPASS`
values in all 15 templates were replaced with the compressed per-role text batch 2 wrote
into the corresponding `.claude/agents/<role>.md` trigger bullet.

Per-role body edits (each matched against the batch 2 `.claude/agents` file):

- R4 polling — `team-leader.template.md` batch executor prompt: "polls them" ->
  "waits for each `<agent-lane-completed>` signal (or one `ptah_agent_status` check)".
  `grep -rni poll` over the templates folder now returns nothing.
- R6 scoped verification — backend-developer and frontend-developer Method step 6;
  devops-engineer Method "Proof" bullet; senior-tester Method step 7; code-logic-reviewer
  Inputs 6; code-style-reviewer Inputs 5; visual-reviewer build-then-serve precondition;
  team-leader "Batch 1 verification" template line. All say: scope to the changed
  projects with `-p <project>`, never workspace-wide; tail or filter; never paste a full
  log; do not re-run only to re-read output.
- Tool-call budget — backend-developer and frontend-developer (before "Working
  sequence"), devops-engineer (after the working-sequence paragraph), senior-tester (new
  Method step 8, old step 8 renumbered to 9).
- R9 team-leader — Mode 1 "Batch": at most 6 files across at most 2 libs with one scoped
  verification command. Mode 2 Step 2: read the named files with `ptah_ast_analyze` /
  `ptah_context_enrich_file` first, full reads only for files the batch edits.

No edits were needed in project-manager, researcher-expert, software-architect,
modernization-detector, technical-content-writer, ui-ux-designer or video-director
beyond the frontmatter variables — their bodies already diff clean against the batch 2
files.

## Verification

- Rendered `backend-developer` and `team-leader` through the real
  `TemplatePartialResolver` (temporary spec, since removed) and diffed the marker-stripped
  output against `.claude/agents/<role>.md`. The only remaining differences are the
  `TASK_SPEC_CONTRACT` block (see below), the blank-line seams the resolver inserts
  around each expanded block, and the position of the clarification-trigger bullet (4th
  rather than last, because it shares one marker pair with the protocol bullet). No rule
  is missing in either direction.
- Body-level diff of all 15 templates against their `.claude/agents` counterpart
  (frontmatter, shared blocks and `<!-- LLM:… -->` markers excluded): clean.
- `npx nx run-many -t test -p agent-generation --output-style=static`: 32 suites,
  1,028 tests passed, exit 0. `template-sharing.guard.spec.ts` resolves every real
  template and passed unchanged; no spec pinned the old partial text, so no pin needed
  updating.

## Blocker carried forward (out of this batch's ownership)

`TASK_SPEC_CONTRACT` is generated, not a `_shared` file. Its source is
`renderTaskSpecAgentBlock()` in `libs/shared/src/lib/types/task-spec.contract.ts`
(~1,080 B specialist / ~2,270 B coordinator), and batch 2 compressed it to a single
bullet (plus a `## Task carrier rules` block for project-manager and team-leader) by
editing `.claude/agents` directly. A regeneration will therefore still reinstate the long
task-spec block — about 800 B per specialist file and ~1,900 B for the two coordinators,
roughly 14 KB across the corpus. Compressing it means editing that renderer in
`libs/shared`, which this batch does not own; `task-spec.contract.spec.ts` pins its text
and would need updating with it.

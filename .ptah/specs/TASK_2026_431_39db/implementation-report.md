# Implementation report — TASK_2026_431

Branch `refactor/task-431-agent-lanes`. Plan: `./implementation-plan.md`.

## What changed

| Area | Change |
|---|---|
| `agent-lanes/SKILL.md` (new) | One home for lane mechanics: discover (and work natively when the lane tools are absent), address, task contract, run, recover, verify and revise, messaging a live lane, cost. 136 lines, names no workflow and no roster |
| `orchestration/SKILL.md` | Router: classify, strategy table, task-folder rule, gate table, invocation rules, never-list, reference index with load conditions, `## Requires` |
| `orchestration/references/cli-agent-delegation.md` | Deleted. Transport → `agent-lanes`; orchestration-only parts → `lane-assignment.md` |
| `orchestration/references/lane-assignment.md` (new) | Who spawns (contradiction resolved), Gate 0.1 outcome block, batches on lanes, per-role hand-offs, never-on-a-lane list, assigning phases to lanes (ex-Relay) with roster pinning and worked example |
| `team-leader-modes.md` | Rewritten to the team-leader template's real return headings (`### Next action:`), `batches.md`, `IN_PROGRESS`. The old `NEXT BATCH ASSIGNED` / `BATCH REJECTED` table contradicted the agent the orchestrator actually talks to |
| `task-tracking.md` | One `task.md` template (was two), ID format fixed to `TASK_YYYY_NNN_xxxx`, bug history removed, `batches.md`, anchors `#new-task` / `#continuation` |
| `agent-catalog.md` | Matrices kept, CLI Delegation column with team-leader, visual-reviewer and ui-ux-designer at `-` and a legend naming all three; deliverable filenames folded into the invocation table; developers report evidence and never edit `batches.md`; profiles one row each; six-viewport checklist kept; `nx build web` and stack-specific source dirs dropped |
| `checkpoints.md` | Gate 0.1 points at agent-lanes / lane-assignment; SR covers lanes; commit-hook template replaced by a link to `git-standards.md`; QA code block replaced by a link |
| `strategies.md` | Eight per-strategy "CLI Agent Delegation Opportunities" blocks removed (one home: lane-assignment per-role table) |
| `git-standards.md` | `tasks.md` → `batches.md` only |
| `tribunal/SKILL.md` | Four moves; Relay pointer; lane mechanics cited; `## Requires` (`agent-lanes`, `orchestration`) |
| `tribunal/references/vendor-panel.md` | §0 explicit panel, §1 families, §2 selection, §3 anonymization, §4 synthesis, §5 rounds. Spawn/poll/read loop, resume and concurrency default removed. Stale `preferredRank` (no such field in `ptah_agent_list`) replaced by listed order |
| `tribunal/references/relay.md` | 0.9KB pointer mapping UI role tokens onto lane assignment |
| `crucible.md` | Relay column removed; roster addressing, ID steps, resume, defect-drop and revise-cap wording cite agent-lanes / task-tracking |
| `council.md`, `forge.md`, `race.md` | Transport sentences replaced by agent-lanes cites; anonymization section numbers updated |
| `ptah-core/commands/orchestrate.md` | Reference list gains `lane-assignment.md` |
| `content-manifest.json` | Regenerated with each content commit |
| `vendor-roster-drift.spec.ts` | Disclaimer-exemption worked example now `agent-lanes/SKILL.md` |
| `lane-rule-single-home.spec.ts` (new, vscode-lm-tools) | Six lane rules (`resume_session_id`, `CLI Session ID`, default concurrency 3, two revise rounds, `cli` ignored when `ptahCliId` set, pasted `ptah_agent_list` row) must appear in `agent-lanes/SKILL.md` and nowhere else in agent-lanes/orchestration/tribunal |
| `skill-sibling-links.spec.ts` (new, harness-sync) | ptah-core: every cross-skill link lands on an existing sibling file, the sibling is under the linker's `## Requires`, every `## Requires` slug exists, orchestration and tribunal require agent-lanes; every harness target places two skills as siblings of one directory |
| `apps/ptah-video-studio/docs/feature-knowledge-base.md` | One cite path updated |

## Decisions

**Relay → orchestration lane assignment.** Relay was orchestration's pipeline on lanes; its one
tribunal signal (cross-family review) is a general lane rule. Tribunal keeps Council, Forge, Race,
Crucible. `tribunal/references/relay.md` stays as a pointer because shipped Tribunal UI builds tell
the conductor to read it and runtime content download delivers this text to those builds.

**Sole-spawner contradiction.** Orchestrator spawns every subagent, every batch executor and every
phase lane; team-leader spawns nothing; other subagents may spawn lanes for their own sub-tasks when
Gate 0.1 allows and the role is not on the never list. Matches `_shared/cli-delegation.md` and the
team-leader template.

**Contradictions resolved toward the contract**:
- Resume is conditional on `CLI Session ID` (tool contract), not unconditional.
- Team-leader signals and `batches.md` follow the template.
- Crucible judge must be a different family (crucible.md:37 "must", UI roster rule); the
  "same-family judge when asked" allowance at crucible.md:53 was dropped. Same-family review stays
  allowed, and flagged, for ordinary review and laned runs.

**Dependency guard = declaration + spec + visible fallback**, not loader enforcement. Auto-claiming a
required sibling would override an explicit disable or per-workspace selection; dropping dependents
would silently remove the default workflow; and the Claude-SDK plugin path is a second loader. Each
dependent `SKILL.md` says what to do when the sibling is missing.

**Dropped as model education**: the 30/25/25/20 strategy-selection weights and confidence
thresholds (router: "two types equally plausible, or none fits → ask"); resume examples per vendor;
parallel/sequential pseudo-code; "good vs bad prompt" examples.

## Size (KB = bytes / 1024)

| File | Before | After |
|---|---|---|
| orchestration/SKILL.md | 24.4 | **5.4** |
| orchestration/references/agent-catalog.md | 22.8 | 9.6 |
| orchestration/references/checkpoints.md | 20.9 | 17.8 |
| orchestration/references/cli-agent-delegation.md | 24.9 | deleted |
| orchestration/references/git-standards.md | 9.3 | 9.3 |
| orchestration/references/lane-assignment.md | — | 6.7 |
| orchestration/references/strategies.md | 21.9 | 18.8 |
| orchestration/references/task-tracking.md | 15.6 | 5.6 |
| orchestration/references/team-leader-modes.md | 15.4 | 2.8 |
| **orchestration total** | **155.2** | **75.8** |
| tribunal/SKILL.md | 9.7 | 5.8 |
| tribunal/references/council.md | 3.2 | 3.2 |
| tribunal/references/crucible.md | 15.2 | 14.3 |
| tribunal/references/forge.md | 4.4 | 4.3 |
| tribunal/references/race.md | 4.3 | 4.3 |
| tribunal/references/relay.md | 13.9 | 0.9 |
| tribunal/references/vendor-panel.md | 9.3 | 4.1 |
| **tribunal total** | **60.0** | **36.9** |
| **agent-lanes/SKILL.md** | — | **7.4** |
| **ptah-core skills, all `.md`** | **543.5** | **448.4** |

What loads:

| Scenario | Before | After |
|---|---|---|
| orchestration trigger | 24.4 | 5.4 |
| orchestration trigger with lanes enabled (+ agent-lanes + lane-assignment) | 24.4 + 24.9 | 5.4 + 7.4 + 6.7 = 19.5 |
| Council (SKILL + spine + move, + agent-lanes after) | 22.2 | 5.8 + 4.1 + 3.2 + 7.4 = 20.5 |
| Crucible | 34.2 (+ relay.md 13.9 for addressing) | 5.8 + 4.1 + 14.3 + 7.4 = 31.6 |

## Alignment with TASK_2026_432 (coordinator request, branch not merged here)

- CLI Delegation column kept; team-leader `P` → `-`; legend names team-leader, visual-reviewer and
  ui-ux-designer as the non-delegating roles.
- Developer invocation: "Report each task's completion with evidence; do not edit batches.md; the
  team-leader records state." Only the team-leader sets task states; specialists never edit
  `task.md` or `batches.md`. In a run where implement is a lane (no team-leader), the orchestrator
  verifies the lane report and records `batches.md` — the Tribunal UI's Relay rail still keys on it.
- Resume: only on a reported `CLI Session ID`, otherwise respawn with the context restated; without
  `ptah_agent_*` tools, work natively (agent-lanes §1, §5).
- `team-leader-modes.md` headers re-checked against 432's `team-leader.template.md` (read-only
  `git show`): `DECOMPOSITION COMPLETE/BLOCKED`, `BATCH [N] PARTIAL FAILURE`, `NEEDS REVIEW`,
  `BATCH [N] NOT ACCEPTED`, `BATCH [N] COMPLETE`, `ALL BATCHES COMPLETE`, `TASK COMPLETE` all
  still literal there.
- `content-manifest.json`: both branches regenerated it. Expected conflict; resolve by regenerating
  on the merged tree (`npm run manifest:generate`), never by hand-merging hashes.

## Verification

| Command | Result |
|---|---|
| `npx nx run-many -t test -p @ptah-extension/harness-sync @ptah-extension/vscode-lm-tools @ptah-extension/task-specs --skip-nx-cache` | see "Test run" below |
| `npx jest … vendor-roster-drift` | 44 passed |
| `npx jest … contract.guard` (task-specs) | 179 passed |
| `npx jest … lane-rule-single-home` | 13 passed; mutation (append a revise-cap and `resume_session_id` line to council.md) → 2 failed, restored |
| `npx jest … skill-sibling-links` | 11 passed; mutations (un-backtick tribunal's `agent-lanes` requirement; add a link to a missing sibling file) → 2 failed each, restored |
| `npm run manifest:check` | up to date, 224 files |
| `npm run manifest:self-test` | passed |
| `npx eslint` on the three spec files | clean (module-boundary rule skipped: no cached graph) |
| `npx prettier --check/--write` on the spec files | formatted |

### Test run

`Running target test for 3 projects` — harness-sync, vscode-lm-tools, task-specs.

| Project | Suites | Tests |
|---|---|---|
| (first reported) | 18 passed | 489 passed, 23 skipped |
| (second reported) | 46 passed | 384 passed |
| (third reported) | 47 passed | 1066 passed |

`Successfully ran target test for 3 projects`, exit 0. One Jest worker "failed to exit gracefully"
warning (pre-existing teardown leak, no failure). The run preceded the final `agent-lanes` §3 wording
fix; the two guard specs and `vendor-roster-drift` were re-run after it.

### Walkthroughs (desk traces against the slimmed text)

**Council, conversational.** tribunal/SKILL.md preflight → vendor-panel §2 (rows read per agent-lanes
§1) → announce (agent-lanes §8) → council.md round 1: task per agent-lanes §3 with the answer
structure in place of a deliverable path (§3.4 covers panel answers) → run per §4 → packets per
vendor-panel §3 → round 2 → synthesis per vendor-panel §4 and council.md Step 4. No step points at a
missing instruction. One gap found and fixed during the trace: §3 originally required a deliverable
file for every lane, which a Council answer does not have.

**FEATURE, lanes enabled.** orchestration/SKILL.md pre-flight → Gate 0.1 (checkpoints.md; mode block
from lane-assignment.md) → new task (task-tracking.md § New task) → PM via agent-catalog invocation →
Gate 1 → architect → Gate 2 → team-leader Mode 1 (team-leader-modes.md) → `DECOMPOSITION COMPLETE` →
parallel batch on lanes (team-leader-modes § Spawning a batch executor → agent-lanes §3–6) → Mode 2 →
`NEEDS REVIEW` → reviewer → `BATCH [N] COMPLETE` … → `ALL BATCHES COMPLETE` → Mode 3 → `TASK COMPLETE`
→ Gate 3 (agent-catalog § Parallel QA) → modernization-detector (strategies.md FEATURE phase 8). No
missing instruction.

These are desk traces, not live runs. The acceptance item "a representative Council and orchestrated
feature run end to end" still needs a live run.

## UI follow-ups (not done — file as a task)

1. **Relay move in the Tribunal UI.** `libs/frontend/tribunal-panel`: `TribunalMove` includes
   `relay`; `MOVE_REFERENCE.relay = 'references/relay.md'`; `step-pick-move.component.ts` offers the
   Relay card; `tribunal-run.service.ts` frames `[tribunal:<id>] (plan|architect|implement|review)`
   lines. Move this launch to an orchestration surface ("assign phases to lanes": pick a lane and
   model per phase, launch an orchestration run with that roster in the framing), then delete
   `tribunal/references/relay.md` and the `relay` value. Keep `RELAY_COMPLETION_NAMES`' implement →
   `batches.md` | `tasks.md` rule on the new surface.
2. **Crucible same-family judge.** The skill now refuses a same-family judge; confirm the roster
   validator (`tribunal-roster-rules.ts`) blocks it for Crucible (docs say it does) and that no UI
   path offers the override.
3. **Role-addressed lanes (TASK_2026_433).** When `ptah_agent_spawn` gains `role`, the phase picker
   should pass `role` rather than the `(role)` token grammar; the grammar is not a constraint.
4. **Dependency warning.** Skill toggles / Marketplace: warn when a user disables `agent-lanes` while
   `orchestration` or `tribunal` is enabled, or selects one without the other under
   `skillSyncMode: 'selected'`. Source for the edge: the `## Requires` section the new spec pins.
5. **Tribunal docs** (`apps/ptah-docs/src/content/docs/tribunal/*`, `agents/agent-orchestration.md`,
   `index.mdx`, `mcp-and-skills/popular-skills.md`) still describe five moves and Relay as a tribunal
   move. They link docs pages, not skill files, so they were left; update with the UI change.

## Findings outside scope

- `.claude/skills/{orchestration,tribunal}` is a separately tracked copy for this repo's own
  sessions; the orchestration copy had already diverged from the plugin. It still carries the old
  duplicated text and `cli-agent-delegation.md`. `scripts/validate-orchestration-skill.ts` validates
  only that copy (and requires `### <agent>` headings the plugin copy no longer has).
- On this branch `templates/agents/{visual-reviewer,ui-ux-designer}.template.md` still include
  `STATIC:CLI_DELEGATION`; TASK_2026_432 addresses it on its own branch.
- 21 cross-skill links in `ptah-nx-saas` and `ptah-dotnet` are undeclared, and several cross a
  plugin boundary (`saas-workspace-initializer → ../orchestration/SKILL.md` resolves only if
  ptah-core is installed beside it; `dotnet-solution-initializer → ../saas-workspace-initializer`).
  The new spec guards ptah-core only; extending it to every plugin needs those skills to declare
  their requirements (TASK_2026_435).
- `apps/ptah-docs/.../tribunal/crucible.md:97` and `tribunal/index.mdx:85` say Relay's protocol lives
  in the tribunal skill.
- `strategies.md` BUGFIX: the decision tree says a known cause → Minimal pattern, the BUGFIX section
  says known cause → team-leader Mode 1. Pre-existing, not a lane rule, left.
- A diverged (user-edited) `~/.ptah/user` clone keeps deleted files (`cli-agent-delegation.md`,
  old `relay.md` text) until the user resolves the divergence; fast-forwarded clones are cleaned by
  `clearCloneTrackedContent`.

## Open risks

- **Manifest merge with TASK_2026_432.** Both branches regenerated `content-manifest.json`
  (templates are in it). Whichever lands second must regenerate, not hand-merge.
- **Team-leader return headings** are quoted in `team-leader-modes.md` and match 432's template
  today. A later rename must update that table; the `### Next action:` rule survives it.
- **Older app builds** launching Relay get the pointer; a conductor that does not load orchestration
  (skill disabled) is told which skill to enable rather than running.
- **Messaging section** documents the tool contract only; TASK_2026_434 must add protocols there
  and keep the "no promised delivery" stance until 402 Batch 8 passes.

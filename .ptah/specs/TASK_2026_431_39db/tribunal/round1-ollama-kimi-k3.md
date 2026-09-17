
## Position — top recommendation in 2 sentences

Make `orchestration/references/cli-agent-delegation.md` the single source of truth for all CLI-lane mechanics (spawn→poll→read, resume, discovery, concurrency, bounded-revision), then delete the four other full restatements of those rules (orchestration `SKILL.md:287-385`, tribunal `vendor-panel.md:95-121`, `relay.md:44-106`, `crucible.md` roster block). The two workflows stay separate — but the shared transport layer they both stand on is currently authored five times and has already drifted.

## Top cuts (ranked by savings)

| file | problem | fix | est. saving KB |
|---|---|---|---|
| `orchestration/references/agent-catalog.md` | 15 per-agent profile blocks (~60% of file) restate role/triggers/inputs/outputs that each template's frontmatter description already carries; invocation table duplicates `SKILL.md:162-197` | Keep capability matrix + selection matrix (=unique); profiles become one-line rows pointing at templates | ~10 |
| `orchestration/references/cli-agent-delegation.md` | Same rules 2-4x in one file: resume rule stated at `:266-287, :293-301, :324-402` (two near-identical examples, one differs only by `cli` vs `ptahCliId`); Discovery section `:66-91` restated as CLI Agent Selection `:411-433`; parallel/sequential pseudocode `:196-239` derives from the tool signature | One resume rule + one example; merge selection into discovery; drop pseudocode loops | ~10 |
| `orchestration/references/team-leader-modes.md` | Full re-authoring of the Mode 1/2/3 state machine, its `Task({...})` invocations and ASCII loop — all re-specified in `team-leader.template.md` (which is the agent's actual prompt and now canonical: `batches.md`, advisory, no spawn) | Reference keeps only invocation templates + response-handling tables; mode semantics cite the template | ~9 |
| `technical-content-writer/DESIGN-SYSTEM.md` | 11 KB of Ptah's own brand (name, tagline "Powered by Claude Agent SDK", gold `#d4af37` palette) shipped inside a generic skill and loaded whenever content is written — see `:10-40` | Replace with a minimal "what a design-system doc must contain" schema; generation stays per-project per `strategies.md` design-check | ~10 |
| `orchestration/references/strategies.md` | 8 large ASCII flow diagrams restating "agent → checkpoint → agent" per type; `SKILL.md:28-43` quick reference already covers selection | One generic phase loop + per-type delta table | ~9 |
| `orchestration/SKILL.md` | `## CLI Agent Delegation Mode` `:287-336` + full injection block `:342-385` restate the reference's 3-tier, verified-delegation, spawn/poll/read/resume rules; checkpoint details `:198-254` restate `checkpoints.md` | Keep the delegation decision + a byte-equal copy of `_shared/cli-delegation.md` as the injection text; checkpoints become a one-row-per-gate table | ~8 |
| `orchestration/references/checkpoints.md` | Trigger/skip templates + response tables per checkpoint repeat `SKILL.md:198-254`; the two-layer "why plain message" rationale appears twice in-file alone (`:5-10, :28-36`) | Keep the message templates (unique), drop repeated rationale/skip lists | ~6 |
| `tribunal/references/relay.md` | `:44-53` restates the full task-ID algorithm (SSOT is `task-tracking.md:175-215`); `:63-103` restates lane addressing/discovery (SSOT is delegation reference); `:124-145` restates checkpoint ownership (SSOT `checkpoints.md`) | Keep only Relay deltas: prompt-per-phase, sequential baton, roster pinning | ~5 |
| `orchestration/references/task-tracking.md` | `task.md` template printed twice (`:40-72, :219-240`); bug-history narrative (`:96-108` "this one has already cost tasks… TASK_2026_182/188/189 repaired 2026-08-09", `:183` TASK_2026_194) is git-log material | One template, delete history | ~3 |
| Team total | — | — | **~70 KB ≈ 17-18k tokens** |

(Templates: team-leader trim adds ~4-5 KB, see below. Bundle-only bytes like `skill-creator/LICENSE.txt` 11.1 KB ship but are never prompt-loaded — cut if bundle size matters, zero token win.)

## Tribunal vs Orchestration repetitions

| concept | where in tribunal | where in orchestration | single source of truth | fix |
|---|---|---|---|---|
| spawn→poll→read loop | `vendor-panel.md:95-121`; per-move spawn blocks in `council/forge/race/relay/crucible` | `cli-agent-delegation.md:92-147`; injection block `SKILL.md:342-385` | `cli-agent-delegation.md` (comprehensive) | `vendor-panel.md §3` keeps only panel labeling ("tag with `Pk`") + a link |
| resume via `CLI Session ID` | one-line restatement in each of `vendor-panel:117-120`, `relay:137`, `forge:47`, `race:34`, `crucible` executor step | `cli-agent-delegation.md:266-402` (rule stated 4x, 2 examples) | `cli-agent-delegation.md` §Session Resume, cut to 1 rule + 1 example | tribunal files say "resume per delegation reference" |
| discovered roster, never hardcode | `SKILL.md:31-33`, `vendor-panel.md:37-79`, `relay.md:63-83`, `crucible.md` roster table | `cli-agent-delegation.md:66-91, 411-433` | delegation reference Discovery section | relay/crucible keep only role-fit deltas (judge≠executor, tier choice) |
| different-family review | `crucible.md:27-38`, `relay.md:96-103` (constraints 1-2) | `cli-agent-delegation.md:34-64` (Verified Delegation) | delegation reference = lightweight rule; `crucible.md` = full protocol | both already cross-link — keep links, delete either's inline repeat of the *rule* |
| 2-revise-round cap | `SKILL.md`, `crucible.md` flow | `cli-agent-delegation.md:48-56`, `SKILL.md:375-379` | delegation reference | crucible escalates it — one sentence pointer |
| task-ID/folder allocation | `relay.md:44-53` full restatement; `crucible.md:97` points to relay | `task-tracking.md:175-215` (SSOT) + `SKILL.md:136-145` | `task-tracking.md` | relay and crucible say "allocate per task-tracking reference" |
| checkpoint ownership / plain-message vs AskUserQuestion | `relay.md:140-150` ~15 lines | `SKILL.md:198-254` + `checkpoints.md` (twice in each) | `checkpoints.md`; SKILL.md keeps a gate table | relay: "gates run per checkpoints reference" |
| `## Clarifications Needed` loop | `relay.md:147-150` | `SKILL.md:57-70, 241-254`, `checkpoints.md` SR | agent side: `_shared/clarification-protocol.md`; orchestrator side: `checkpoints.md` | SKILL.md collapses to one table row |
| concurrency = 3 / cost-announce | `vendor-panel.md §6`, `SKILL.md` Concurrency section | `cli-agent-delegation.md:198-201, 313-322`, `_shared/cli-delegation.md:5` | one line in delegation reference, copied byte-equal into the shared partial | tribunal cites |
| "deliverable path in prompt, reply `WROTE:`" | `relay.md:27-32, 130-144`; `vendor-panel.md §3` | `SKILL.md:162-197` | `SKILL.md` invocation pattern (skill-side owner) | relays cite the pattern name |

## Authoring rubric

Apply per file; a "yes" to any keep-rule justifies survival, any cut-rule hit without a keep-rule wins removal:

1. **One concept, one home.** Each rule/algorithm/loop is authored once in the corpus; every other occurrence is a citation. Cross-skill links are allowed and preferred (both skills ship in the same plugin).
2. **SKILL.md is routing + invariants only.** Keep: trigger conditions, the 3-5 rules that gate or can be violated silently (round caps, PASS semantics, "never merge to main"), reference index. Move everything procedural to references.
3. **Cut what the model already knows.** Generic frameworks (SOLID, retry loops, poll-until-done pseudocode), tool-basics derivable from the parameter schema, generic error handling ("rephrase and retry").
4. **One example per rule, chosen for transfer.** Delete near-identical pairs differing by one string (`cli` vs `ptahCliId`); keep "good vs bad" only where the failure is common and non-obvious.
5. **Contracts over narrative.** Schemas, state machines, gate criteria, deliverable tables: keep, precisely. Paragraphs *describing* the same contract: cut.
6. **No history, no war stories.** Dates, repaired task IDs, "this has already cost tasks" — git-log material, cut. One clause of rationale is allowed when a rule is genuinely counterintuitive.
7. **No rosters, counts, or versions** that discovery can supply; such lists are both tokens and drift liabilities.
8. **No marketing adjectives or motivational framing** ("flagship", "elite", "compelling", "turns X into Y"). Say what the reader must *do*.
9. **Recap/"Important Notes" sections at the end of a doc** that repeat rules stated above: cut; the doc is the recap.
10. **Budget test per file:** SKILL.md ≤ ~150 lines; each reference ≤ ~400 lines; if exceeded, the burden of proof is on the longest section, not the file.

## Template findings

- The architecture is already right: closed STATIC set (`template-partial-resolver.ts:48-79`), markers stripped at emit (`orchestrator.service.ts:136`), one frontmatter, task-spec block derived from constants rather than hand-copied. Keep this; do not add a seventh copy anywhere (esp. the SKILL.md injection block — see cut table).
- `_shared/` partials are the shape everything should copy: 12-21 lines, one idea each. `video-director.template.md` (4.3 KB) is the reference body shape.
- `team-leader.template.md` (18.9 KB) is the outlier, not from padding but from five near-identical return-value templates (`:231-353`: DECOMPOSITION COMPLETE / BLOCKED / BATCH PARTIAL FAILURE / NEEDS REVIEW / NOT ACCEPTED differ by ~5 lines each). One envelope skeleton + a per-variant rules table saves ~4-5 KB without losing the contracts.
- LLM-slot intent is correct, but the fallback text duplicates template bodies: `frontend-developer.template.md:121-150` fallback bullets restate its own `Method` section ("copy the nearest existing component", "name framework+version"). Fallbacks should say "derive from instruction files and sibling code" in two lines; saves ~0.5 KB per slot.
- Per-template boilerplate like "Discover the task folder before assuming any document exists" repeats ~15x (~150 B each). Keep — deployed agent files must stand alone — but resist growing it; it belongs in the closed `_shared` set if it grows.
- Frontmatter descriptions run 400-650 chars; that's the only dispatcher signal (`orchestrator.service.ts:1104-1115` documents why one-liners lost) — keep the length budget, trim only redundancy between WHEN clauses across siblings.

## Tradeoffs / risks

- Cross-skill references assume both skills always ship together and relative refs survive every harness rewrite (Claude/Codex/Copilot paths differ); guard with a manifest test before merging the delegation docs.
- Cutting `agent-catalog.md` profiles makes the templates' frontmatter the only role list — descriptions must stay in sync; the closed-set machinery already enforces most of this.
- Removing Ptah's `DESIGN-SYSTEM.md` from the writer skill changes Ptah's own marketing output if that workflow is used in-house; move it to the Ptah repo, don't delete the content.
- `team-leader-modes.md` slimming risks orphaned invocation detail; the template's mode table (`team-leader.template.md:80-88`) must be the surviving copy.

## Confidence

**High** on orchestration/tribunal findings (every file read fully, repetition measured). **Medium** on the wider plugin corpus (nx-saas/angular/react spot-checked by head sections only; the angular twin `patterns.md` pair turned out to be different content, so size alone does not imply duplication there). Biggest risk: the delegation-reference merge is the highest-value change and the one most likely to regress relative-path resolution across the five harness targets if done without a guard test.
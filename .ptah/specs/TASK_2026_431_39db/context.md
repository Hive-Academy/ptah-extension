# Context — TASK_2026_431

## Origin

2026-09-13 conversational Council (two rounds, anonymized cross-critique) over the
shipped corpus in `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`.
Panel: P1 Codex, P2 Ollama `kimi-k3:cloud` (round 1 only — weekly quota hit in
round 2), P3 Antigravity. Raw outputs: `./tribunal/`.

## Decision: three skills, not one and not many

- **Not merged.** Tribunal is a flat peer panel where disagreement is the signal;
  orchestration is a hierarchy where throughput is the goal. One skill would load
  both workflows on either trigger — the opposite of the context goal.
- **Not fragmented per move.** Tribunal's SKILL.md + per-move references already
  disclose progressively; splitting Council/Forge/Race/Crucible into skills adds
  trigger surface and cross-skill links without saving loaded bytes.
- **Add one small shared skill: `agent-lanes`.** It owns everything a lane needs
  regardless of workflow. Round 2 rejected a loose shared file (harness-sync only
  copies skill folders — `harness-sync/src/lib/targets/workspace-target.ts:352`)
  and noted a skill inside orchestration makes tribunal depend on orchestration.
  A standalone skill fixes both.

| Skill | Owns | Must not contain |
|---|---|---|
| `agent-lanes` (new) | discovery via `ptah_agent_list`; `cli` / `ptahCliId` / `model` / `modelTier` addressing; spawn → status → read; resume only when a `CLI Session ID` exists; default concurrency 3; self-contained task contract (objective, inputs, deliverable path, `WROTE:` reply); two-round revise cap; lane messaging (see TASK_2026_434) | any workflow, any vendor roster |
| `orchestration` | strategy selection, phase map, checkpoint gates, team-leader modes, which role runs each phase | transport mechanics |
| `tribunal` | panel selection (family spread, explicit UI panel), anonymization, the five moves, synthesis | transport mechanics, task-ID algorithm |

## Scope

1. Create `ptah-core/skills/agent-lanes/` (SKILL.md ≤ ~150 lines, references only where a branch is genuinely optional).
2. `orchestration/SKILL.md` → router: triggers, strategy table, gate table, reference index with load conditions. Remove the inline copies of CLI delegation (L287–385), checkpoints (L198–254), strategies (L87–124), task init (L125–161).
3. `cli-agent-delegation.md` → content that remains orchestration-specific moves to `strategies.md`; transport moves to `agent-lanes`. Delete the file if nothing remains.
4. Tribunal: `vendor-panel.md` §3/§6, `relay.md:36–106`, crucible roster block → cite `agent-lanes`. `relay.md` task-ID steps → cite `orchestration/references/task-tracking.md`; checkpoint ownership → cite `checkpoints.md`.
5. `agent-catalog.md`: keep capability, selection and invocation matrices (L1–99). Profiles become one row each after relocating unique rules (six-viewport checklist at :398) and dropping stale stack-specific ones (`nx build web` at :384).
6. `task-tracking.md`: one `task.md` template (printed twice today), delete bug history (TASK_2026_182/188/189/194 narrative).
7. Resolve the contradiction `orchestration/SKILL.md:316` (parent sole spawner) vs `:335` (secondary delegation).

## Design stance: the skills lead, the UI follows

The Tribunal UI, its `[tribunal:<laneId>] (<role>)` line grammar (`vendor-panel.md` §0)
and the current move list are **not constraints**. Design the best skill shape first;
whatever the UI must change to match is filed as a follow-up task, not a reason to
keep a weaker design. The same applies to any existing move, reference name or
file layout.

Direction to evaluate on that basis: Relay is "the orchestration pipeline run on CLI
lanes". With role-addressable lanes (TASK_2026_433) it should become an orchestration
lane assignment (any phase, any role, on a subagent or a CLI lane) rather than a
tribunal move, leaving tribunal to the moves where diversity is the signal (Council,
Forge, Race, Crucible). Record the decision and the resulting UI follow-up here.

## Constraints

- Dependency guard: tribunal and orchestration both require `agent-lanes`.
  A user can disable a single skill (`harness-manifest.builder.ts:246`), which would
  dangle the links. Either enforce the dependency in the manifest/plugin loader or
  fail a spec when a skill links a sibling it does not declare.
- Cross-skill relative links resolve in every harness only because skills install as
  flat siblings (`claude-target.ts:68`, `rival-targets.ts`); pin with a spec.
- Content hash changes fast-forward user mirrors; renamed references can leave stale
  files in `~/.ptah/user` — check `UserLayerMirrorService` pruning.
- Regenerate the content manifest (`npm run manifest:generate`) in the same commit.
- Vendor names in code samples are illustrations; do not genericise them.

## Acceptance

- Each lane rule appears in exactly one file; others link to it (spec greps for
  the known duplicated phrases).
- `orchestration/SKILL.md` ≤ 7KB; record before/after KB for every touched file here.
- A representative Council and a representative orchestrated feature run end to end
  on the slimmed skills with no missing instruction.

## Evidence (tribunal consensus, estimates not tokenizer counts)

| Cut | Saving |
|---|---|
| orchestration/SKILL.md → router | ~16–18KB per trigger |
| lane transport de-dup | ~10–20KB across references |
| agent-catalog profiles | ~14–17KB when loaded |

Rejected in cross-critique: Angular `assets/*.ts` are opt-in starters, not loaded
context (bundle saving only); 73.8KB table padding tokenizes cheaply.

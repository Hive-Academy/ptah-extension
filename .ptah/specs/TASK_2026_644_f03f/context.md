# Context: lane-first and two-way messaging gaps in the shipped skills

Merged on 2026-10-12 from the residues of TASK_2026_441 and TASK_2026_434 (both now `cancelled`,
`duplicates` this task). Both were about 80% shipped. Full original scope: `../TASK_2026_441_7825/` and
`../TASK_2026_434_ce9e/`.

## Already shipped (do not redo)

- Never pick an AT LIMIT lane, the exhaustion ladder, cross-side lane review (`.claude/skills/agent-lanes/SKILL.md`).
- `lane-review` default and batches on lanes (`orchestration/SKILL.md:97`, `references/lane-assignment.md:36-39`).
- The message protocol, the SR ladder, Crucible resume-without-respawn (`agent-lanes/SKILL.md` §7,
  `orchestration/references/checkpoints.md:84-90`, `tribunal/references/crucible.md:135`).

## Left

1. ~~From 441, an owner decision: should Gate 0.1 `auto` also make lanes the default executor for phases?~~
   Answered and shipped by TASK_2026_441_7825 (PR #718, 2026-10-13): the user reopened 441 and chose
   lanes-first (Gate 0.1 reads memory first, lanes are the default executor, cross-family review, ordered
   limit fallback). 441 is `done`; nothing from 441 is left here.
2. From 434: Council cross-critique rounds (`tribunal/references/council.md`) still respawn lanes instead of
   using `ptah_agent_message` / `ptah_agent_report`. Add messaging there, and check that no other respawn
   loop remains in orchestration or tribunal.

Edit the packaged skill sources, not only the `.claude/skills` copies. TASK_2026_435 (rubric sweep) edits the
same files and runs after this task.

# Context — TASK_2026_237

## User intent

While testing the newly added Tribunal modes and workflows, the user could not
find them in the Tribunal panel. Investigation confirmed why: Relay and Crucible
were added as skill markdown only, never wired into the UI.

## Evidence gathered before planning

- `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:4` hardcodes
  `export type TribunalMove = 'council' | 'forge' | 'race';`
- `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts:83`
  renders exactly three move cards, all `enabled: true`. No Relay, no Crucible.
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:8-20`
  carries `MOVE_PHRASE` / `MOVE_FRAMING` for the same three moves only. Its
  `prepare()` builds one tile per lane and fans out flat — there is no notion of
  a phase, a role, or a round.
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md`
  documents FIVE moves (council, forge, race, relay, crucible).
- Commits that added the two missing moves touched markdown only:
  - `3524c0479 docs(vscode): add tribunal Relay move` — SKILL.md + relay.md.
  - `5cdb14d89 feat(vscode): add the crucible move` — 9 files, all markdown
    under `assets/plugins/ptah-core/skills/`. Zero TypeScript.

### Divergence between skill copies

| Copy                                            | Moves documented    |
| ----------------------------------------------- | ------------------- |
| `apps/ptah-extension-vscode/assets/plugins/...` | 5 (has crucible.md) |
| `.github/skills/tribunal/`                      | 4 (no crucible.md)  |
| `apps/ptah-docs/src/content/docs/tribunal/`     | 4 (no crucible.md)  |

`5cdb14d89` updated only the shipped asset copy, so the dev-side copy and the
public docs still describe four moves and still carry the hardcoded vendor lists
that commit set out to remove.

## User decisions (Checkpoint 0 / 0.1)

| Decision       | Answer                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| Move scope     | **Both** Relay and Crucible go into the panel — five moves total                             |
| UI depth       | **Full phase/round UI** — panel tracks Relay phase progress and Crucible round + verdict     |
| Skill sync     | User note: the tribunal plugin is still only in the plugin folder — **not published**, so no |
|                | user has it installed yet. Publication path must be settled as part of this task.            |
| CLI delegation | **Enabled, codex only.** Do not use Claude CLI or Ollama Cloud lanes for this task.          |

## Strategy

- Task type: FEATURE
- Workflow depth: Full — PM -> Architect -> Team-Leader -> QA
- `cli_delegation: enabled (codex only, max 1 concurrent)`

## Open questions for planning

1. **Full phase/round UI needs a data source.** Today the conductor agent is the
   only thing that knows which phase or round it is in; the panel only sees
   spawned-agent tiles bound by the `[tribunal:<laneId>]` tag. Decide between
   extending the lane tag (e.g. `[tribunal:<laneId>:<phase>]`), emitting a
   dedicated backend event, or having the conductor report structured progress.
2. **Relay lanes are pinnable per phase** (plan / architect / implement / review)
   and **Crucible is an unequal pair** (executor lane + judge lane from a
   different vendor family). The current wizard picks a flat set of lanes. The
   lane-selection step needs a role-assignment mode for these two moves.
3. **Crucible is sequential round-over-round** with a round cap and a frozen
   rubric. The wizard needs a rubric input and a round-cap control.
4. **Publication**: how does `ptah-core` reach users? `ContentDownloadService`
   pulls plugins from GitHub at runtime rather than shipping them in the VSIX.
   Confirm the release step and whether the five-move tribunal skill is included.
5. **Doc divergence**: recommend whether `.github/skills/tribunal/` and
   `apps/ptah-docs/src/content/docs/tribunal/` are re-synced inside this task or
   split into a follow-up.

# Context - TASK_2026_701_9e4b

## Request

User (2026-10-19): "we will need to make a task that will align both setup wizard agent generation
along with the new skills enhancements we are doing so no weird experience happens".
User (2026-10-20): add the Marketplace plugins page skill installs to this task (scope item 8).

## Background

- Evidence: `TASK_2026_662_3eea/research/wizard-skills-harmony.md` (codex research lane, branch
  `refactor/skill-synthesis-purge`, docs commit `829600e7f`). Verdict: partial harmony with
  interference risks. Claims for risks 1 and 3 were checked by the orchestrator.
- Shared path today: wizard writes `.claude/agents/<id>.md`
  (`agent-generation/.../orchestrator.service.ts:420-424,790-792`) -> user-layer mirror copies into
  workspace-scoped Library clones (`user-layer-mirror.service.ts:297-321,362-382`) -> registry catalog
  (`skill-synthesis/.../skill-registry-catalog.service.ts:39-48`) -> desktop Library.
- TASK_2026_662 keeps the Library, mirror, telemetry, review harvester and scorecard, and removes only
  the synthesis pipeline. This task starts after 662 lands (dependsOn).
- TASK_2026_650 (setup wizard) is merged (PR #763); TASK_2026_651 is analysis only and does not own
  these files (650 session reply, 2026-10-19).

## Scope (user decisions and research risks)

1. **Overwrite guard (user decision U1 in 662 `decisions.md`).** When the wizard would replace a
   differing `.claude/agents/<id>.md` (user edit or pack file), show a per-file keep/replace choice in
   the wizard preview; default keep. Today `file-writer.service.ts:221-228` writes whenever bytes
   differ. Cover pack installs too (`setup-rpc.handlers.ts:914-921`,
   `platform-core/src/agent-pack-download.service.ts:283-295,391-398`).
2. **Root alignment.** A wizard run in a subfolder writes that folder's `.claude/agents`, while the
   mirror and catalog read the harness root, so the agent never reaches the Library
   (`wizard-generation-rpc.handlers.ts:589-598`). Write to the harness root or offer the choice.
3. **Library refresh and provenance.** After a wizard write, trigger the existing mirror and catalog
   sync where the Library is available (`apps/ptah-electron/src/activation/plugin-activation.ts:373-402`).
   Label wizard/workspace-authored agents; fix the empty Agents text that says agents come only from
   plugins (`skill-clones-view.component.ts:133-139`).
4. **Library edits vs. regeneration.** A Library clone edit and a later wizard regeneration must not
   fight: define what happens to an edited clone when its source changes (mirror marks diverged today,
   `user-layer-mirror.service.ts:1539-1589`) and surface it in both UIs.
5. **Shared model setting.** Library model edits change the next wizard output for the same slug
   (`orchestrator.service.ts:1091-1100`); make this explicit in both UIs or separate it.
6. **Prompt rubric.** The skill-creator prompt-authoring rubric is not an input to wizard generation
   (`content-generation.service.ts:370-402`); align the generation prompt rules with it.
7. **Grade expectations.** A freshly generated agent shows "No grade" until a reviewed task uses it;
   say so in the wizard completion step.
8. **Marketplace plugin skills (user request, 2026-10-20).** Skills and agents installed from the
   Marketplace plugins page must join the same Library and enhancement flow as wizard output: the
   same harness root, a mirror and catalog refresh after install or removal, a plugin provenance label,
   and the item 1 keep/replace guard when a plugin file would replace a differing local file. Make
   the Marketplace installed-skills view and the desktop Library agree on what is installed. Starting
   points: `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts`,
   `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`,
   `libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.ts` (`pluginRow`,
   `pluginSourceLabel`). Related, not owned here: TASK_2026_241 (unified installed inventory) and
   TASK_2026_560 (skill on/off controls).

## Out of scope

- Per-workspace grade filtering (user decision U2) - done inside TASK_2026_662 (batches 44/59 or one
  follow-up batch there).
- VS Code Library visibility (Library stays desktop-only unless the user decides otherwise; open question).

## Open questions for the user

- Should wizard-created agents be visible in a VS Code Library view, or is desktop visibility enough?

## Next step

`/orchestrate TASK_2026_701_9e4b` after TASK_2026_662 merges: PM -> designer (wizard preview
keep/replace UI) -> architect -> team-leader. Create its own worktree from `main` first.

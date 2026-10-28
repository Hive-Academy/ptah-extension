# Requirements - TASK_2026_701_9e4b

## Context

Ptah has three ways to put agents and skills into a workspace: the setup wizard (generated agents and
community agent packs), the Marketplace plugins page (Ptah plugins, community skills and external
marketplace plugins), and the files the user writes by hand. The skills Library in the desktop app
shows a copy ("clone") of each one and lets the user edit it, enhance it, change its model and see its
grade. All three feed one pipeline. The wizard writes `{root}/.claude/agents/<id>.md`
(`libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:420-424,790-792`). The
user-layer mirror copies workspace agents and plugin skills/commands into workspace-scoped clones
(`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:350-410,2156-2216`).
The registry catalog turns clones into Library rows
(`libs/backend/skill-synthesis/src/lib/skill-registry-catalog.service.ts:42-96`). In Electron, one
coalesced pass runs mirror, reconcile and catalog sync
(`apps/ptah-electron/src/activation/plugin-activation.ts:493-508`), and every `HarnessPropagationService.propagate` call triggers that pass
(`plugin-activation.ts:556-570`; `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts:93-122`).

The parts do not fit together everywhere. Several problems can surprise the user:

- The wizard replaces any differing `.claude/agents/<id>.md` without asking. `writeIfChanged`
  writes whenever the bytes differ (`libs/backend/agent-generation/src/lib/services/file-writer.service.ts:211-240`).
  The preview only shows a "will overwrite" badge
  (`libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:549-555`;
  `agent-preview-dialog.component.ts:64-65`).
- Community pack installs replace files the same way, through an atomic rename
  (`libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:918-968`;
  `libs/backend/platform-core/src/agent-pack-download.service.ts:283-300,391-400`).
- A wizard run in a sub-folder writes that folder's `.claude/agents`. The mirror, the catalog and
  the agent-model settings all resolve the harness root instead
  (`wizard-generation-rpc.handlers.ts:1123-1131`; `harness-sync/src/lib/state/agent-sync-gate.ts:183-193`;
  `orchestrator.service.ts:1086-1110`). The Library never sees the agent.
- Pack installs never propagate, so the Library learns about them only at the next activation.
- An open Library does not update after a wizard run. It reloads only on open or when the user
  presses Refresh (`libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:69-82`).
- The Library labels every non-plugin agent "authored — no upstream source"
  (`skill-registry-catalog.service.ts:82-86`; `clone-card.component.ts:101-121`). Its empty Agents text
  says agents come only from plugins (`skill-clones-view.component.ts:133-140`). The mirror does not
  mirror plugin agents at all: it handles only `skills/` and `commands/` (`user-layer-mirror.service.ts:363-373`).
- Library model edits silently change the next wizard output for the same slug
  (`orchestrator.service.ts:1123-1146`). Library clone edits silently become "diverged" after a
  regeneration (`user-layer-mirror.service.ts:1541-1590,1646-1700`).
- The generation prompt has its own rules and does not follow the skill-creator rubric
  (`content-generation.service.ts:370-392`; `.claude/skills/skill-creator/references/prompt-authoring-rubric.md`).
- Nothing tells the user that a new agent shows "No grade" until a reviewed task uses it
  (`clone-action-gating.ts:240-253`).

The user asked for these pieces to be aligned "so no weird experience happens". On 2026-10-20 the
user added the Marketplace plugin installs to the scope. The research evidence is
`.ptah/specs/TASK_2026_662_3eea/research/wizard-skills-harmony.md`. Its line numbers were checked
against current `main` (`17860fd8b`, after PR #788). The lines cited here are the current ones. The
user decided D3: the Library stays desktop-only (Electron). There is no VS Code Library view, and
VS Code keeps compiling and keeps the wizard keep/replace guard.

## Classification

- Type: FEATURE. It adds behaviour the user sees: the keep/replace choice, provenance labels,
  Library refresh, plugin agents in the Library, and new wizard copy. It is not a defect fix of one
  path.
- Estimate: XL (the carrier says L). The size comes from eight items across at least six libraries
  (agent-generation, rpc-handlers, platform-core, plugin-marketplace, setup-wizard, skill-synthesis-ui,
  marketplace) and two hosts. It also covers two live wizard preview surfaces, a new mirror
  capability (plugin agents) and RPC contract changes in `libs/shared`. The team-leader should
  phase it.
- Priority: not defined here.

## Scope

In scope:

- Item 1: a per-file keep/replace choice for the wizard's Claude source files and for community pack
  installs. It covers both live preview surfaces and both hosts.
- Item 2: wizard and pack output goes to the harness root by default. Writing into the opened
  sub-folder becomes an explicit choice.
- Item 3: the Library refreshes after a wizard write, a pack install, or a Marketplace install,
  removal, enable or disable. Provenance labels are added and the empty Agents copy is corrected.
- Item 4: a defined outcome for an edited Library clone whose source is regenerated, shown in the
  wizard and in the Library.
- Item 5: the shared agent-model setting is stated in the wizard preview and in the Library model
  editor.
- Item 6: the generation prompt rules are aligned with the prompt-authoring rubric.
- Item 7: the completion step says when a grade will appear.
- Item 8: Marketplace plugin skills and agents join the same root, refresh, provenance and guard,
  and the Marketplace installed-skills view agrees with the Library. The guard covers every
  installer family (external plugins, community skills, Ptah plugin enable) and every local
  destination they can write, not only the external consent dialog.

Out of scope:

- Unified installed inventory, meaning one merged list of everything installed. This belongs to
  TASK_2026_241. Here the two existing views only have to agree.
- Skill and agent on/off controls. These belong to TASK_2026_560.
- Epic-level work under TASK_2026_640 that these eight items do not name.
- Per-workspace grade filtering (user decision U2). TASK_2026_662 did this work.
- A VS Code Library view or Library-dependent copy in VS Code. Excluded by user decision D3.
- TUI (`apps/ptah-tui`) behaviour. CLAUDE.md product focus puts Electron first. The TUI must keep
  compiling only.
- Keep/replace for rival-CLI copies (`.codex/agents`, `.github/agents`, …) of wizard agents. The
  harness reconciler owns those derived files under its managed manifest, the only record that
  can say "Ptah owns this path" (`libs/backend/harness-sync/src/lib/manifest-store/managed-manifest.ts:1-3`).
  It refuses to write over any file it cannot prove it wrote
  (`harness-sync/src/lib/reconciler/harness-reconciler.service.ts:940-952`). The preview keeps
  showing them for information. This exclusion does not extend to the item 8 collision
  destinations in requirement 8.
- Rewriting the authored halves of agent templates against the rubric. Item 6 covers only the
  generation prompt. A template audit would be a follow-up task.
- Moving agents that earlier sub-folder runs already wrote. There is no migration, and the
  existing files are left untouched (see Open questions).
- A separate provenance label for community-pack agents. The request names wizard, workspace and
  plugin provenance only. Pack agents show the workspace label.
- Merging the two duplicate wizard preview components into one. That is an architecture choice;
  both must meet the requirements below.

## Requirements

### 1. Overwrite guard in the wizard and for pack installs (item 1, user decision U1)

Requirement: when a wizard run or a community pack install would change the content of an existing
`.claude/agents/<id>.md`, the user chooses keep or replace for that file before anything is written.
The default is keep, so no file the user edited is lost without a decision.

Acceptance criteria:

1. When the wizard preview lists a Claude source file that already exists and whose content differs
   from what generation would write, the system shall show a keep/replace control for that file.
   Keep is preselected. This applies to both live preview surfaces:
   `agent-selection.component.ts` (wizard view) and `agent-preview-dialog.component.ts` (generation
   sidebar).
2. When the target file does not exist, the system shall show no keep/replace control for it.
3. When the user confirms with keep selected for a file, the system shall leave that file
   byte-identical after the run. The completion step shall report it as kept, separately from
   "written" and "already current".
4. When the user confirms with replace selected for a file, the system shall write the generated
   content to that file and report it as written.
5. When a tab-bound, non-resume generation start carries a replace decision set that differs from
   the confirmed preview's decision set, or carries any replace decision without a confirmed
   preview, the system shall reject the start with the existing `preview-required` rejection
   (`wizard-generation-rpc.handlers.ts:480-501`). This includes a stale tab.
6. When the preview cannot be computed and the user picks "Generate without preview", the system
   shall run in create-only mode: it creates missing files and keeps every existing file whose
   content differs. This mode carries no replace decision, so criterion 5 does not reject it, and
   it can never replace a file. A request that asks for replacement without a confirmed preview is
   rejected under criterion 5, not downgraded silently.
7. When a run resumes (`resume: true`) or a single item is retried (`wizard:retry-item`), the system
   shall apply the keep/replace decisions confirmed for that run. A retry shall never replace a file
   the user chose to keep.
8. When a community pack install would replace an existing differing `.claude/agents/<file>`, the
   system shall ask keep or replace for each such file before writing, with keep as the default.
   Files that do not exist yet, or whose content is identical, install without a prompt. This
   applies to both pack surfaces: the wizard-view Community Packs tab and
   `community-packs-panel.component.ts`.
9. When the user keeps a pack file, the system shall leave it byte-identical. The pack row shall
   show that file as kept, not as "Installed".
10. When the wizard runs in the VS Code host, criteria 1-9 and 11-14 shall hold the same way (user decision
    D3).
11. When the content check cannot read an existing file (permission error), the system shall treat
    the file as differing and default to keep. It shall never replace the file silently.
12. When a target file is created or changed between the confirmed preview and the write (for
    example the user saves a hand edit while generation runs), the system shall not write over the
    new content on the strength of the earlier decision. A file that was missing at preview time and
    exists at write time shall be kept and reported as kept. A file marked replace whose content
    changed after the preview shall be kept and reported as "changed since preview, kept". The same
    rule applies to resume, `wizard:retry-item` and pack installs. How the content is compared
    (hash, timestamp, lock) is the architect's choice. This criterion is a lane-proposed safety
    elaboration of U1 (decision PM10), not a separate user decision.
13. When a wizard run or pack install records an outcome per file, it shall use one of: written,
    kept, already current, changed since preview (kept), or failed. A failed write shall be
    reported as failed, never as kept or written.
14. When the keep/replace control is added, the existing preview-surface controls shall stay and
    keep their tests: the sidebar generation source status and generation-model picker
    (`agent-selection-list.component.ts:42-51`), and the backend warning shown on both surfaces
    (`agent-preview-dialog.component.ts:54-55`; `agent-selection.component.ts:530-538`).

### 2. Root alignment (item 2)

Requirement: agents generated by the wizard or installed from a pack land, by default, in the
`.claude/agents` of the harness root (`resolveHarnessWorkspaceRoot`). That root is the one the
mirror, catalog, model settings and other CLIs read, so the agent reaches the Library and the other
CLIs.

Acceptance criteria:

1. When the opened folder is the harness root, the system shall write to
   `{harnessRoot}/.claude/agents`, as it does today.
2. When the opened folder is below the harness root, the preview shall name the harness-root target
   folder. With the default choice, generation and pack installs shall write there.
3. When the opened folder is below the harness root, the preview shall offer the opened folder as an
   explicit alternative target. If the user picks it, the preview shall state that those agents will
   not reach other CLIs; in Electron it shall also state that they will not appear in the Library
   (the table below gives the copy per host). The current sub-folder warning
   (`wizard-generation-rpc.handlers.ts:1124-1131`) shall be shown only for this choice.
4. When the harness-root target is used, the keep/replace check (requirement 1) shall compare
   against files in the harness-root folder, not the opened sub-folder.
5. When a wizard run in a sub-folder completes with the default target, the generated agents shall
   appear in the desktop Library after the refresh in requirement 3, without reopening the app.
6. When the behaviour depends on host and target, the system shall follow this table. The
   "No Library copy in VS Code" column is the lane's implementation of D3 (decision PM6), not
   the user's verbatim wording.

   | Host / target | Written to | Library visibility (req 3, 8) | Library-specific copy | Model origin copy (req 5) |
   | --- | --- | --- | --- | --- |
   | Electron / harness root (default) | `{harnessRoot}/.claude/agents` | listed after the refresh | shown | "from your Library setting (workspace / machine)" |
   | Electron / explicit sub-folder | `{subfolder}/.claude/agents` | not listed; the preview says so | shown, as a "not in the Library" notice | same as above |
   | VS Code / harness root (default) | `{harnessRoot}/.claude/agents` | not applicable (D3) | none | "from your saved agent-model setting (workspace / machine)" |
   | VS Code / explicit sub-folder | `{subfolder}/.claude/agents` | not applicable (D3) | none; the "will not reach other CLIs" notice stays | same as VS Code above |

### 3. Library refresh, provenance and empty-state copy (item 3)

Requirement: in the desktop app, the Library shows every agent that a wizard run or pack install
wrote, labelled with where it came from, without an app restart.

Acceptance criteria:

1. When a wizard run with the harness-root target writes, keeps or leaves unchanged at least one
   agent in Electron, the system shall run the mirror and catalog pass for that workspace before
   the completion step is shown. A Library opened afterwards shall list each agent the run listed
   in its preview. A run with the explicit sub-folder target is excluded (requirement 2.6).
2. When a community pack install with the harness-root target completes in Electron, the system
   shall run the same pass. A Library opened afterwards shall list the installed agents. A pack
   install with the explicit sub-folder target is excluded (requirement 2.6, criterion 2a).
2a. When a community pack install with the explicit sub-folder target completes, the system shall
    leave the installed files in `{subfolder}/.claude/agents`, shall show the host-appropriate
    warning from the requirement 2.6 table (Electron: will not reach other CLIs and will not appear
    in the Library; VS Code: will not reach other CLIs), and shall not state or imply that the
    agents are in the Library. A test shall cover this case.
3. When the Library view is already open in Electron while a harness-root run or install from
   criterion 1 or 2 completes, the Library list shall show the new or changed entries without the
   user pressing Refresh. Sub-folder runs and installs carry no such promise.
4. When the Library lists an agent, the card and detail drawer shall show a provenance label with one
   of three values. "Setup wizard" is for agents whose current source file the wizard actually
   wrote after this change. "Plugin: <plugin name>" is for agents and skills that come from a
   plugin. "Workspace file" is for any other file in `.claude/agents`, including hand-written files,
   pack installs, and files whose origin is unknown.
5. When the user edits a wizard-generated source file by hand, the label shall still say
   "Setup wizard". Divergence is shown by the existing diverged status, not by changing the label.
6. When the Agents tab is empty, the system shall show copy that names all real sources: the setup
   wizard, files in `.claude/agents`, and plugins that ship agents. This replaces
   `skill-clones-view.component.ts:136-137`.
7. When the mirror or catalog pass fails after a wizard run or pack install whose file writes
   succeeded, the completion step shall still show the run's per-file outcome and shall add a
   notice that the Library may not show the new agents until its next refresh. The failure shall
   be logged, and the Library shall heal at its next pass. This matches the existing non-fatal
   contract for post-write propagation (`plugin-activation.ts:361-368,405-410`). A failed file
   write is reported under requirement 1.13, never as success.
8. When the host is VS Code, the wizard shall not start a catalog sync, link to the Library, or name
   it (D3). Mirroring for harness propagation stays as it is today.
9. When an agent file has no recorded wizard origin, including files the wizard generated before
   this change, the label shall be "Workspace file". The system shall not infer wizard origin from
   file content or name. A test shall cover a legacy unmarked generated file.
10. When a wizard run keeps a file (requirement 1.3, 1.12) or finds it already current, the system
    shall not record wizard origin for it and shall leave any earlier origin unchanged. A
    pack-authored file kept during generation keeps "Workspace file"; a file with recorded wizard
    origin that is kept keeps "Setup wizard". A test shall cover a pack file kept during generation.
11. When a wizard run writes a file (new, or replace chosen), the system shall record wizard origin
    for that file from then on.

### 4. Library clone edits vs. later regeneration (item 4)

Requirement: when the user has edited the Library clone of an agent and the wizard regenerates that
agent's source, the outcome is defined and visible in both UIs. Today the mirror marks the clone
diverged in silence.

Acceptance criteria:

1. When an edited clone's source is replaced by a wizard run, the system shall keep the clone's
   edited body. It shall mark the clone diverged (current mirror behaviour,
   `user-layer-mirror.service.ts:1646-1700`) and never fast-forward over the edit.
2. When the preview lists an agent whose Library clone has local edits, the Electron preview shall
   say, next to that agent, that the Library copy has edits and will need a rebase-or-keep decision
   in the Library if replace is chosen.
3. When a run completes in Electron and one or more Library clones became diverged because of it,
   the completion step shall name those agents. It shall say the choice is made in the Library.
4. When the user opens such a clone in the Library, the existing diverged status and rebase/keep
   actions shall be available. A source change made by the wizard shall be named as the reason
   (for example "Source regenerated by the setup wizard").
5. When the user picks keep for the source file in the wizard (requirement 1), the clone shall not
   become diverged from that run.
6. When the host is VS Code, criteria 2-3 shall not reference the Library (D3).

### 5. Shared agent-model setting made explicit (item 5)

Requirement: both UIs say that the Claude model chosen for an agent in the Library is the model the
wizard writes into that agent's file on the next generation. The setting stays shared; it is not
split.

Acceptance criteria:

1. When the preview lists an agent with a Library model override (workspace or machine scope) that
   the generator will apply, the preview shall show the model to be written and its origin and
   scope (workspace or machine). In Electron the origin names the Library setting; in VS Code it
   names the saved agent-model setting without mentioning the Library (requirement 2.6 table).
   Final wording is the designer's.
2. When no override applies, the preview shall show the template model, or "no model line" when the
   template declares none.
3. When an override is ignored because it is not an accepted Claude value
   (`orchestrator.service.ts:1138-1145`), the preview shall show that it will be ignored and which
   model is used instead.
4. When the user edits the Claude model of an agent in the Library model editor, the editor shall say
   that the setup wizard writes this model into the agent file the next time it generates the agent.
5. When the generation model (the LLM that writes the content, shown today as "Model:" in
   `agent-preview-dialog.component.ts:36-38`) and the agent's own model both appear, the labels shall
   tell them apart.

### 6. Generation prompt aligned with the prompt-authoring rubric (item 6)

Requirement: the system prompt that writes the repository-specific sections of generated agents
follows the rubric rules that apply to those sections. These are rules 2, 3, 5, 6, 7 and 8. Rule 7
already holds in part. Rules 1, 4, 9 and 10 concern skill structure, examples, generic skills and
measurement, and are not applied.

Acceptance criteria:

1. When the generation prompt is built (`content-generation.service.ts:370-403`), it shall carry
   these instructions:
   - Do not restate rules already in the authored half of the template (rubric 2).
   - Do not explain general engineering concepts the agent already knows (rubric 3).
   - Write no task IDs, dates or change history (rubric 5).
   - State contracts, paths and boundaries rather than narrative (rubric 6).
   - Write no rosters, counts or versions the agent can discover (rubric 7, existing).
2. When plugin skills are listed in the prompt (`content-generation.service.ts:398-405`), the prompt
   shall ask for references only to skills that are both relevant to the agent's role and that the
   agent is permitted and able to invoke (rubric 8, "An agent only receives capabilities it may
   use", `prompt-authoring-rubric.md:50-53`). Today the prompt asks only for relevance
   ("reference these skills where relevant", `content-generation.service.ts:400`).
3. When the rubric file and the generation prompt disagree on a rule this requirement names
   (including rule 8's permission gate, not only relevance), an automated test shall fail. A rubric edit without a prompt update, or the reverse, is caught in CI.
4. When the section validator (`generated-section-validator`) rejects content, its existing
   behaviour shall stay unchanged: the authored fallback ships.
5. When an agent is generated after this change, its generated sections shall contain no task ID
   pattern (`TASK_\d{4}_\d+`) and no date. A test over representative generated output shall check
   this.
6. When the permitted capability set of an agent cannot be determined, the prompt shall not ask
   the generated sections to reference any plugin skill for that agent (decision PM11).
7. When a representative generation case lists a plugin skill that is relevant to the role but
   that the agent may not invoke, the prompt and the generated output shall not reference that
   skill. An automated test shall cover this case.

### 7. Grade expectation in the completion step (item 7)

Requirement: after generation, the user learns that new agents have no grade until a reviewed task
uses them, so "No grade" in the Library is not read as a failure.

Acceptance criteria:

1. When a wizard run completes in Electron with at least one agent written, the completion step shall
   say three things. New agents show "No grade" in the Library. A grade appears after a task that
   uses the agent has been reviewed. Generating the file alone does not produce a grade. This
   applies to both completion surfaces: `completion.component.ts` and `agent-next-steps.component.ts`
   in the generation sidebar.
2. When every agent was "already current" or kept, the completion step shall not claim new agents
   were added. It shall still say that existing grades are unchanged.
3. When the host is VS Code, the completion step shall not show the Library grade copy (D3).

### 8. Marketplace plugin skills and agents in the same flow (item 8)

Requirement: skills and agents installed from the Marketplace plugins page join the same harness
root, Library and enhancement flow as wizard output. The Marketplace installed-skills view and the
desktop Library agree on what is installed.

Acceptance criteria:

Installer families and actions in scope (each named by its RPC today):

| Family | Install / update | Remove | Enable / disable |
| --- | --- | --- | --- |
| External marketplace plugin | `plugins:install-external` (two-call consent) | `plugins:uninstall-external` | workspace plugin config written on install/uninstall (`plugin-rpc.handlers.ts:745-782,784-805`) |
| Community skill (skills.sh) | `skillsSh:install` (`skills-sh-rpc.handlers.ts:295-360`) | `skillsSh:uninstall` (`:384-412`) | not applicable |
| Ptah plugin | bundled, not installed | not applicable | `plugins:save-config` (`plugin-rpc.handlers.ts:298-400`), which today reconciles with `skipUserLayerRefresh: true` (`:391-393`) |

1. When any action in the table runs, the system shall resolve the workspace to the harness root
   for every downstream step. Those steps are plugin config, mirror, catalog and harness reconcile.
2. When any action in the table completes successfully in Electron, the system shall bring the
   Library catalog up to date for the harness root. A Library opened afterwards shall show the
   added or enabled items and no longer show removed or disabled items as active (orphaned edited
   clones follow criterion 8b).
2a. When the Library view is already open in Electron while any action in the table completes, the
    Library list shall update without the user pressing Refresh.
2b. When the user switches workspace while a refresh for the earlier workspace is in flight, the
    Library shall discard that reply and show only the current workspace.
3. When an installed or enabled plugin ships agents (`agents/*.md`), the Library Agents tab shall list
   them with the provenance label "Plugin: <plugin name>". Today no plugin agent reaches the Library
   (`user-layer-mirror.service.ts:363-373`).
4. When a plugin skill is listed in the Library, its provenance label shall name the plugin.
   Marketplace plugins use the plugin's display name and Ptah plugins use their plugin name, not
   only a "clone" status. A community skill shall carry a label naming its skills.sh source
   (decision PM13).

Overwrite guard for every installer family (U1 applied to item 8):

A "local item" is any file or folder that an action in the table would create or replace in the
workspace and that is one of:

- unowned: Ptah cannot prove it wrote it (no managed-manifest entry);
- owned but edited: its path is in Ptah's managed manifest, but its current bytes differ from the
  hash of Ptah's last recorded write (`managed-manifest.ts:41-54`), so someone changed it after
  Ptah wrote it;
- a user-edited Library clone.

An owned artifact whose current bytes still match Ptah's last recorded write is an "unmodified
managed artifact". It is not a local item, and ordinary propagation may replace it without a
decision. Local items include `.claude/agents/<slug>.md`, `.claude/skills/<slug>/…` and
`.claude/commands/…` in the harness root, the rival-CLI target folders the reconciler writes, and
any destination the new plugin-agent mirror (criterion 3) adds, including destinations outside the
Library clone store. The architect shall enumerate the actual destinations of each family; none is
excluded by definition. Decision PM1 limits only the item 1 wizard guard; it does not narrow this
definition.

5. When any install, update or enable action in the table would replace a local item whose content
   differs, the system shall not replace it without an explicit replace decision for that item. With
   no decision, the item is kept. This holds for every family, whichever UI starts the action.
5a. When the external install consent dialog (`external-consent-dialog.component.ts`) is shown and
    the plan would replace a differing local item, the dialog shall list each such item with a
    keep/replace choice, keep preselected. Cancelling the dialog shall send no install request and
    change nothing (existing contract, `external-consent-dialog.component.ts:345-348`).
5b. When an action without a consent step (`skillsSh:install`, `plugins:save-config`, and the
    plugin-agent mirror) meets a differing local item, whether unowned or owned but edited, the
    system shall keep it, report it to the user as kept in the result and in the installed view, and
    offer an explicit, consent-gated replace route for it. For unowned paths the existing
    blocked-path repair (`libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:1-25`)
    is that route; today the reconciler already refuses such paths
    (`harness-reconciler.service.ts:940-952`). The unowned-path refusal alone does not prove the
    owned-but-edited case is protected: today a hand-edited managed copy is rewritten and reported
    (`managed-manifest.ts:51-54`). A test per family shall prove both the unowned refusal and the
    owned-but-edited keep after this change, including for plugin agents.
5f. When any family's install, update or enable action propagates to a destination whose path is
    in the managed manifest and whose current bytes differ from Ptah's last recorded write
    ("managed file edited after install"), the system shall keep the file byte-identical, report it
    as kept, and replace it only through the explicit replace route (5a for the consent dialog, 5b
    otherwise). A per-family acceptance fixture shall cover this case for external marketplace
    plugins, community skills, Ptah plugin enable and the plugin-agent mirror, with at least one
    fixture at a destination outside the Library clone store (a rival-CLI target). When the
    destination's bytes still match the last recorded write, the same fixture shall show ordinary
    propagation replacing it without a decision.
5c. When the content of a local item cannot be read (permission error), the system shall treat it as
    differing and keep it.
5d. When the local item is a user-edited Library clone, keep shall leave the clone body unchanged
    and mark it diverged with the plugin update as the reason (requirement 4 behaviour). Replace
    shall not overwrite the clone at install time; after a successful install it shall run the
    existing Library rebase for that clone, so the clone's rebase history and diverged handling
    stay the single path for replacing clone content.
5e. When a local item changes between the consent plan and the confirmed install, the system shall
    keep it unless the user re-approves (the existing re-approval path,
    `external-consent-dialog.component.ts:117-126`), matching requirement 1.12.
6. When the user confirms with keep, the local item shall be byte-identical after the action. The
   install report (`external-install-report.component.ts`) shall list it as kept.
7. When a plugin skill is shadowed by an already-active skill (the existing collision path,
   `plugin-rpc.handlers.ts:745-782,851-880`), the existing "will be shadowed" notice shall remain.
   Shadowing counts as keep, and no file changes. Two plugins that ship the same slug follow the
   same rule: one is active, the other is shadowed.

View agreement:

8. When the Marketplace installed-skills view and the desktop Library are both loaded for the same
   workspace, the following shall hold without a manual refresh:
   - Active items: every skill and agent of every installed and enabled plugin row, and every
     community-skill row, appears in the Library under its provenance label.
   - Shadowed items: both views mark the item shadowed; neither shows it as active.
   - No active (non-orphaned) Library entry with plugin or community provenance refers to a plugin
     or source missing from the Marketplace view.
8b. When a plugin is uninstalled or disabled and one of its Library clones carries local edits, the
    clone shall stay in the Library, keep its former plugin name in its label, and show the existing
    orphaned state (`clone-action-gating.ts:150-155`). Orphaned clones are excluded from the
    active-item rule in criterion 8. A test shall cover uninstall with an edited clone.
9. When a plugin row in the Marketplace installed-skills view shows counts, the counts shall include
   agents when the plugin ships any. The row's detail shall list the plugin's skill and agent names.

Failure handling:

10. When the primary operation of an action fails (an install write, a skills.sh fetch, an
    uninstall removal, or a config save), the RPC shall return failure with the error, keep the
    existing cleanup (a failed external write removes the partial tree and rethrows,
    `external-plugin-installer.service.ts:276-296`), and the UI shall show the error. The consent
    dialog shall stay open with the error and allow retry (`external-consent-dialog.component.ts:289-292,340-343`).
    No success, "Installed", "Removed" or kept report shall be shown for that action, and the
    Library shall not be told the item was added or removed. Tests shall cover a failed write and a
    failed removal separately.
10a. When the primary operation succeeds and the downstream mirror, catalog or reconcile step then
     fails, the RPC shall report the primary success, the failure shall be logged, and in Electron
     the UI shall show a notice that the Library may be out of date until its next refresh. The next
     pass heals the Library. A test shall cover a failed refresh after a successful install. This
     does not require a transactional installer redesign.
11. When the host is VS Code, Marketplace installs shall keep working and keep the guard in
    criteria 5-5f. Library refresh, Library labels and the Library-out-of-date notice do not apply
    (D3).
12. When the consent dialog gains the keep/replace list, its existing guarantees shall stay and be
    covered by regression tests: install/update title and upgrade-from-version disclosure
    (`external-consent-dialog.component.ts:91-99`); the approval-expired explanation (`:117-126`);
    MCP server command lines rendered verbatim as text interpolation, environment variable names
    shown without values, and the statement that Ptah will not register or run them (`:214-232`);
    the visible second-call error (`:289-292`); Cancel and Install disabled while busy (`:296-317`);
    Cancel emitting no install request (`:345-348`).

## Non-functional requirements

- Compatibility: Electron (`apps/ptah-electron`), VS Code (`apps/ptah-extension-vscode`) and the TUI
  (`apps/ptah-tui`) shall each pass typecheck and their affected tests (`npm run verify`). Shared RPC
  types in `libs/shared/src/lib/types/rpc/rpc-setup.types.ts` must stay compatible with every host
  that calls them. Source: CLAUDE.md "Keep every host compiling".
- Data safety: no code path in this task shall overwrite or delete an existing user file in
  `.claude/agents`, a local item as defined in requirement 8 (including `.claude/skills`,
  `.claude/commands` and rival-target content Ptah does not own, and managed-manifest paths whose
  current bytes differ from Ptah's last recorded write), or an edited Library clone without an
  explicit replace decision recorded for that item. Only unmodified managed artifacts may be
  replaced by ordinary propagation. This repeats U1 as a release gate, and each path in
  requirements 1 and 8 needs a test, including the per-family "managed file edited after install"
  fixture (requirement 8.5f).
- Accessibility: the new keep/replace controls shall be reachable and operable by keyboard inside the
  existing focus trap (`agent-preview-dialog.component.ts:126-145`). They shall carry an accessible
  name that includes the file path. Warning text shall keep the solid warning-fill contrast pattern
  already used in the preview modal (`agent-selection.component.ts:497-499`).
- Visual review: new and changed UI (wizard preview, completion, Library labels and empty state,
  Marketplace consent and installed view) shall be reviewed in Electron only, in dark and light
  themes.

## Stakeholders

| Stakeholder                       | What they need from this change                                       | How they will judge it                                                              |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Desktop user re-running the wizard | Hand edits and Library edits survive unless they choose to replace    | Re-run with an edited agent; the file is unchanged with the default choice          |
| Desktop user of the Library       | Every agent and plugin skill appears with an honest origin label       | New wizard, pack and plugin items appear after the run without restart; labels are right |
| Marketplace user                  | Installing a plugin does not silently replace local work; both views agree | Consent dialog lists replacements; Library and Marketplace list the same items  |
| VS Code user                      | Same overwrite safety, no references to a Library they cannot open     | Keep/replace works; no Library copy appears                                         |
| Maintainers                       | Generation prompt and rubric cannot drift apart unnoticed              | The rubric-agreement test fails on a one-sided edit                                 |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| The two live wizard preview surfaces drift: one gets keep/replace, the other does not | HIGH | HIGH | The architect names one shared contract for both surfaces, and senior-tester writes an acceptance test per surface for requirement 1 criteria 1-4 |
| The preview signature (`previewSignature`, `wizard-generation-rpc.handlers.ts:1889`) does not include decisions, so a stale tab replaces a kept file | MEDIUM | HIGH | The architect adds the decisions to the confirmed-preview contract; requirement 1 criterion 5 is covered by a handler test in `wizard-generation-rpc.handlers.spec.ts` |
| Default target moves to the harness root, and users who relied on sub-folder agents see them land elsewhere | MEDIUM | MEDIUM | The preview names the target and offers the sub-folder choice (requirement 2 criterion 3); the designer specifies the copy |
| Mirroring plugin agents creates slug collisions with workspace agents in the scoped agent root | MEDIUM | HIGH | The architect defines collision precedence in the mirror and the harness manifest; requirement 8 criteria 5-7 are tested against a fixture plugin with a clashing agent |
| Provenance cannot be derived for agents generated before this change (there is no marker in the file today) | HIGH | LOW | Requirement 3 criteria 9-11 fall back to "Workspace file" and record wizard origin only on an actual wizard write; the architect records how origin is captured; senior-tester covers the legacy and kept-pack-file cases |
| `plugins:save-config` skips the user-layer refresh today (`plugin-rpc.handlers.ts:391-393`), so enable/disable may leave the Library stale | HIGH | MEDIUM | The architect decides how requirement 8.2 is met for toggles without making every checkbox pay a full mirror; senior-tester adds an enable/disable refresh test |
| A family without a consent step meets an unowned local item and the new plugin-agent mirror bypasses the reconciler's refusal | MEDIUM | HIGH | The architect routes plugin-agent writes through the same ownership rule; senior-tester adds the per-family refusal tests in requirement 8.5b |
| Existing reconciler policy rewrites a hand-edited managed copy and reports it (`managed-manifest.ts:51-54`), so an owned-but-edited file is overwritten by propagation | HIGH | HIGH | The architect defines how scoped actions detect bytes differing from the last recorded write and route them to keep + explicit replace; senior-tester adds the per-family fixtures in requirement 8.5f |
| Live Library refresh (requirement 3 criterion 3) adds a new host-to-webview event that VS Code does not handle | MEDIUM | MEDIUM | The architect scopes the event to Electron; VS Code typecheck and tests run in verify |
| XL scope stalls review | MEDIUM | MEDIUM | The team-leader phases the work: guard and root first, then Library refresh and labels, then Marketplace; one review gate per phase |

## Decisions

| # | Decision | Options considered | Evidence | Reversible |
| - | -------- | ------------------ | -------- | ---------- |
| PM1 | The wizard guard covers Claude source files only. Rival-CLI copies of wizard agents stay informational. This exclusion applies to item 1 only and does not narrow the item 8 guard (requirement 8.5, 8.5f), which covers owned-but-edited rival copies. | (a) guard every listed file; (b) Claude source only | U1 names `.claude/agents/<id>.md` (`context.md:25-29`). Rival copies are fanned out from the source by mirror then reconcile (`wizard-generation-rpc.handlers.ts:1762-1768`); the managed manifest is the only record of Ptah ownership (`harness-sync/src/lib/manifest-store/managed-manifest.ts:1-3`), and the reconciler refuses unowned paths (`harness-reconciler.service.ts:940-952`) | yes |
| PM2 | Default target is the harness root, with the opened sub-folder offered as an explicit choice | (a) harness root only; (b) choice only; (c) harness root default + choice | Context item 2 allows "harness root or offer the choice". Model settings already resolve the harness root (`orchestrator.service.ts:1093-1100`). Keeping the choice avoids removing today's sub-folder capability | yes |
| PM3 | "Generate without preview" is a create-only, default-keep run; a replace request without a confirmed preview is rejected | (a) replace as today; (b) keep; (c) reject every no-preview start | U1 sets the default to keep. Without a preview no decision exists, so the default applies; rejecting all no-preview starts would remove today's fallback (`agent-selection.component.ts:522-529`) | yes |
| PM4 | The model setting stays shared and is made explicit. It is not split. | (a) explicit; (b) separate wizard and Library settings | `readAgentModelLayers` shares the layer on purpose (`orchestrator.service.ts:1086-1100`). Splitting would change behaviour the Library editor relies on | yes |
| PM5 | The rubric is aligned through prompt rules plus an agreement test. The rubric is not loaded at runtime. | (a) embed the rubric file at runtime; (b) align rules + drift test | The rubric is a skill-authoring document with rules (1, 4, 9, 10) that do not apply to generated sections. The mechanism stays with the architect; the outcome is the test in 6.3 | yes |
| PM6 | Grade, diverged and other Library-specific copy appears in Electron only. VS Code still discloses the model value and its shared-setting origin without naming the Library (requirement 2.6 table). This is the lane's implementation of D3, not the user's wording. | (a) both hosts; (b) Electron only; (c) Electron only for Library copy, shared-setting disclosure in both | D3 (`decisions.md:7`): the Library is desktop-only, and grades are visible only there (`skill-clones-view.component.ts:160-169`). D3 does not ask to hide the model origin | yes |
| PM7 | Plugin-shipped agents enter the Library (new mirror capability) | (a) skills only; (b) skills and agents | User wording for item 8: "Skills and agents installed from the Marketplace". The empty-state copy already promises plugin agents | yes |
| PM8 | Pack-installed agents get no distinct provenance label | (a) add a "Community pack" label; (b) "Workspace file" | The request names wizard, workspace and plugin provenance only | yes |
| PM9 | Estimate raised to XL in this document. The carrier is left untouched. | L / XL | Eight items, six or more libs, two hosts, a new mirror capability. The PM does not rewrite the carrier | yes |
| PM10 | Content that appears or changes between preview/plan and write is kept unless reconfirmed (req 1.12, 8.5e) | (a) trust the earlier decision; (b) keep and report; (c) fail the run | Preview checks existence only via `lstat` (`wizard-generation-rpc.handlers.ts:1223-1243`); U1 default keep. Lane-proposed safety elaboration, not a user decision | yes |
| PM11 | When an agent's permitted capabilities are unknown, the prompt references no plugin skill for it (req 6.6) | (a) reference relevant skills anyway; (b) reference none | Rubric 8: "Do not load instructions for tools or actions the receiving role cannot invoke" (`prompt-authoring-rubric.md:50-53`); (b) is the conservative reading | yes |
| PM12 | Replace for an edited Library clone runs the existing Library rebase after a successful install, never a direct overwrite (req 8.5d) | (a) overwrite the clone; (b) route through rebase | Requirement 4.1 never fast-forwards over an edit (`user-layer-mirror.service.ts:1646-1700`); one path for replacing clone content keeps the rebase history | yes |
| PM13 | Community skills carry a provenance label naming their skills.sh source (req 8.4) | (a) no label; (b) "Workspace file"; (c) source label | Item 8 requires the two views to agree, and the Marketplace view already groups and labels skills.sh rows (`installed-skill-rows.ts:152-162`) | yes |
| PM14 | For item 8 actions, a managed-manifest path whose current bytes differ from Ptah's last recorded write is a local item: default keep, explicit replace route (req 8.5b, 8.5f). Unmodified managed artifacts propagate as today. | (a) keep the existing "rewrite and report" policy for owned copies; (b) treat owned-but-edited as protected | `context.md:48-49` requires the guard whenever a plugin file replaces a differing local file, with no exemption for managed paths; the manifest records the hash of what Ptah wrote and distinguishes a hand-edited copy (`managed-manifest.ts:41-54`). Lane-proposed in response to review R1 | yes |

## Clarifications Needed

None. No capability is removed. The sub-folder target is kept as an explicit choice (PM2), and
every change in `parity-inventory.md` is keep or move.

## Open questions

- Should agents that earlier sub-folder runs left in `{subfolder}/.claude/agents` be offered for a
  move to the harness root? This is not blocking and is out of scope here. The user can answer it
  after seeing requirement 2 in use.
- Exact wording of the provenance labels and the grade copy. The ui-ux-designer can settle this in
  the design spec.

## Handoff

- Next specialist: ui-ux-designer (keep/replace control in both wizard preview surfaces and the
  Marketplace consent dialog, provenance labels, completion copy), then software-architect.
- Why: the user-visible shape of the guard and labels has to be fixed before the architect designs
  the preview-decision contract, the plugin-agent mirroring and the Electron refresh event.

## Review responses

Round 1 responses to `task-description-review.md` (verdict REVISE).

| Finding | Response | Where / evidence |
| ------- | -------- | ---------------- |
| 1 (Serious) | fixed | Requirement 8: installer-family table; "local item" definition (includes `.claude/skills`, `.claude/commands`, rival targets, plugin-agent destinations); criteria 5, 5a-5e (keep, explicit replace, cancel, unreadable, no-decision, clone replace via rebase, changed-after-plan); data-safety NFR; PM1, PM12 |
| 2 (Serious) | fixed | Requirement 8.10 (primary failure surfaces as failure, cleanup and dialog error kept, no success report) and 8.10a (post-success refresh failure only); requirement 1.13 and 3.7 apply the same split to wizard and pack writes |
| 3 (Moderate) | fixed | Requirement 8.8 (active-item agreement) and 8.8b (orphaned edited clones keep former plugin label and orphaned state, excluded from the active rule; uninstall-with-edits test); 8.7 duplicate slug |
| 4 (Moderate) | fixed | Requirement 8 table plus criteria 2, 2a (open Library updates without Refresh), 2b (workspace-switch replies discarded); 8.8 includes community-skill rows; risk row on `plugins:save-config` `skipUserLayerRefresh` |
| 5 (Moderate) | fixed | Requirement 2.3 and new 2.6 host/target table; 3.1 qualified to the harness-root target; 5.1 host-qualified origin copy; PM6 relabelled as the lane's implementation of D3 |
| 6 (Moderate) | fixed | Requirement 6.2 (relevance and permission), 6.3 (test covers permission gate), 6.6 (unknown capabilities), 6.7 (disallowed-capability case); PM11 |
| 7 (Moderate) | fixed | Requirement 1.14 and 8.12; parity-inventory.md rows for the sidebar source status and model picker, the dialog backend warning, and six consent-dialog guarantees |
| 8 (Moderate) | fixed | Requirement 1.5 (replace without confirmed preview rejected), 1.6 (create-only fallback), 1.12 (content changed after preview, including resume, retry and packs), 8.5e; PM3, PM10 |
| 9 (Minor) | fixed | Context: `agent-preview-dialog.component.ts:64-65`; 1.5: handler `:480-501`; parity-inventory.md: `!resume` at `:480`, action error at `installed-skills-page.component.ts:180-187`; PM1 and the rival-copy out-of-scope item now cite `managed-manifest.ts:1-3` and `harness-reconciler.service.ts:940-952` for ownership |
| 10 (Moderate) | fixed | Requirement 3.4 (wizard origin only for actual wizard writes), 3.9 (unknown/legacy falls back to "Workspace file", test), 3.10 (keep/unchanged retains prior origin, kept pack file test), 3.11; risk row updated |

No finding is disputed.

Round 1 re-review responses (`task-description-review.md`, "Outstanding findings").

| Finding | Response | Where / evidence |
| ------- | -------- | ---------------- |
| R1 (Serious) | fixed | Requirement 8 "local item" definition (unowned, owned but edited, edited clone; unmodified managed artifacts excluded; destinations outside the Library clone store included; PM1 limited to item 1); 8.5b (owned-but-edited kept with explicit replace route; unowned refusal not relied on alone); new 8.5f (per-family "managed file edited after install" fixtures, incl. a rival-CLI target, plus the unmodified-propagation control); 8.11 cites 5-5f; data-safety NFR; risk row; PM1, new PM14; parity-inventory.md rows for reconciler refusal and the new owned-but-edited row |
| R2 (Moderate) | fixed | Requirement 3.2 qualified by the harness-root target; new 3.2a (sub-folder pack install: files stay in the sub-folder, host-appropriate warning, no Library promise, test); 3.3 limited to harness-root runs and installs; parity-inventory.md pack-target row |

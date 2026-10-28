# Design Spec - TASK_2026_701_9e4b (wizard, Library and Marketplace alignment) - revision 1

Host: Electron first. VS Code keeps the keep/replace guard and drops all Library copy (D3). Design system applied: the project's daisyUI themes `anubis` (dark) and `anubis-light` in `apps/ptah-extension-webview/tailwind.config.js`, plus `--surface-*` and `base-content-muted` (`--bcm`) from `apps/ptah-extension-webview/src/styles.css`. No new tokens are introduced; deviations and proposals are listed in section 4. The prototype is at `prototype/` (open `prototype/index.html`).

Rule tags used below: [user-requested], [project-rule], [approved elaboration] (PM6, PM10, PM12-PM14 from task-description.md), [lane-proposed] (pending Gate 1.7).

## 1. Principles

1. Safe default, visible choice. Keep is preselected everywhere. Only an existing local file gets a control. [user-requested]
2. One primary action per surface. The confirm label changes with the number of replacements (templates in section 5); keep/replace is a secondary segmented control, never a primary button. [project-rule: one primary action]
3. Status is text, not colour. Every state is a badge with words; selected segments also carry a check mark. Warning uses the existing solid warning fill. [project-rule]
4. Same words in every surface. The strings in section 5 are the single source; the prototype HTML and JS use them verbatim. [lane-proposed copy]
5. An unreadable file is forced Keep on every surface: no Replace route, not selectable by click, arrow key, Space/Enter or bulk. [user-requested, requirement 1.11]
6. Wizard decisions are about the existing file only. The wizard preview runs before content is generated, so it cannot say whether generated content differs (decision A3, below). Pack and plugin rows know the incoming bytes and say "Differs from local file".

## 2. Component inventory

| # | Component | Used in | States | Maps to |
| - | --------- | ------- | ------ | ------- |
| C1 | `KeepReplaceControl` (radiogroup of two buttons) | wizard modal, sidebar dialog, pack prompt, consent dialog, repair prompt | keep (default), replace, focus (outer ring), forced keep (Replace `aria-disabled`), disabled while loading | req 1.1, 1.8, 1.11, 8.5a |
| C2 | `FileDecisionRow` (path, state badge, note, C1, "What changes") | same surfaces | new (no control), already current (pack/plugin only, no control), exists (wizard), differs from local (pack/plugin), differs if written, could not read (forced keep), edited since Ptah wrote it, not created by Ptah, edited Library copy | req 1.1-1.2, 1.11, 8.5 |
| C3 | `DiffDisclosure` ("What changes") | C2 | collapsed, expanded, loading, unavailable ("The generated content is not known until generation runs." on wizard rows; works for pack and plugin files) | req 1.1, A3 |
| C4 | `BulkDecisionBar` | above the file list | hidden when 0 existing files; never changes forced-keep rows | req 1.1 |
| C5 | `TargetRootChoice` (radiogroup of two buttons) | wizard modal, sidebar dialog (behind "Change"), pack prompt | project root (default), opened folder (warning), reloading ("Checking..."), reset note | req 2.2-2.4, 3.2a |
| C6 | `ModelOriginNote` | per agent in wizard previews | override applied, override ignored, template model, no model line | req 5.1-5.3 |
| C7 | `ProvenanceBadge` | Library card and drawer, Marketplace rows and inspector | Setup wizard, Plugin: name, Workspace file, skills.sh: owner/repo | req 3.4, 8.4 |
| C8 | `DivergedReason` line | Library card and drawer | wizard regenerated, plugin updated | req 4.4, 8.5d |
| C9 | `OutcomeSummary` (five counters + per-file list) | completion, sidebar next steps, install report | written, kept, already current, changed since preview (kept), failed | req 1.13 |
| C10 | `LibraryStaleNotice` | completion, install report, Marketplace installed view | only after a successful write whose Library refresh failed | req 3.7, 8.10a |
| C11 | `GradeExpectation` callout | completion (both surfaces) | new agents written; all kept or current; hidden for opened-folder target and VS Code | req 7 |
| C12 | `InfoOnlyTargets` (rival-CLI list) | wizard modal, sidebar dialog | definite, conditional with condition text; not controlled by C1 | parity 26-32, PM1 |

## 3. Layout and behaviour

### 3.1 Per-file keep/replace (C1-C4), both wizard surfaces

Wizard-view modal (`agent-selection.component.ts`, `ptah-native-modal` size lg), prototype `wizard-preview.html` section A. Order under the title: C5, reset/loading line, the "Writing to" path, the independent backend warnings (preserved: "Other CLIs sync agents from a different folder..." shown only for the opened-folder target as the sub-folder warning; "Could not check which CLIs are installed" and the harness-sync-unavailable warning as separate solid warnings), C4, then one block per agent. Each agent block holds the source-file row (C2 with C1) and, below it, C12 (rival-CLI targets: definite rows and conditional rows with their condition text, labelled "information only; not controlled by Keep or Replace"). The source-file decision never changes C12, and C12 is never overwritten by the keep/replace choice.

Sidebar dialog (`agent-preview-dialog.component.ts`, prototype `sidebar.html`): above the dialog the generation sidebar keeps its existing controls: generation source status, the generation (Writing) model picker, Select All Recommended / Deselect All, agent list, and the "Generate N agents" button, which is the dialog opener. In the dialog: title "Review generation targets", description, "Writing model" line, "Target: <path> (project root)" with a "Change" button that reveals C5 (reachable by keyboard; `aria-expanded`/`aria-controls`), backend warnings, C4, rows where the `definite`/`conditional` badge precedes the path and the state badge sits in the note line, C12 as a dashed block, footer. At about 400 px (captured through an iframe, see section 8) the footer wraps, the confirm button takes its own line and the replace label stays on one control row.

Target change (both surfaces, pack prompt): selecting the other target reloads the comparison. Visible sequence: the list is replaced by a "Checking generation targets..." skeleton with `aria-busy` (confirm disabled), then the new list appears, every choice is reset to Keep, and a `role=status` line says "Target changed. The comparison was run again and every choice is reset to Keep." [lane-proposed; follows from the changed-since-preview rule PM10]

Wizard row semantics (decision A3): a row for an existing readable `.claude/agents/<id>.md` carries the badge "Exists — may be replaced" and C1, default Keep. "What changes" opens its unavailable state: "The generated content is not known until generation runs." A kept agent is not regenerated at all (no content call), and the completion page says so. "Already current" is a completion outcome for the wizard; it stays a preview state only for pack installs and the Marketplace consent dialog. "Could not read file" is forced Keep on every surface; the row explains: "Ptah could not compare this file, so it is treated as different and will be kept. Replace is not available for it."

The old "will overwrite" badge (modal) and "Replaces existing file" text (dialog) are replaced by the state badge plus C1; the information is kept inside the row (parity 14). Conditional rival targets keep "May also write, if <condition>" as today.

C1 behaviour: `role="radiogroup"` of two `<button role="radio" aria-checked>`; roving tabindex (the checked radio has `tabindex=0`); arrows move and select; Space/Enter select; accessible names include the path ("Keep my file <path>", "Replace <path> with generated version", group "Keep or replace <path>"). A forced-keep Replace has `aria-disabled="true"` and `tabindex=-1`: it is announced, skipped by arrows, ignored by click and bulk, and the row text explains why. Buttons are used because the sidebar trap queries `button:not(:disabled)`.

Keyboard focus (finding 5): the focus ring is an unclipped outer ring (2px solid `base-content`, 2px offset) on every segment including the selected Keep; the selected segment also shows a check mark and the group label. Measured ring pair: base-content on surface-1 14.01:1 dark, 14.41:1 light. Prototype page `focus.html` shows all four states in both themes.

Modal keyboard parity (all modals): opening moves focus to the first focusable control; Tab and Shift+Tab wrap inside the dialog; Escape cancels (a dialog that has started writing ignores Escape and disables Cancel); focus returns to the opener. Hidden controls (the collapsed Change panel, collapsed diffs) are excluded from the trap, so the existing trap query needs `:not([hidden] *)` or a visibility test; C5 and C1 are buttons so the existing query already includes them. The consent dialog gets the same trap (or `showModal()`), which is a [lane-proposed] change to a component that has no trap today. All of this is live in the prototype (openers: "Open preview dialog", "Generate 7 agents", "Install All", "Update Acme Toolkit", "Review and replace...").

C4: "Keep all"/"Replace all" set every controllable row; forced-keep rows never change. No second confirmation because nothing is written until Confirm and the confirm label counts replacements. [lane-proposed, DS2]

Footer: summary left ("3 kept, 2 to replace", `role=status`, `aria-live=polite`), Cancel (ghost), confirm (primary). Confirm templates are per context (section 5).

Resume and retry keep the confirmed decisions; a retry never offers replace for a kept file.

### 3.2 Community packs (both entry surfaces)

Prototype `packs.html`. Entry surfaces: the wizard Community Packs tab (`agent-selection.component.ts`) and `community-packs-panel` in the sidebar. Both keep browse, expand/collapse, per-file "Install", "Install All", per-file status (Installed, Kept, Failed with reason) and "Retry". Every install action (single file or Install All) opens one prompt, even when no file differs, because the prompt carries the target choice (finding 4):

- Prompt: title `Install community pack "acme-agents"?`, C5 (project root default, opened folder alternative with the warning), the "Writing to" path, then either (a) conflicts: C4 and a C2 row for each existing file ("Differs from local file", "Replace with pack version", "What changes" works because pack bytes are known, forced keep for unreadable) plus "N other files are new and install without a question.", or (b) no conflict: "No file differs. All N pack files are new and install into the folder above." Confirm "Install pack" / "Install pack, replace N file(s)".
- Panel width: the target is shown as "Install to: <path> (project root) Change"; Change opens the same prompt target section.
- Changing the target reloads the comparison as in 3.1 (resets choices to Keep).
- Results (section D of the page): installed/kept/failed counters; kept files show "Kept" with the note "Your file was not changed. Origin stays Workspace file." (never "Installed"); a failed file shows the reason and Retry; the retry never replaces a kept file. Opened-folder completion notice per host is in section 5. Primary failure (download or write) is shown as failure with Retry, not as a refresh problem.

### 3.3 Marketplace consent dialog (C1-C4)

Prototype `marketplace.html` sections C-E. Block order inside `external-consent-dialog.component.ts` is preserved exactly: identity and footprint, "This plugin ships executable scripts" (paths as `<code>` text), "This plugin declares MCP servers" ("Ptah will NOT register or run these servers..." with the verbatim command line as text and "Sets environment: NAMES" only), "These files will be skipped (not valid UTF-8 text)", "Some skills will not take effect" (named, with `shadowedBy`), then the new section "Local files this install would replace (N)", then the install error. The new section sits after the shadowed block and before the error, so nothing existing moves (corrects the earlier "after the shadowed-skill notice and before scripts" ambiguity). The section appears only when N > 0.

Rows (C2) use these reason badges: "Not created by Ptah", "Edited since Ptah wrote it" (note "Ptah copied this on <version>. The file on disk has changed since."), "Could not read file" (forced Keep), "Edited Library copy" (replace label "Replace (rebase)", keep label "Keep my copy"; note explains the rebase and the "Diverged: plugin update" mark if kept). Confirm label: "Install X" / "Update X" with the suffix "and replace N files" only when N > 0. Cancel and the X button send nothing.

States designed: busy (Cancel and confirm disabled, "Installing..." with spinner, `aria-busy`); re-approval banner "...every choice is reset to Keep." ; install failure keeps the dialog open as `callout-err` "Install failed. Could not write <path> (<reason>). Ptah removes what it wrote for this install where it can. Check the files listed in the install report, then retry." with "Retry install" (no promise that nothing changed, because the installer's existing cleanup is best-effort, not transactional); long paths wrap (`overflow-wrap:anywhere`).

Install report (`external-install-report.component.ts`): counters Written / Kept / Shadowed / Skipped (not text); the existing named lists stay: skipped files and the named shadowed skills ("skill X is shadowed by Y and will not take effect"); new "Kept (your files were not changed)" list with per-file reasons, including "Kept: changed since approval". A refresh failure after a successful install is a non-fatal warning (C10) and the report still says the install succeeded. A failed install is its own failed report: "Install failed ...", with the written-and-removed count, never mixed with the stale notice.

### 3.4 Installs without a consent dialog, by installer family (finding 9)

All three families below have no pre-write dialog; each shows its kept files in the result and offers the same "Review and replace..." route, which opens a working repair prompt: title "Replace kept files?", "Nothing is replaced until you confirm. Choices start at Keep.", C4, one C2 row per kept file (replace labels name the source: "Replace with skills.sh version", "Replace with plugin version"), forced keep for unreadable, confirm "Replace N file(s)" (label "Close without replacing" at zero), Cancel. The same route is available from the installed-view note.

| Family | Guard | Result and installed-view treatment |
| ------ | ----- | ----------------------------------- |
| External marketplace plugin | consent dialog (3.3) | install report Kept list; inspector note "1 file kept" |
| skills.sh community skill | unowned file kept: "Not created by Ptah" | result "Skill "X" installed from skills.sh" with kept rows; installed row note "1 file kept (yours differs)" |
| Ptah plugin enable | owned-but-edited kept: "Edited since Ptah wrote it"; unreadable kept | result row per kept file; Manage page note |
| Plugin-agent mirroring | owned-but-edited kept; Library clone with edits uses "Replace (rebase)" in the consent dialog | result row; Library shows Diverged with "Source updated by the plugin <name>." |
| Community pack | pack prompt (3.2) | pack row Kept |
| Wizard generation | preview dialogs (3.1) | completion outcomes |

Action errors (finding 9, req 8.10), exact copy:
- Remove failed: `Could not remove "<name>": <reason>. It may still be installed. Press Uninstall to try again.` shown as the group's inline `role=alert` (existing pattern) while the row shows "Removing..." only during the attempt.
- Config change failed (turn plugin on or off): `Could not turn on "<name>": the plugin settings could not be saved (<reason>). It is still off. Try again from Manage.`
- Stale row: `"<name>" is no longer installed. The list has been refreshed.` (existing).
- Library model save failed: `Could not save the model setting. The agent model is still the previous value (<reason>). Press Save again to retry.`
- Load/fetch failure is a different state: per-group `Could not read this list.` with Retry (existing). Never reused for a removal failure.
- Primary failure vs refresh failure: a primary failure is shown as failure (callout-err, retry). Only after a successful write, a failed Library refresh is shown as the non-fatal warning C10 ("The Library may be out of date until its next refresh. The files were installed.").

### 3.5 Target root (C5)

Wizard modal and pack prompt: radiogroup "Where should the agents be written?" of two buttons. Card 1 "Project root (recommended)", badge "Default", path, helper (host-specific, section 5). Card 2 "Opened folder only" with the sub-folder path. Selecting card 2 shows the solid-warning notice below and reloads the comparison. When the opened folder is the harness root, C5 is not shown, only the target path line. The sub-folder `preview.warning` shows only for card 2. Sidebar dialog: "Target: <path> (project root)" and a "Change" button that reveals the same two buttons; collapsed by default for width. [lane-proposed DS4]

### 3.6 Provenance (C7) and Library

Badge is `badge badge-sm` with `--b3` fill and `--surface-border-strong` border, text `base-content`; plugin badges use a `--p` border. Never colour-only. It sits first in the meta row, before status badges. Labels: "Setup wizard", "Plugin: <name>", "Workspace file", "skills.sh: <owner/repo>". Label is derived only from the recorded origin marker (never from names or paths) by this mapping, shown in `library.html` section B (requirements 3.9-3.11, 8.8):

| Item | Recorded origin | Label |
| ---- | --------------- | ----- |
| Written by wizard generation | wizard marker | Setup wizard |
| Wizard file edited by hand | unchanged (Diverged is a separate badge) | Setup wizard |
| Wizard file kept or already current | prior origin retained | prior label, else Workspace file |
| Plugin mirror or external plugin | plugin marker | Plugin: <name> |
| Skills.sh install | skills.sh marker | skills.sh: <owner/repo> |
| Legacy or hand-made file, file Ptah did not create | none | Workspace file |
| Pack file written / kept | none / prior origin | Workspace file / prior label |
| Plugin turned off | marker kept | Plugin: <name> + "Plugin turned off" |
| Plugin uninstalled | marker kept | Plugin: <former name> + "Orphaned" |

Status words (separate from origin): In sync, Diverged, Shadowed, Plugin turned off, Orphaned. Disabled and uninstalled use different copy: `The plugin "<name>" is turned off. Your edits are kept here.` and `The plugin "<name>" is no longer installed. Your edits are kept here.`

Shared fixture (identical in `library.html`, `marketplace.html`, `completion.html`, consent and report): Ptah Release Kit 1.4.0 (bundled, enabled; skill release-notes, command release); Old Helper (bundled, turned off; agent helper-agent); Former Helper (uninstalled; agent legacy-linter, Orphaned); Acme Toolkit 2.1.0 (external; skills api-design, db-review, release-notes shadowed by Ptah Release Kit; agents architect kept as the user's Workspace file, reviewer Diverged: plugin update); tailwind-v4 (skills.sh: acme/skills, 1 file kept); acme-agents pack (docs-writer kept as Workspace file); wizard agents backend-developer (Diverged), tester, frontend-developer (kept), planner (unreadable, kept), code-reviewer, e2e-tester, data-engineer; command ship (Workspace file, Acme's ship kept off).

Library empty Agents text (replaces `skill-clones-view.component.ts:136-137`): "No agents in your Library yet. Agents arrive from the setup wizard, from files in .claude/agents, or from plugins that ship agents." with "Open setup wizard". Auto-refresh status line "Library updated: 2 agents added by the setup wizard." (`role=status`, clears on next change or when a card is opened). Loading, refresh-failure and model-save-failure states are in `library.html` section C.

### 3.7 Diverged clone (C8)

Card badge "Diverged" (warning fill) with the `why` line "Source regenerated by the setup wizard. Your edits are kept in the Library copy." or "Source updated by the plugin <name>. Your edits are kept in the Library copy." Actions: "Rebase onto new source", "Keep my copy". Drawer: Origin and Reason rows above the actions. Wizard row note (Electron only, only if the clone has edits): "Library copy has edits. If you replace, you will need to choose rebase or keep for it in the Library." Choosing Keep creates no divergence (4.5).

### 3.8 Shared model setting (C6)

Copy matrix (host x state) is on `wizard-preview.html` section C and in section 5. The generation LLM is labelled "Writing model: <model> (writes the content)"; "Model:" alone is no longer used. Library editor: label "Model for this agent", helper `aria-describedby`, scope buttons only if the editor already offers scopes.

### 3.9 Completion (C9-C11)

Prototype `completion.html` (fixture: 7 agents processed; 3 written, 2 kept, 1 already current, 1 changed since preview (kept), 0 failed). Rows: tester, e2e-tester, backend-developer written; frontend-developer and planner kept (planner because unreadable); code-reviewer already current; data-engineer changed since preview (kept). Kept rows say "not regenerated" (A3). Only clones whose source was actually replaced are named as diverged: backend-developer. Both surfaces (`completion.component.ts`, `agent-next-steps.component.ts`) show: five counters (zero counters stay visible; Failed hidden at 0 only at sidebar width), per-file list in `<details open>`, diverged naming and "Open the Library" (Electron, only if any), the grade statements, stale notice if the Library pass failed, per-file failure callouts with retry.

Grade statements (Electron, harness-root target), exact:
1. At least one agent written: "About grades. New agents show "No grade" in the Library. A grade appears after a task that uses the agent has been reviewed. Generating the file alone does not produce one." (both surfaces, same sentence).
2. All kept or current: heading "Nothing new was written", "All N agents were kept or already current. No new agents were added. Existing grades are unchanged." No grade callout.
3. Opened-folder target or VS Code: no grade copy, no Library copy.
Sidebar variants (all kept, failed write) are in `completion.html` section D.

### 3.10 Marketplace installed view (`installed-skills-page.component.ts`)

Prototype `marketplace.html` section A restores the real page: header "Skills & Plugins" with "Everything installed or enabled for this workspace. The harness copies it to each CLI you use.", the section header action, search "Search installed skills", groups in the real order Ptah plugins, Community skills, Marketplace plugins, each with count badge and Browse ("Browse Ptah plugins", "Browse community skills", "Add a marketplace"). Acme Toolkit is a Marketplace plugin. Rows keep the existing source label (Bundled, External marketplace, community source) and detail line ("3 skills · 2 agents") and add the provenance badge plus status badges. Row link opens the routed detail (docked inspector at 1100 px and wider, full-width drawer below), roving tabindex with Up/Down/Home/End, Escape closes, `aria-current` on the open row. Inspector facts: Kind, Source, Version, Provenance, Contents with "Show names" (shadowed marked, kept files noted), harness targets "In sync on N of M detected CLIs" and "Needs attention: ...", Uninstall. Manage for Ptah plugins, Uninstall for the rest. States (section B of the page): Removing..., removal failure, stale row, group empty with Browse, no match (`No <group> match "<query>".`), per-group loading skeleton, per-group load error with Retry, config-change failure. Unreadable and edited-managed notes appear under the row ("1 file kept (yours differs)"). Edited Library copies of turned-off plugins and Orphaned copies are named in a footer line. C10 notice is Electron-only. Both views use one label function.

## 4. Token values (all from existing config unless marked)

| Role | Dark (`anubis`) | Light (`anubis-light`) | Source |
| ---- | --------------- | ---------------------- | ------ |
| Page / card / row bg | base-100 #131317, surface-1 mix of base-200 88%, base-300 #242430 | base-100 oklch(97.788% .004 56.375), base-200 oklch(93.982% .007 61.449), base-300 oklch(91.586% .006 53.44) | tailwind.config.js |
| Text | base-content #e8e6e1 | oklch(23.574% .066 313.189) | tailwind.config.js |
| Secondary text | `--bcm` oklch(66.51% .0074 31.09) | oklch(48.96% .0448 348.48) | `base-content-muted` |
| Border | `--surface-border` bc 14%, strong 22% | same formula | styles.css |
| Primary button | #2563eb on #f8f7f4 | oklch(85% .138 181.07) with oklch(36% .078 188.2) | tailwind.config.js |
| Warning solid fill | #f97316 with #131317 | oklch(72% .18 55) with oklch(28% .066 53.8) | existing modal pattern |
| Ink for status text | err #ef4444, done #16a34a, need #f97316 | err #b4232a, done #13713a, need #8f5200 | `--state-ink-*` |
| Radius | box .75rem, btn .375rem, badge .25rem | box 1rem, btn 2rem, badge 1rem | theme custom properties |
| Segmented radius `--rseg` [lane-proposed deviation] | .375rem (= btn) | .5rem (theme btn radius 2rem would make the two segments pills; the control is a segmented bar) | prototype only |
| Diff add / delete rows [lane-proposed] | `color-mix(in srgb, success 14%, surface-1)` / `color-mix(in srgb, error 14%, surface-1)`, text base-content, `+`/`-` markers, context lines `--bcm` on surface-1 | same formula | resolved this revision; replaces the unmeasured literals. Implementer may use `bg-success/15` and `bg-error/15` if the pair stays above 4.5:1 |
| Type | Inter 12-14px body, 11px notes, JetBrains Mono for paths | same | tailwind fontFamily |
| Spacing | 4/6/8/10/12/16px | same | Tailwind scale |

Segmented control: height 26px; selected Keep = `base-content` fill with `base-100` text and a check mark; selected Replace = warning fill with warning-content and a check mark.

## 5. Copy strings (exact)

| Id | String |
| -- | ------ |
| keep | "Keep my file" |
| replace-wizard | "Replace with generated" |
| replace-pack | "Replace with pack version" |
| replace-plugin | "Replace with plugin version" |
| replace-skillssh | "Replace with skills.sh version" |
| replace-clone | "Replace (rebase)" / keep "Keep my copy" |
| radio aria-label | "Keep my file <path>" / "Replace <path> with generated version" / group: "Keep or replace <path>"; forced keep adds "(not available: file could not be read)" |
| diff | "What changes"; unavailable in the wizard: "The generated content is not known until generation runs." |
| bulk | "Keep all" / "Replace all"; group label "Apply to all differing files" (wizard: "N existing files"; pack and plugin: "N files can be replaced") |
| summary | "<k> kept, <r> to replace" |
| confirm, wizard modal | "Confirm Generate" / "Confirm Generate, replace N file(s)" |
| confirm, sidebar dialog | "Confirm and generate" / "Confirm and generate, replace N file(s)" |
| confirm, pack | "Install pack" / "Install pack, replace N file(s)" |
| confirm, consent | "Install <name>" or "Update <name>" / "... and replace N files" |
| confirm, repair prompt | "Close without replacing" / "Replace N file(s)" |
| state badges | wizard: "New", "Exists — may be replaced", "Could not read file"; pack and plugin: "New", "Already current", "Differs from local file", "Could not read file"; consent: "Not created by Ptah", "Edited since Ptah wrote it", "Edited Library copy" |
| unreadable note | "Ptah could not compare this file, so it is treated as different and will be kept. Replace is not available for it." |
| stale | "Targets changed since preview. Review the new list and confirm again." (modal) / "Targets changed. Review the new list and confirm again." (dialog, existing) |
| preview error | "Preview unavailable. You can still generate without a preview. Files that already exist and differ will be kept; only missing files are created." |
| target | "Where should the agents be written?" / "Project root (recommended)" / "Opened folder only" |
| target change | "Target changed. The comparison was run again and every choice is reset to Keep." |
| outcomes | "Written", "Kept (your file)", "Already current", "Changed since preview (kept)", "Failed" |
| provenance | "Setup wizard", "Plugin: <name>", "Workspace file", "skills.sh: <owner/repo>" |
| diverged | "Source regenerated by the setup wizard." / "Source updated by the plugin <name>." |
| plugin states | turned off: `The plugin "<name>" is turned off. Your edits are kept here.`; orphaned: `The plugin "<name>" is no longer installed. Your edits are kept here.` |
| library stale | Marketplace: "The Library may be out of date until its next refresh." ; wizard: "The Library may not show the new agents until its next refresh. Your files were written." |
| refresh | "Library updated: <n> agents added by the setup wizard." / "... by plugin <name>." ; failure "Could not refresh the Library. The agents on disk are unchanged. It will update on the next refresh." |
| action errors | see 3.4 |

Host / target / model-origin matrix (also rendered in `wizard-preview.html` section C):

| Case | Electron | VS Code (no Library copy, D3) |
| ---- | -------- | ----------------------------- |
| Applied model | "Agent model: **opus** - from your Library setting (workspace)." | "... from your saved agent-model setting (workspace)." |
| Ignored model | "Agent model: **sonnet** - the Library setting `gpt-5` is not a Claude model and will be ignored. Using the template model." | same with "the saved agent-model setting" |
| Template / none | "Agent model: **sonnet** (template)." / "Agent model: no model line (the template declares none)." | same |
| Default-root helper | "The Library, other CLIs and model settings read this folder." | "Other CLIs and model settings read this folder." |
| Opened-folder warning (before writing) | "Agents written to the opened folder will not reach other CLIs and will not appear in the Library." | "Agents written to the opened folder will not reach other CLIs." |
| Opened-folder notice (after writing; completion and packs) | "These agents are in <relative path>. They will not reach other CLIs and will not appear in the Library." | "These agents are in <relative path>. They will not reach other CLIs." |
| Library-edit note | shown | not shown |

## 6. Accessibility

### 6.1 Keyboard and focus
Dialog behaviour, trap contract and control semantics are in 3.1. Tab order in the modal: title, target radiogroup (one tab stop; arrows), Keep all, Replace all, per row its keep/replace group (one tab stop) then "What changes" (aria-expanded, aria-controls), Cancel, Confirm. Sidebar adds "Change" before the target group. Marketplace rows use roving tabindex. Escape cancels dialogs and closes the inspector. State and notice changes use `role=alert` only for blocking errors and warnings; the footer summary and refresh lines are `role=status`.

### 6.2 Contrast measured (WCAG 2.2 AA: 1.4.3 text 4.5:1, 1.4.11 UI 3:1, 2.4.7 visible focus), computed from config values by OKLCH to linear sRGB with channel clipping

| Pair | Dark | Light |
| ---- | ---- | ----- |
| base-content on base-100 | 14.86 | 15.91 |
| base-content on base-300 | 12.29 | 13.21 |
| `--bcm` on base-100 / 200 / 300 | 6.06 / 5.66 / 5.01 | 6.03 / 5.39 / 5.01 |
| `--bcm` on surface-1 (diff context lines, notes) | 5.71 | 5.46 |
| warning-content on warning (solid notice, selected Replace) | 6.61 | 5.67 |
| primary-content on primary (confirm button) | 4.82 | 6.84 |
| error ink on base-100 / surface-1 | 4.92 / 4.64 | 6.12 / 5.55 |
| done ink on base-100 / surface-1 | 5.62 / 5.30 | 5.71 / 5.17 |
| need ink on base-100 / surface-1 | 6.61 / 6.23 | 5.83 / 5.28 |
| focus ring: base-content vs surface-1 (selected Keep, all segments) | 14.01 | 14.41 |
| selected Keep text: base-100 on base-content | 14.86 | 15.91 |
| diff add row: base-content on success 14% mix | 11.74 | 12.78 |
| diff delete row: base-content on error 14% mix | 12.70 | 11.81 |
| selected Replace fill vs surface-1 (indicator) | 6.23 | 2.22 (below 3:1, so state is also carried by the check mark and text, see rule 4) |
| primary as focus ring on base-100 | 3.59 | 1.40 (fails; not used) |
| error-content on error (not used for text) | 3.87 | 4.12 |
| gold secondary on base-100 (not used for text) | 8.81 | 4.10 |

Rules: (1) New controls use the `base-content` outer ring (not primary: 1.40:1 in light). The earlier inner ring on selected Keep measured 1.00:1 (ring and fill were both base-content) and is replaced by the outer ring. (2) Never put text on the `error` fill; use the ink token on a tinted surface. (3) Gold is not used for small text. (4) Selected state is carried by fill, a check mark, the label and `aria-checked`; so the 2.22:1 light Replace fill is not the sole cue. (5) Diff lines carry `+`/`-` markers. Light primary is not used as small text or as the sole state cue (button label and badge borders accompany it); it is therefore not a reason to avoid the primary button or plugin badge.

### 6.3 Other
`prefers-reduced-motion` disables the skeleton pulse. Disclosure buttons expose `aria-expanded`. Loading regions use `role=status` and `aria-busy`. Both themes were rendered (section 8).

### 6.4 Target size
C1 segments are 26px high (WCAG 2.2 target size minimum 24px). If the implementer keeps `btn-xs` (24px), keep 8px between groups.

### 6.5 Responsive behaviour (about 400 px, captured)
Below 640px: split layouts stack, the inspector becomes a full-width drawer, modal footers wrap (summary on its own line, confirm on its own line), file-head paths take the full row (`overflow-wrap:anywhere`), cards become one column, rows wrap their actions. Long plugin names and long paths (consent states, long-path example) wrap and never scroll horizontally. Evidence: the `-400-` screenshots.

## 7. Empty, loading and error states

| Surface | Loading | Empty | Error |
| ------- | ------- | ----- | ----- |
| Wizard preview | "Checking generation targets..." skeleton, confirm disabled, `aria-busy`; also after a target change | no agents selected: existing | "Preview unavailable..." plus create-only "Generate without preview"; stale targets alert |
| Sidebar dialog | "Checking targets..." | none | "Targets could not be checked. Review the agents folder after generation." |
| Pack prompt | skeleton while differences are computed (also after target change) | no differing file: prompt still opens with the target choice and "No file differs." | per-file "Could not read file" forced keep; install failure with Retry |
| Consent | busy "Installing..." | no local files: section omitted | `callout-err` in dialog, "Retry install"; report for failed install |
| Library | skeleton cards | corrected Agents text | refresh failure; model save failure |
| Installed view | per-group skeleton | per-group empty with Browse | per-group load error with Retry; removal failure; config-change failure; stale row |
| Completion | n/a | "Nothing new was written" | failed file list with retry |

## 8. Prototype and screenshots

Pages (self-contained, no build, each has a dark/light toggle and honours `?theme=anubis|anubis-light`): `prototype/index.html`, `wizard-preview.html`, `sidebar.html`, `packs.html`, `marketplace.html`, `library.html`, `completion.html`, `focus.html`; styles `prototype/assets/proto.css`; behaviour `prototype/assets/proto.js`. The CSS is hand-written to mirror the config token values and daisyUI class names because the worktree has no `node_modules` (builds are out of scope). The pages were produced by a generator kept outside the task folder; the HTML in the folder is authoritative.

Screenshots (headless Microsoft Edge; `ptah_browser_*` rejects `file:` URLs). Wide captures at 1280 px, narrow captures at 400 px by loading each page in a 400 px wide iframe (headless Edge enforces a minimum window width of about 500 px, so a direct 400 px window would not produce a 400 px layout). All in `prototype/screenshots/`, dark and light each:

- 1280 px: `wizard-preview-{dark,light}.png`, `sidebar-{dark,light}.png`, `packs-{dark,light}.png`, `marketplace-{dark,light}.png`, `library-{dark,light}.png`, `completion-{dark,light}.png`, `focus-{dark,light}.png`
- 400 px: `sidebar-400-{dark,light}.png`, `packs-400-{dark,light}.png`, `marketplace-400-{dark,light}.png`, `completion-400-{dark,light}.png`

Not captured: a real Electron window; real-Electron visual review stays with the visual-reviewer after implementation.

## 9. Parity (every capability stays visible; inventory lines in the README cross-reference)

Kept and shown: preview read-only and ordered agents (24-28); rival-CLI paths with definite/conditional and condition text as information only (26-32, wizard-preview A, sidebar A); backend warnings as separate banners (29-32); entry button states (36-44, A0); targets-changed, preview-error, "Generate without preview" (35-44, B); sidebar source status, model picker ("Writing model"), selection controls, Generate button (45-51); dialog title, model, warning, certainty, cancel/confirm, focus/escape/trap (52-57); both pack surfaces with browse, expand, Install, Install All, per-file status, retry (58-59, packs A and C); pack target and result (60-64); installed-page header, search, three ordered groups, states, Manage/Uninstall/Removing, detail inspector, keyboard rows, stale row (70-85); consent identity, upgrade, re-approval, scripts, MCP disclosure, skipped files, shadowed skills, busy, error (86-93); report with named shadowed list (94-95); family removal and propagation (96-100); unowned refusal, edited-managed protection, repair route (101-103); orphan and reinstall (104-105). Nothing is removed. D3: VS Code shows no Library UI; the VS Code wording variants contain no Library text.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| A3 | Wizard preview rows use "Exists — may be replaced", default Keep, diff unavailable; "Already current" is only a wizard completion outcome; "Differs from local file" is kept for pack and plugin rows | keep "Differs from local file" in the wizard; hide the control until content is known | Architect plan decision A3: the preview runs before generation (`wizard-generation-rpc.handlers.ts:1223-1244` lstat only; content produced in `orchestrator.service.ts:835-874`), so a differs claim is not knowable | yes |
| DS1 | Keep/replace is a two-button segmented radiogroup with roving tabindex | checkbox; native radios; dropdown | Sidebar trap sees only `button:not(:disabled)` (`agent-preview-dialog.component.ts:126-145`) | yes |
| DS2 | Bulk bar with no extra confirm; confirm label counts replacements | modal confirm; none | Nothing is written before Confirm | yes |
| DS3 | Diff is an inline "What changes" disclosure (unavailable state in the wizard) | side-by-side; link to Library diff | Narrow surfaces; pack and plugin bytes are known | yes |
| DS4 | Target choice: two buttons in modal and pack prompt, behind "Change" in the sidebar | always expanded; dropdown | Req 2.3; 380 px width | yes |
| DS5 | Provenance labels as listed, derived from the origin marker | other words; icon-only | PM13; text avoids colour-only | yes |
| DS6 | Focus ring is an unclipped outer base-content ring on all segments plus a check mark on the selected one | inner ring (measured 1.00:1 on selected Keep); outline-primary (1.40:1 light) | Section 6.2 | yes |
| DS7 | Grade copy uses "No grade" and the three statements in 3.9 | tooltip only | Req 7.1; `clone-card.component.ts:236` | yes |
| DS8 | Library auto-refresh shows a status line | silent; toast | Req 3.3 | yes |
| DS9 | Consent shows the Library clone as a keep/replace row "Replace (rebase)" | hide; separate dialog | Req 8.5d | yes |
| DS10 | Kept files after no-consent installs open one shared repair prompt | no route; inline replace | Req 8.5b | yes |
| DS11 | Pack install always opens the prompt (carries the target choice) | skip prompt when no conflict | Review finding 4; req 2.2-2.4, 3.2a | yes |
| DS12 | Segmented radius deviates in light (.5rem) and diff rows use a 14% success/error mix | theme btn radius; literal colours | Section 4, measured in 6.2 | yes |

## Clarifications Needed

None block design. For the architect: whether the preview RPC can return pack and plugin diff payloads for DS3 (the wizard has none by A3); and whether `ptah-native-modal` and the consent `<dialog>` already trap focus (the prototype assumes the trap contract in 3.1 and flags the consent dialog as needing one).

## Review responses

Round 1 of 2, responding to `design-spec-review.md`.

| # | Result | Where |
| - | ------ | ----- |
| 1 Marketplace installed-view parity | Fixed | 3.10; `marketplace.html` A (header, harness text, search, ordered groups, Acme under Marketplace plugins, source labels plus provenance, inspector, roving rows) and B (Removing, stale, no-match, empty, loading, error) |
| 2 Consent and report parity | Fixed | 3.3; `marketplace.html` C-E (scripts, MCP verbatim, env names, skipped files, named shadowed list, busy, Local-files insertion point after shadowed) |
| 3 Wizard parity, informational rival targets | Fixed | 3.1; `wizard-preview.html` A (backend warnings, genuine definite/conditional rival rows, source decision separate), `sidebar.html` A (source status, model picker, selection controls, Generate opener, rival block); `packs.html` A and C (both pack surfaces) |
| 4 Target choice for packs, sidebar reachability | Fixed | 3.2, 3.5; `packs.html` A-D; `sidebar.html` "Change"; reload and reset behaviour live; completion notices in section 5 |
| 5 Selected Keep focus, modal keyboard parity | Fixed | 3.1, 6.2, DS6; `focus.html`; live dialogs with focus placement, trap, Escape, restore; targets are buttons |
| 6 Unreadable file forced Keep | Fixed | 3.1; `wizard-preview.html` A, `sidebar.html`, `packs.html` B, `marketplace.html` C and F (Replace is `aria-disabled`, bulk skips it) |
| 7 Shared fixture and provenance edge states | Fixed | 3.6; `library.html` A, A2, B; the same fixture in `marketplace.html` and `completion.html` (shadowed, kept, plugin-update diverged, turned off vs orphaned, legacy and pack files) |
| 8 Completion contradictions and grade copy | Fixed | 3.9; `completion.html` A-D (3+2+1+1+0=7, only backend-developer named diverged, full outcome contract and grade sentence in both surfaces, sidebar variants) |
| 9 Installer-family guards, primary failures | Fixed | 3.4; `marketplace.html` B, D, F, G (family guard map, repair prompt, exact action-error copy); no "no files changed" promise |
| 10 Copy consistency across interaction and hosts | Fixed | Section 5 templates (JS uses per-context `data-tpl-*`), host matrix, one opened-folder notice |
| 11 Responsive and token handoff | Fixed | 4 (diff mapping and `--rseg` resolved), 6.2 (all new pairs measured), 6.5, 400 px screenshots |
| 12 Rule provenance and parity mapping | Fixed | Rule tags at the top and in README; inventory cross-reference in README and section 9; no blanket ban of any project component |
| A3 (architect, binding) | Applied | Principle 6, 3.1, section 5, Decisions A3, completion "not regenerated" rows |

Disputed: none (0). Fixed: 12 of 12 plus A3.

## Revise round 2 (Gate 1.7, last round)

Fix-ups only. D3 and D7-D11 in decisions.md are unchanged. Each open item from `design-spec-review.md` "Round 1 re-review" maps to its fix below. Screenshots are in `prototype/screenshots/` (dark and light, re-taken with headless Edge). Interactive states are captured through `?open=<key>` (a screenshot-only URL parameter in `proto.js`).

| Item | Fix | File and location | Evidence |
| --- | --- | --- | --- |
| R1-1 (Serious, finding 1) Marketplace inspector facts and search | The inspector shows the selected item's description, facts (kind, source, version, provenance, contents), names, kept-file note, sync line and action. Fixtures: Ptah Release Kit (bundled plugin), Old Helper (turned off), tailwind-v4 (community skill), Acme Toolkit (kept as the default). Search matches when every query word appears in name, description, source or kind, so `acme/skills` finds tailwind-v4. | `prototype/marketplace.html` section A (inspector ids `insp-*`, row `data-search`, `window.PROTO_INSPECT` before `proto.js`); `prototype/assets/proto.js` Marketplace click handler and `input` search handler | `marketplace-inspector-community-{dark,light}.png`, `marketplace-inspector-bundled-{dark,light}.png`, `marketplace-{dark,light}.png` |
| R1-2 (Serious, finding 4) pack entry routes | Every pack install path opens the one target-choice dialog: wizard Install All, Choose location, per-file Install and Retry; sidebar Change, Install All and Retry. The opener's `data-scope` (pack or file) rewrites the title, scope line and file rows. Collapse/Expand toggles the file list (`aria-controls`). Root target is the no-conflict branch; Opened-folder target is the changed branch, with `perf-tuner.md` as "Differs from local file", default Keep, reset to Keep on target change. Host notices are kept. | `prototype/packs.html` sections A and C (`data-open="ov-pack"`, `data-scope`, `data-file`, `data-for-target`, `data-sub-row`); `proto.js` `scopeDialog`, `applyTarget`, `data-toggle` handler | `packs-{dark,light}.png`, `packs-file-scope-*.png` (root, one file, no conflict), `packs-subfolder-*.png` (changed comparison), `packs-400-*.png` |
| R1-3 (Serious, finding 9) plugin-agent repair | The repair prompt is bound to the installer family that opened it. skills.sh lists `tailwind-v4/SKILL.md`; plugin enable lists `release-notes/SKILL.md` and the forced-Keep `release.md`; plugin-agent mirroring lists `.claude/agents/release-manager.md` (default Keep, "plugin version" label, comparison, count). The generic opener is removed and the dialog starts closed. | `prototype/marketplace.html` section F (`data-family`, `data-repair-for`, new `release-manager.md` row, `data-bulk-count`); `proto.js` `scopeDialog` | `marketplace-repair-agent-*.png`, `marketplace-repair-plugin-*.png` |
| R1-4 (Serious) sidebar D7 contradiction | Sidebar `backend-developer.md` starts on Keep my file; "Replace" is reached only by selecting it. The first confirm label reads "Confirm and generate". | `prototype/sidebar.html` section A (first row radiogroup) | `sidebar-{dark,light}.png`, `sidebar-400-*.png` |
| R1-5 (Moderate, finding 3) warnings vs targets | The "Other CLIs sync from a different folder" warning is hidden for Project root and shown only for the opened-folder target (`data-when-target="sub"`). "Harness sync is not available" is a separate state (sidebar section B) that lists no rival rows; "Could not check which CLIs are installed" is a separate wizard state (wizard-preview.html state box "CLI detection failed") with no rival rows. The default sidebar and wizard views show listed rival rows with no warning. | `prototype/wizard-preview.html` section A and states; `prototype/sidebar.html` sections A and B | `wizard-preview-*.png`, `sidebar-*.png` |
| Findings 1, 3, 4, 9 (partial) | Closed by R1-1, R1-5, R1-2 and R1-3. | See rows above | |

Decisions: the dialog scope is carried by opener attributes, so one dialog serves every entry (reversible, prototype only). No new tokens or colours were added; all styles reuse `proto.css`, which maps the Anubis and Anubis-light tokens. Contrast pairs are unchanged from section 6.5; the new Keep/Replace and callout rows use the same classes.

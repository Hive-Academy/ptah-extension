# Frontend implementation — `TASK_2026_701_9e4b`, batch 25

**Verdict**: COMPLETE. Scoped verify: 5 of 6 tasks passed. The one failure is the accepted
pre-existing `ptah-extension-webview:lint` (D19, circular dependency at `app.routes.ts:224`).

**Tasks completed**: 25.1. This covers the installed rows, page and detail, the inventory store, and
`PluginConfigHomeNoticeComponent`.

## Files

All paths are under `libs/frontend/marketplace/src/lib/`. No other file was edited.

- MODIFIED `pages/skills/installed-skill-rows.ts`
  - The row gains `provenance`, `contents` (count line and names) and `shadowedAgents`.
  - Adds `pluginContents`, `shadowedAgentNames` (F7f) and `orphanedCopyNames`.
  - A marketplace row is joined with its catalogue entry to get its contents.
  - Search now also matches the kind label.
- MODIFIED `pages/skills/installed-skill-rows.spec.ts`
  - The exact-row case is updated.
  - Adds 7 contents/provenance/shadow cases and 1 R1-1 search case. The existing search cases are
    unchanged.
- MODIFIED `pages/skills/installed-skills-page.component.ts`
  - Adds a provenance badge and a "N agents shadowed" badge on each row.
  - Adds the orphaned footer line.
  - Mounts the notice under the header (Electron only) and sends its failure to the plugins
    `actionError`.
- MODIFIED `pages/skills/installed-skills-page.component.spec.ts`
  - The catalogue stub gains `configHome`. The VS Code stub is now a mutable object.
  - Adds 6 cases: four-field search, badges and agent count, Electron shadow plus orphaned, no
    notice, never outside Electron, and notice position plus failure in `actionError`.
- MODIFIED `pages/skills/skill-detail.component.ts`
  - Adds Version and Provenance (badge) facts, and contents for marketplace plugins.
  - Adds a "Show names" disclosure with shadowed agents marked, and a shadowed note.
  - Removes the now-unused `plural` import.
- MODIFIED `pages/skills/skill-detail.component.spec.ts`
  - The stub gains `libraryClones`.
  - Adds 4 cases: plugin version/provenance/contents/names, community provenance, the shadowed
    agent, and the inspector following the selected row.
- MODIFIED `data/marketplace-inventory.store.ts`
  - The plugins cell now holds the Library copies (`CloneSummary[]`).
  - In Electron the plugins load reads `skillSynthesis:listClones` alongside the catalogue.
    A failed read degrades to `[]`.
  - Exposes `libraryClones`.
- MODIFIED `data/marketplace-inventory.store.spec.ts`
  - Adds a `library copies (F7f)` describe with 4 cases: none outside Electron, read in Electron,
    degrade on failure, and dropped on a workspace switch.
- CREATED `pages/skills/plugin-config-home-notice.component.ts` (D14 notice; pure helpers
  `configHomeBlocks`, `relativeFolder`, `configHomeFailure`)
- CREATED `pages/skills/plugin-config-home-notice.component.spec.ts` (16 cases)

## Quality requirements -> evidence

| Requirement | Where |
| --- | --- |
| Every existing group/state unchanged | No change to group order, labels, counts, loading, error/Retry, empty, no-match or row actions (`installed-skills-page.component.ts` template). Every pre-existing case in the four existing specs passes. The only change to them is the exact-row `toEqual`, which gained the 3 new fields. |
| Provenance badge | Row: `installed-skills-page.component.ts:316-326` (`provenanceLabel` from `@ptah-extension/shared`). The classes match the Batch 22 `ProvenanceBadgeComponent`: `border-primary` for plugin, the strong surface border otherwise. Inspector: Provenance fact rendered as the same badge (`skill-detail.component.ts:74`, template `skill-detail-provenance`). Provenance per kind: `installed-skill-rows.ts:264,287,317`. |
| "N skills · M commands · K agents" + names | `pluginContents` `installed-skill-rows.ts:203`. Agents appear only when the host counts them (`agentCount`, else the `agentNames` length), so legacy payloads keep the 2-part line. Names: `skillNameGroups` `skill-detail.component.ts:144` plus the "Show names" `<details>` (`:304`). |
| Inspector facts follow the selected row | All facts come from the resolved `match.row`, and the route parameter drives the match (`skillFacts` `skill-detail.component.ts:92`). Spec "follows the selected row: opening another item replaces every fact". |
| Multi-word search across name/description/source/kind | `installed-skill-rows.ts:394-402`: today's matcher, extended with `SKILL_KIND_LABELS[row.kind]`. The existing search parity cases are unchanged and green. New: `acme/skills` finds tailwind-v4 only; "lint marketplace" matches across kind and name. |
| Agent shadow state (F7f) | `shadowedAgentNames` `installed-skill-rows.ts:226`: same agent slug, provenance resolved and not this plugin. Data: `readLibraryClones` `marketplace-inventory.store.ts:493` (Electron only). Row badge `installed-skills-page.component.ts:327-337`. Inspector note and the "Shadowed" mark on the name. |
| Notice copy and roles exactly as plan :1344-1356 | `configHomeBlocks` `plugin-config-home-notice.component.ts:89-137`: conflict `role=alert` (`:104`) with one "Use settings from <folder>" per candidate; differs `role=status` (`:120`) with Use plus Dismiss; imported `role=status` (`:132`) with Dismiss. The spec checks each sentence verbatim. Styling: `alert alert-warning` (the solid warning used by the Batch 24 report). |
| Buttons busy/disabled during the call | `[disabled]="busyKey() !== null"` `:179`, `aria-busy` `:169`, and a spinner on the clicked button. A re-entry guard is in `run()`. Spec "disables every button and marks the notice busy while the call runs". |
| Failure in `actionError`, no raw error text | The notice emits fixed copy (`configHomeFailure` `:140`). The page binds `(failed)` to `setPageError('plugins', …)` (`installed-skills-page.component.ts:137`, `:610`), which renders in the existing `group.actionError ?? pageErrors()[id]` alert (`:194`). The specs check that `EACCES` / `socket hang up` never render. |
| Null renders nothing | `configHomeBlocks` returns `[]` for `null`, for `home`, and for a status with no candidates. Specs cover all three. |
| Folder paths relative to the harness root | `relativeFolder` `:46`: separators are normalised, a Windows drive root compares case-insensitively, and a folder outside the root or a sibling prefix (`repository` vs `repo`) is shown as-is. Text and buttons use `[overflow-wrap:anywhere]` (`:171,176`). |
| Inventory store drops its data on workspace switch | The copies live in the plugins cell (`marketplace-inventory.store.ts:180`). They share its generation guard and the `discardData` clear on a generation bump (`:432`). Spec "drops the copies on a workspace switch and reads the new ones" checks that they are empty before the new read answers. |
| Notice calls `plugins:resolve-config-home` then reloads the catalogue | `:230` then `inventory.reload('plugins')` `:237`, which calls `PluginCatalogService.refresh()` and keeps the plugins slice state consistent. The spec checks the call order and the candidate's own folder being sent. |
| Angular rules | Standalone, OnPush, `inject()`, `output()`, `signal`/`computed`. No `[innerHTML]`. No `any`, `@ts-ignore` or `as unknown as`. Imports go only through `@ptah-extension/{core,shared,chat-ui}`. The RPC has an explicit timeout (`MARKETPLACE_RPC_TIMEOUTS.PLUGIN_INSTALL_MS`). |

## Decisions

- **The notice is mounted only in Electron** (`@if (isElectron())`, page `:136`).
  - Options: always mount it and rely on `configHome` being null outside Electron.
  - Evidence: plan :1355 says Electron only. Also, `marketplace.routes.spec.ts` (not in this
    batch) stubs `PluginCatalogService` without `configHome`, so an always-mounted notice would
    break that spec.
  - Reversible: yes.
- **An agent copy with an unresolved provenance is not "Shadowed".**
  - Options: treat an absent provenance as "workspace", which would mark it shadowed.
  - Evidence: `CloneSummary.provenance` is documented as "absent when the producer did not
    resolve it". F7f says "a clone with another provenance", and an absent provenance is not a
    known other provenance.
  - Reversible: yes, one condition in `shadowedAgentNames`.
- **The Library copies are carried in the plugins slice cell, not in a fifth slice.**
  - Evidence: this reuses the cell's generation, destroy and workspace guards. A failed copies read
    degrades and never fails the plugin list.
- **One notice block per differing or imported candidate.**
  - Evidence: the plan copy is singular, but the backend can return several candidates, and
    dismiss is per folder (`plugin-config-home.ts` `dismissed[candidate.key]`).
- **New copy (no design text):**
  - Inspector shadow note: "A Library agent with the same name and another origin is used instead:
    <names>."
  - Notice failures: "Could not use the plugin settings from <folder>. Try again." and "Could not
    dismiss the plugin settings notice. Try again."
  - Plugin Version fact: "Bundled with Ptah" / "Not declared" (prototype wording).
  - Orphaned line: the prototype sentence.

## Verification

Command (run twice: once, and once more after a lint fix):
`npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview`

- Run 1: `NX 6 tasks: 4 succeeded, 2 failed`.
  - `@ptah-extension/marketplace:lint` reported `skill-detail.component.ts 38:3 'plural' is defined
    but never used`. Fixed.
  - The `no-useless-assignment` warning in the notice was also fixed.
- Run 2: `exit 1`, `NX 6 tasks: 5 succeeded, 1 failed`, `✖ nx run ptah-extension-webview:lint`.
  - Its only error is `224:7 error Circular dependency between "ptah-extension-webview" and
    "@ptah-extension/command-center"`, the accepted D19 failure.
  - The marketplace lint, test and typecheck targets and the webview test and typecheck targets
    passed.
  - The dynamic output style printed no "Running target … for N projects" header. The 6 tasks are 3
    targets for each of the 2 projects.
- `ptah_get_diagnostics` reports no errors in any changed file. The sibling errors it lists
  (`mock-rpc-service.ts`, `harness-health.store.spec.ts:672`, BigInt targets) already existed.
- Not run: the phase-end keep-alive `npm run verify -- -t typecheck,test -p
  ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`, because the batch prompt scoped
  verification to the two projects. The changes are marketplace-internal, add no public export and
  change no shared type.

## Plan deviations

- **Kept-file notes under a row and in the inspector are not rendered.**
  - The design asks for "1 file kept (yours differs)" and a kept note.
  - No RPC lists kept items for an installed item: `rpc.types.ts` has only
    `plugins:replace-kept-items`, and kept items are reported only in install results.
  - Adding the notes needs a backend read, outside this batch's files.
- **Only the orphaned half of the footer is rendered.**
  - The prototype also has a turned-off sentence ("Old Helper is turned off, not removed: …").
  - That sentence needs to know which copies are edited. `CloneSummary` does not show whether a
    turned-off copy is edited, so it is omitted.
- **C10 (`libraryPass: 'failed'` after an adopt) is not shown on the installed page.** The
  `plugins:resolve-config-home` result's `libraryPass` is ignored, and the Library refresh state
  comes from `LibraryChangeFeed`. A follow-up could render the Marketplace C10 sentence when an
  adopt answers `libraryPass: 'failed'`.

## Open issues

1. The kept-notes RPC gap above. It needs a backend task.
2. `installed-skills-page.component.ts` is now 703 physical lines. Lint `max-lines` (700, which
   skips blanks and comments) does not flag it, but the next addition should go into a child
   component, such as a row component.
3. Visual review (P3, Electron dark, light and narrow) is still due. Badge wrapping at narrow widths
   uses `max-w-[40%]` plus `[overflow-wrap:anywhere]` on the row provenance badge.
4. The phase-end keep-alive verify for the four host projects (see Verification) is still to run.

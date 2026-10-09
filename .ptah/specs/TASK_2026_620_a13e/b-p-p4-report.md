# B-P sub-batch P4 — Thoth UI switches (TASK_2026_620_a13e)

Plan: `pause-switches-plan.md` §2, §3.1, §3.6, §3.7, §4 "P4", §5 frontend row. Contract: `b-p-p3-report.md`. Nothing committed.

## Files changed

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`

**memory-curator-ui**

- CREATED `…\libs\frontend\memory-curator-ui\src\lib\components\memory-pause-switch.component.ts`: the "Memory" header switch.
- CREATED `…\libs\frontend\memory-curator-ui\src\lib\components\memory-pause-switch.component.spec.ts`
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\components\memory-curator-tab.component.ts`: mounts the switch at :149 and adds the `pausedChange` output.
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\components\memory-curator-tab.component.spec.ts`
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`: "Run curator now" is greyed out while paused, with a paused notice.
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.ts`: adds `MemoryPausedError`, which `runNow` throws on `errorCode: 'PAUSED'`.
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts`
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.ts`:
  - New: `memoryEnabled`, `memoryEnabledCommitted`, `memoryPaused`, `loadMemoryEnabled()`, `setMemoryEnabled()`, `pausedNotice`.
  - `runNow` now handles the paused case.
- MODIFIED `…\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.spec.ts`
- MODIFIED `…\libs\frontend\memory-curator-ui\src\services.ts`: exports `MemoryDiagnosticsRpcService` for the dashboard.

**skill-synthesis-ui**

- CREATED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skills-pause-switch.component.ts`: the "Skills" header switch.
- CREATED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skills-pause-switch.component.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts`:
  - Mounts the switch at :170 and adds the `pausedChange` output.
  - Run Curator is greyed out while paused.
  - The `enabled` form control is removed, and Save also deletes `enabled` (:1037).
  - Passes the paused state down to Activity and Library.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.ts`: the "Enabled" checkbox is gone. A note now points to the header switch.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\diagnostics\skill-activity-feed.component.ts`: adds the `paused` input and `pausedRefusal` output. "Analyze current session" is greyed out while paused, with a paused notice.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\diagnostics\skill-activity-feed.component.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`:
  - Adds the `skillsPaused` input and `pausedRefusal` output.
  - Shows a paused banner and greys out Enhance.
  - A `PAUSED` refusal shows as an info toast, not a preview failure.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`: `enhanceBlockedReason` input on "Enhance now".
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.ts`: the same input on the drawer's "Enhance now", with the reason shown as text.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`: adds `SkillsPausedError` and `throwIfSkillsPaused()`, used by `runCurator`, `previewEnhancement` and `enhanceNow`.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-diagnostics-rpc.service.ts`: `analyzeNow` throws `SkillsPausedError`.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-diagnostics-rpc.service.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-diagnostics-state.service.ts`: `analyzeNow()` resolves `'paused' | 'done'` and adds `pausedNotice`.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-diagnostics-state.service.spec.ts`
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-state.service.ts`:
  - New: `skillsEnabled`, `skillsEnabledCommitted`, `skillsPaused`, `refreshSkillsEnabled()`, `setSkillsEnabled()`, `markSkillsPaused()`.
  - New constants: `SKILLS_PAUSED_REASON` and `SKILLS_PAUSED_NOTICE`.
- MODIFIED `…\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-state.service.spec.ts`

**dashboard / thoth-shell**

- MODIFIED `…\libs\frontend\dashboard\src\lib\services\thoth-status.service.ts`:
  - `summary().paused` and `ThothPillarStatus.paused`.
  - `refreshPaused()` (:315) reads `memory:getTriggers` and `skillSynthesis:getSettings`, and `refresh()` calls it.
- MODIFIED `…\libs\frontend\dashboard\src\lib\services\thoth-status.service.spec.ts`
- MODIFIED `…\libs\frontend\dashboard\src\lib\services\thoth-status-pillars.spec.ts`
- MODIFIED `…\libs\frontend\thoth-shell\src\lib\components\thoth-shell.component.ts`:
  - "Paused" badge on the sidebar tile (:134).
  - `(pausedChange)` on both tabs (:192, :195) calls `refreshPaused()`.
  - Focus and visibility listeners, removed on destroy.
- MODIFIED `…\libs\frontend\thoth-shell\src\lib\components\thoth-shell.component.spec.ts`

## Where each switch renders

| Switch     | Component                                                                       | Placement                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Memory** | `MemoryPauseSwitchComponent` (`memory-pause-switch.component.ts`, input at :90) | `memory-curator-tab.component.ts:149`: the first block under the tab header, above the stats strip, on every Memory sub-view  |
| **Skills** | `SkillsPauseSwitchComponent` (`skills-pause-switch.component.ts`, input at :90) | `skill-synthesis-tab.component.ts:170`: the first block under the tab header, above the stats strip, on every Skills sub-view |

Both switches follow the `go-vet-consent-config` pattern:

- DaisyUI `toggle toggle-sm toggle-primary`, `role="switch"`, `[attr.aria-checked]`, and a `<label for>` that names it "Memory" / "Skills".
- A `min-h-6 min-w-6` label for the 24 px hit target, and a `focus-visible:outline-2` ring.
- `aria-describedby` points to the plan 3.3 copy and to an `aria-live` status area.

State display:

- **On:** green dot plus the text "On".
- **Paused:** a `badge badge-warning` reading **"Paused"**, and the whole card turns `border-warning/60 bg-warning/10`.
- **In flight:** "Saving…". **Not yet read:** "Checking…".
- The switch is disabled while the value is unknown or a write is in flight.
- The change applies immediately. There is no Save.

The sidebar tiles in `thoth-shell.component.ts:134` show a `badge badge-warning badge-xs` "Paused" next to "Memory" / "Skills". It is part of the tab button's accessible name.

## Paused state per manual action

The reason text is `Paused — resume Memory to run` / `Paused — resume Skills to run`, the wording plan 3.6 specifies. It appears both as a visible hint next to the control and as the `title`.

| Action                                      | Where                                                                                   | Greyed                                                                                                      | Reason text                                                                                                                                | `PAUSED` refusal (paused elsewhere, tab not yet refreshed)                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Memory "Run curator now"                    | `memory-diagnostics-accordion.component.ts:189` (Maintenance view)                      | `[disabled]` includes `paused()`. `runNow()` also refuses locally.                                          | hint `run-curator-paused-hint` (:199) and `title`                                                                                          | `MemoryPausedError` → switch set to paused, plus a `role="status"` warning notice `memory-paused-notice` (:176). The error alert is not used.                                                                      |
| Skills "Run Curator"                        | `skill-synthesis-tab.component.ts:160` (header)                                         | `[disabled]` includes `skillsPaused()`, and the handler is guarded (:1061)                                  | hint `run-curator-paused-hint` (:149) and `title`                                                                                          | `SkillsPausedError` → `markSkillsPaused()` (:1067). The button greys out with the reason, and no error toast appears.                                                                                              |
| Skills "Analyze current session"            | `skill-activity-feed.component.ts` (Activity view)                                      | `[disabled]` includes `paused()`, and the handler is guarded                                                | hint `analyze-paused-hint` (:48) and `title`                                                                                               | `analyzeNow()` resolves `'paused'`, and the feed emits `pausedRefusal`, which makes the tab call `markSkillsPaused()`. A `role="status"` notice `analyze-paused-notice` (:76) appears. The error line is not used. |
| Skills "Enhance now" (`previewEnhancement`) | `clone-card.component.ts:257` and `clone-detail-drawer.component.ts:186` (Library view) | `enhanceBlockedReason` set by `skill-clones-view.component.ts:317, :362`, and the handler is guarded (:780) | card: `title`. Drawer: visible text `drawer-enhance-reason`. A single banner `clones-paused-notice` (:228) sits at the top of the Library. | `SkillsPausedError` (:789) → the preview closes, an info toast "Skills is paused…" appears, and `pausedRefusal` makes the tab call `markSkillsPaused()`. The preview never shows the refusal as a failure.         |

`enhanceNow` has no UI caller. It still maps `PAUSED` to `SkillsPausedError` in the RPC service, so a future caller gets the right type.

## How stale state is avoided

1. **Skills Save cannot write `enabled`.** The `enabled` control is removed from `settingsForm`, so `patchValue` drops the DTO's `enabled` and `getRawValue()` never emits it. `onSaveSettings` also deletes `policy.enabled` (:1037). The "Enabled" checkbox is gone from the settings panel, and a note there points to the header switch.
2. **The memory payload is fixed.** It is always `memory:setTriggers({ triggers: {}, enabled })`, never the cached trigger DTO.
3. **Optimistic writes and rollback.** The `pending` signal shows the requested position at once. On failure it clears, so the switch falls back to the committed value. An inline error is shown and the host value is re-read.
   - A later successful read clears only a read error. A write error stays until the next toggle.
4. **Stale-read guard.** Each state service bumps `switchSeq` on every read and every write. A read applies its answer only if its sequence number is still the newest. Reads are skipped entirely while a write is in flight. As a result, a slow `getTriggers`/`getSettings` cannot put back a value the user just changed.
   - The Skills focus re-read writes only the switch signal, never the Settings form, so unsaved form edits survive a focus.
5. **Re-read when shown or refocused.** Tabs are created when shown, so `ngOnInit` reads the switch. Each switch also re-reads on window `focus` and on `visibilitychange` → visible.
   - The shell re-reads both badge flags on the same events and when a tab's `pausedChange` fires. That event fires only when the committed host value flips, never for the first read or an optimistic move.
   - All listeners are removed on destroy through `DestroyRef`.
6. **Refusals correct the UI.** A host `PAUSED` refusal sets the committed value to paused, so the UI corrects itself even before the next focus.
7. **Shell badge reads are guarded.** `ThothStatusService.refreshPaused()` has its own generation guard. A failed read keeps the last known flag. On VS Code it makes no call and reports both flags as false.

## Specs that pin it

- **`memory-diagnostics-state.service.spec.ts`**, describe "Memory pause switch":
  - The read, and an unknown value that is not treated as "on".
  - The exact payload `{ triggers: {}, enabled: false }`.
  - The optimistic move, and the committed value changing only after the write.
  - Rollback, the error, and a re-read.
  - The stale-read guard, and no read while a write is in flight.
  - `runNow` is not sent while paused (notice instead).
  - A `PAUSED` refusal becomes paused state with no error.
  - The notice clears on resume.
- **`memory-diagnostics-rpc.service.spec.ts`:** `runNow` maps `PAUSED` to `MemoryPausedError` and anything else to a plain `Error`; `setTriggers` forwards `{ triggers: {}, enabled }`.
- **`memory-pause-switch.component.spec.ts`:**
  - role, `aria-checked`, the classes, the 24 px target and the copy.
  - The Paused badge.
  - Applies on change.
  - Disabled while unknown or saving.
  - The error is an alert.
  - Re-reads on init, focus and visible (not hidden), and the listeners are removed on destroy.
  - `pausedChange` fires only on a committed flip.
- **`memory-diagnostics-accordion.component.spec.ts`:** Run now is greyed out with its title, the hint and no call; the paused notice uses `role=status` and no error alert.
- **`memory-curator-tab.component.spec.ts`:** the switch sits directly after the `<header>`, and the tab re-emits `pausedChange`.
- **`skill-synthesis-state.service.spec.ts`**, describe "Skills pause switch":
  - The read; the write sends only `{ enabled }`.
  - Optimistic move, rollback and re-read.
  - The stale-read guard, and no read while a write is in flight.
  - `markSkillsPaused`.
- **`skill-synthesis-rpc.service.spec.ts`:** `runCurator`, `previewEnhancement` and `enhanceNow` map `PAUSED` to `SkillsPausedError`; any other failure stays a plain `Error`; `updateSettings({ enabled })` is sent on its own.
- **`skill-diagnostics-rpc.service.spec.ts`** and **`skill-diagnostics-state.service.spec.ts`:** `analyzeNow` with `PAUSED` gives `SkillsPausedError`, resolves `'paused'` and sets the notice with no error; any other failure stays an error and resolves `'done'`.
- **`skills-pause-switch.component.spec.ts`:** the same coverage as the Memory switch spec.
- **`skill-synthesis-tab.component.spec.ts`:**
  - "never sends enabled on Save, so a stale form cannot undo the Skills switch".
  - The round-trip test now excludes `enabled`.
  - Describe "Skills pause switch": the switch sits right under the header; Run Curator is greyed out with its hint; a `PAUSED` refusal calls `markSkillsPaused` with no error toast; Analyze is greyed out through the input; `pausedChange` is re-emitted.
- **`skill-settings-panel.component.spec.ts`:** there is no `enabled` control or "Enabled" label, and the note points to the switch.
- **`skill-activity-feed.component.spec.ts`**, describe "while Skills is paused": greyed out with title, hint and no call; the notice uses `role=status` and appears only while paused; `pausedRefusal` is emitted on `'paused'`.
- **`skill-clones-view.component.spec.ts`**, describe "Skills paused": the card's Enhance is disabled with its title and the banner shows; the drawer's Enhance is disabled with the reason text; a `PAUSED` refusal gives an info toast and `pausedRefusal`, with no preview error.
- **`thoth-status.service.spec.ts`**, describe "pause flags":
  - `refresh` reads both flags and marks the pillars.
  - `refreshPaused` reads only the flags.
  - A failed read keeps the last value.
  - The stale-generation guard.
  - No calls on VS Code.
- **`thoth-status-pillars.spec.ts`:** only the memory and skills pillars can be paused.
- **`thoth-shell.component.spec.ts`**, describe '"Paused" badges' (real `ThothStatusService`):
  - The badge shows only on the paused tile.
  - `pausedChange` re-reads only the flags.
  - Window focus re-reads them, and nothing happens after destroy.

## Checks

`npx nx run-many -t test,typecheck,lint -p memory-curator-ui skill-synthesis-ui thoth-shell --parallel=1`:

```
NX   Successfully ran targets test, typecheck, lint for 3 projects
```

`npx nx run-many -t test,typecheck,lint -p dashboard --parallel=1`:

```
NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/dashboard
```

Test counts from the same run with `--outputStyle=stream`:

```
skill-synthesis-ui  Tests:       644 passed, 644 total
memory-curator-ui   Tests:       216 passed, 216 total
dashboard           Tests:       151 passed, 151 total
thoth-shell         Tests:       10 passed, 10 total
```

- **Lint:** 0 errors. The only warnings in changed files are `max-lines` on `skill-synthesis-tab.component.ts` and `skill-clones-view.component.ts`. Both files were over 700 lines before this change (1327 and 978 lines at HEAD).
- **`npx prettier --check <36 changed files>`:** `All matched files use Prettier code style!`
- **`npx nx run degradation-audit:lint --skip-nx-cache`:** `libs/frontend/memory-curator-ui: 15 ok (baseline 15)`, `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`, `Successfully ran target lint`.
- **Not run:** the app, which is out of scope here; screenshots are a later step.

## Deviations

1. **Two new switch components** (`memory-pause-switch`, `skills-pause-switch`) instead of inline markup in the tab files.
   - The tabs are already 635 and 1300+ lines, and a separate component has its own spec.
   - The two are similar but live in different libs, and there is no shared UI lib for them, so they stay separate.
2. **Files outside the plan's P4 list, all inside the same libs:**
   - `skill-synthesis-rpc.service.ts`, `skill-diagnostics-rpc.service.ts` and `memory-diagnostics-rpc.service.ts` keep `errorCode` as a typed error. The existing wrappers threw a bare `Error` and lost the `PAUSED` code.
   - `skill-diagnostics-state.service.ts` holds Analyze's paused notice.
   - `clone-card.component.ts` and `clone-detail-drawer.component.ts` render the Enhance button. The clones view only handles its event.
   - `memory-curator-ui/src/services.ts` exports `MemoryDiagnosticsRpcService` for the dashboard. The dashboard already depends on that subpath, so no new dependency is added.
3. **Badge refresh is targeted.** On `pausedChange` and on focus, the shell calls the new `thothStatus.refreshPaused()`, which makes two reads, instead of the full `refresh()` the plan names, which would re-read all four pillars. Tab switches still run the full `refresh()`, which includes the flags.
4. **Copy.** The switch labels are "Memory" and "Skills", as the user asked, not the plan's "Background learning". The 3.3 copy is split per tab ("Saved memories…" / "Saved skills…").
5. **Prettier reformatted whole files.** `skill-synthesis-tab.component.ts` and `skill-settings-panel.component.ts` were not Prettier-clean at HEAD, so their diffs include some formatting-only lines.

## Out of scope / observations

- The memory switch only works once P1/P3 are live. P3's `rpc-handlers` typecheck was blocked on P2's `restartCurator` at the time of the P3 report. The P4 UI depends only on the shared types, which typecheck.
- The VS Code webview shows the existing "desktop only" placeholders, so neither switch renders there, as plan 0.2 intends.

## How to see it (visual reviewer)

In the Electron app, open the **Thoth** page.

**Memory tab** (default)

1. Directly under the "Memory" title is a bordered card. It holds "**Memory** · ● On", the line "Pausing stops capture… Saved memories are still used in chats.", and a toggle on the right.
2. Click the toggle. The card turns amber, a **Paused** badge appears, and the left rail's Memory tile shows a **Paused** badge.
3. Open **Maintenance**. "Run curator now" is greyed out, with "Paused — resume Memory to run" next to it.

**Skills tab**

1. The same card, labelled "**Skills**", sits under the header.
2. Toggle it. The header's **Run Curator** button is greyed out, with "Paused — resume Skills to run".
3. **Activity**: "Analyze current session" is greyed out with the same hint.
4. **Library**: an amber banner appears, and every card's "Enhance now" is greyed out (hover for the reason). Opening a card shows the reason under the drawer's "Enhance now".
5. **Settings**: there is no "Enabled" checkbox, only the note about the switch.

**External change**

1. Pause from the tray, or edit `~/.ptah/settings.json`.
2. Click back into the window. The switch and the rail badge update on focus.

**Keyboard and themes**

- Tab to the switch: the focus ring is visible, and Space toggles it.
- Check both dark and light themes, and the narrow strip layout.

## Visual review fixes (revise round 1)

Source: `visual-review.md`, verdict REVISE.

1. **SERIOUS: the Skills switch card shifted 44 px at 900 px. Fixed.**
   - Cause: the paused-only hint `run-curator-paused-hint` in the tab header wrapped the header and pushed the card down.
   - Change: the hint is removed from `skill-synthesis-tab.component.ts`. The header now renders the same elements in both states.
   - Run Curator keeps its `title` "Paused — resume Skills to run" and gains `aria-describedby="skills-pause-help"` while paused.
   - The switch card itself cannot shift either:
     - Its help text is identical in both states.
     - The label/badge row has `min-h-5`, so the "On" dot label and the "Paused" badge give it the same height.
   - Memory tab: it never had a header hint (the reviewer measured 0 px shift). It got the same fixed-copy and `min-h-5` treatment.
   - Pinned by:
     - `skill-synthesis-tab.component.spec.ts`, "greys out Run Curator with the paused reason, without adding anything to the header": the header element count is unchanged and there is no hint.
     - Both switch specs, "keeps the help text and badge row identical across states, so toggling shifts nothing".
2. **MODERATE: the paused effect was not discoverable from the top. Fixed** without moving the Maintenance section.
   - Each switch card's fixed help text now names what a pause disables:
     - "Pausing stops capture, background processing and manual runs (Run curator now). Saved memories are still used in chats."
     - "… manual runs (Run Curator, Analyze current session and Enhance now). Saved skills are still used in chats."
3. **MODERATE: the badges were too small. Fixed.**
   - Card badge: `badge badge-warning badge-sm text-xs`, so 12 px text.
   - Sidebar badge: `badge-xs` changed to `badge badge-warning badge-sm text-xs`.
   - The colour tokens are unchanged, so the measured AA contrast holds (6.61:1 light, 5.66:1 dark).
   - Pinned in the switch specs and in `thoth-shell.component.spec.ts`.
4. **Disabled-button contrast (WCAG-exempt): left as is.**
   - Minor 4 (the hint wrapping onto its own row) is resolved by fix 1.
   - Minor 5 (neutral toggle track while paused) is not changed: it is optional polish, and the amber card plus the badge already carry the state.

Not re-measured in a browser: Electron was not launched, per instruction. Re-measure at 900 px and about 700 px in the next visual pass.

### Checks

`npx nx run-many -t test,typecheck,lint -p memory-curator-ui skill-synthesis-ui thoth-shell --parallel=1`:

```
@ptah-extension/skill-synthesis-ui: Tests:       645 passed, 645 total
@ptah-extension/memory-curator-ui: Tests:       217 passed, 217 total
@ptah-extension/thoth-shell: Tests:       10 passed, 10 total
 NX   Successfully ran targets test, typecheck, lint for 3 projects
```

- Lint: 0 errors. The one warning printed (`explicit-member-accessibility` on a `get error` accessor) is not in a file changed here.

`npx prettier --check <8 changed files>`:

```
All matched files use Prettier code style!
```

### Files changed in this round

- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`, `.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skills-pause-switch.component.ts`, `.spec.ts`
- `libs/frontend/memory-curator-ui/src/lib/components/memory-pause-switch.component.ts`, `.spec.ts`
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`, `.spec.ts`

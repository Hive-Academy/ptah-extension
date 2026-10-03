# Batch 36 report: Orchestration scenes + Gate V 36 preparation (S6)

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-02. Base: HEAD `cb865c3a8`.
Track A worktree only. Nothing is staged or committed.

- I did not use `git stash`, restore, checkout, reset or clean, and I did not edit `batches.md`.
- No PowerShell find-and-replace.
- I wrote only `current-*` captures. Before the first Playwright run I copied all 96 to `%TEMP%\b36-shots-backup`, and I
  restored every non-Orchestration capture after each capture run (section 6).
- Every Playwright run used `--workers=2`.

## 1. Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\`.

| Change | File | What |
| --- | --- | --- |
| MODIFIED | `settings-orchestration.e2e.spec.ts` (118 → 319) | The Batch 36 scenes (section 2), plus a `bootOrchestration` helper and the changed-read describe |
| MODIFIED | `settings-visual.e2e.spec.ts` (555 → 624) | `assertOrchestrationFold` with the Electron ratchet flag (section 4); `captureRolesOpen` no longer logs the fold |
| MODIFIED | `settings-reachability.table.ts` (944 → 954) | Header records zero `pending`; #73's focus race fixed (section 5) |
| MODIFIED (extra) | `settings.fixtures.ts` (702 → 703) | `bootSettings(..., overrides = {})`, which replaces single RPC answers for one boot (Deviation 1) |
| NOT MODIFIED | `CHAT\ptah-ai\orchestration-settings.component.ts` | The gate needs no density fix: VS Code fits, and the Electron overrun is a user decision (Gate V 36 item 4) |

## 2. Scenes in `settings-orchestration.e2e.spec.ts`

Each scene runs in both hosts (`vscode` and `electron`) and boots fresh, so it starts from the BRIEF fixture.

**From Batch 32, kept unchanged.** The Batch 14 finding 3 focus scenes are already present for both modals:
- add-instance modal: focus moves in, Tab stays inside, Esc returns focus to the opener;
- add-instance modal: a backdrop click closes it and returns focus;
- the same two scenes for the tier-mapping modal;
- a create closes the add modal and returns focus to Add;
- "Done" closes the tier modal and returns focus to Tiers;
- the edit modal (#50) rename.

**New in Batch 36:**

| Scene | What it asserts |
| --- | --- |
| Cell pick → `agent:setConfig` | Clicks the Codex Model cell, then "Provider default". Exactly one `agent:setConfig {codexModel:''}`. The popover closes and focus returns to the cell. Undo sends `{codexModel:'gpt-5.5-codex'}`, and the fixture reads that value back. |
| On/off | **System CLI:** Codex off sends `agent:setConfig {disabledClis:[copilot, codex]}`, and the row turns `data-dimmed` with no model trigger (#71). Undo sends `{disabledClis:['copilot']}` and the cell is live again. **Instance:** Glm off sends `ptahCli:update {id, enabled:false}` and the toast reads "Saved Glm off". |
| Tiers: a pick sends the full object (D5) | Choosing `kimi-k2.5` for Sonnet sends exactly one `ptahCli:update {id, tierMappings:{sonnet:'kimi-k2.5', opus:'glm-5.3:cloud', haiku:'glm-5.3:cloud'}}`. |
| Tiers: "Use inherited" | Haiku "Use inherited" sends `{id, tierMappings:{sonnet, opus}}`: the full object without that key. |
| Adding a Copilot instance requires sign-in | Boot with an `auth:copilotLogin` resolver that marks the sign-in. Choosing GitHub Copilot shows "Awaiting sign-in" with Create disabled. "Login with GitHub" turns it to "Signed in" with Create enabled. Create sends `ptahCli:create {name:'Copilot-agent', providerId:'github-copilot', …}`, then the modal closes and focus returns to Add. |
| Roles collapsed by default | `background-roles-details` is not `open`. The summary shows "6 roles" and the roles table is hidden. A Providers round trip keeps it closed. |
| Deep link `judge` | Boot with the Judge lane following the main agent (`skillSynthesis:getLanes` override). Providers → Claude (Subscription) drawer → `[data-used-by="judge"]` "Follows main agent →". Then: Agent Orchestration is active, the details are open, `consumer-editor-judge` is open with a live provider control, and the cell reads "Follows main agent → Claude (Subscription)". Esc closes it and focus lands on `consumer-edit-judge`. |
| `setupProviderRequested` lands on Providers with the wizard open | Roles → Judge lane cell → choose Ollama Cloud (unreachable in the fixture route). The readiness alert (`role="alert"`) ends with "Not saved." and no `skillSynthesis:setLanes` is sent. "Set up Ollama Cloud" then lands on Providers (`tab-active`) with `wizard-body` visible and one provider radio preselected. The wizard is cancelled and its draft discarded. |
| Order popover | ▲ for Codex is disabled. ▼ sends the whole order `[antigravity, codex, glm-instance-1, copilot, opencode]`. The test waits for the toast, chip 1 reading "Antigravity", and the re-enabled ▼ to be focused again; it does not rely on the click's own focus (section 3, failure F2). Esc closes the popover and focus returns to the chips trigger. Undo writes `[codex, antigravity, glm-instance-1, copilot]` and chip 1 reads "Codex" again. |

**Where the in-app `judge` deep link comes from.** It is the drawer Overview "Follows main agent →" link
(`overview-tab.component.ts:229-235`, `openRole`). That link exists only for a role that follows the main agent. In
the BRIEF fixture Judge uses Moonshot, so the scene boots with one changed read; this is why `bootSettings` gained
`overrides`.

## 3. Scene run record (failures recorded before any re-run)

| Run | Spec | Result | Failures, diagnosed |
| --- | --- | --- | --- |
| B36-S1 | orchestration, `--workers=2` | **29/32** | **F1**, vscode + electron, "Tiers: a tier pick…". `TimeoutError: locator.click: Timeout 10000ms exceeded` waiting for `getByRole('option', { name: /^Kimi K2\.5/ })`, first frame `settings-orchestration.e2e.spec.ts:192:66`. **Cause: a test defect.** A compact field names each option ID first ("kimi-k2.5 Kimi K2.5", seen in the page snapshot). **Fix:** exact name `'kimi-k2.5 Kimi K2.5'`. **F2**, electron only, "order popover…". `expect(locator).toHaveCount(0)` received 1 for `policy-order-popover` after Esc, first frame `settings-orchestration.e2e.spec.ts:255:29`. **Cause: a test race**, diagnosed with a temporary focus/`disabled` probe spec (deleted afterwards). The click focuses ▼ at once (about 170 ms). The save then disables every move button at about 460 ms in Electron (240 ms in VS Code), and focus drops to `<body>`. `refocus` restores it at about 568 ms. `toBeFocused` had passed on the click's own focus, and Esc landed while focus was on `<body>`, where the popover does not hear it. Both hosts behave the same; Electron's window is just later. **Fix:** wait for the save's toast, then for the re-enabled ▼ to be focused. |
| B36-S2 | orchestration, `--repeat-each=2` | **64/64** (1.3 m) | none |

**Same race in Gate G #73.** The entry checked focus straight after the write and then pressed Esc. It had not failed
yet, but it carries the same race. It now waits for the toast, then the re-enabled and focused ▼ (it is in this
batch's table file).

**For Gate V 36 item 5:** while an order move saves (about 100-300 ms), focus is on `<body>` and Esc does not close the
popover. This is the same `NativePopoverComponent` behaviour as item 5 (Esc after Undo). It is not changed here
(`agent-orchestration-config.component.ts` is outside this batch).

## 4. Fold gate (`assertOrchestrationFold`, `settings-visual.e2e.spec.ts`)

**What it asserts, in each of the 4 host/theme runs:**
- nothing is scrolled (window and the Orchestration subtree);
- the **5+2 reference set** (5 installed rows, 2 in the Uninstalled group);
- `cli-matrix` and `consumer-table` both have `table-xs`;
- `background-roles-details` is not `open`;
- each enforced region's bottom is ≤ 660 px.

Every measurement, including the matrix row heights, is logged as `B36 fold orchestration …`.

**Ratchet.** This is track B's `SEARCH_VOICE_FOLD_ENFORCED` pattern, through
`ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = false`:
- **VS Code:** all four regions are enforced.
- **Electron:** policy bar, matrix header and first row are enforced. The roles summary is measured and logged. While
  it is over the budget, the test gets the annotation
  `fold-pending: "electron/<theme>: rolesSummary 779px > 660px — pending user decision (Gate V 36 item 4)"`. The JSON
  reporter shows this annotation on both Electron runs.
- Setting the flag to `true` adds `rolesSummary` to Electron's enforced list.

A fold failure is collected and thrown at the end (the Batch 28 pattern), so the captures are still taken.

| Host / theme | policy bar | `cli-matrix` header | first row | `background-roles-summary` | Result |
| --- | --- | --- | --- | --- | --- |
| vscode / anubis | 125 | 206 | 247 | **643** | PASS (enforced) |
| vscode / anubis-light | 125 | 206 | 247 | **643** | PASS (enforced) |
| electron / anubis | 165 | 270 | 313 | **779** (119 over) | bar, header, first row PASS; summary `fold-pending` (Gate V 36 item 4) |
| electron / anubis-light | 165 | 270 | 313 | **779** (119 over) | as above |

Shared by all four runs: no scroll (0/0), reference set 5+2, `table-xs` on both tables, details closed.

**Row heights** (px, identical in both themes):

| Host | codex | antigravity | glm-instance-1 | copilot | opencode | Uninstalled header | cursor | pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vscode | 41 | 41 | 95 | 41 | 41 | 25 | 61 | 33 |
| electron | 43 | 61 | 113 | 61 | 43 | 25 | 61 | 43 |

**Roles table** (open, Batch 35 check): every cell is 16 px; rows are 25 px, and Judging & enhancement is 68 px.

**Why the rows exceed the spec's ≈32 px.** The design-spec §1.2 arithmetic assumes rows of about 32 px. The measured
rows are higher for three reasons:
- the Glm instance carries its key and three tier badges;
- Electron stacks status and provider under the name;
- Cursor stacks Credentials over Install guide.

`table-xs` is in place. The pass line is the summary's position, which VS Code meets.

## 5. Zero `pending` (proof)

- `grep "status: 'pending'"` over the whole settings harness folder (the table and its spread-in entry files) matches
  only the doc comment at `settings-reachability.table.ts:14`. That is **0 entries**.
- Status counts: **64 `present` + 34 `restored` = 98** = `EXPECTED_CAPABILITY_COUNT`.
- Gate G's guard "every baseline id … never pending or missing" passes in every repeat.
- No Orchestration id was left to flip or re-point. The last ones flipped in Batches 30-32 and were re-pointed in
  Batch 34.
- The table header now records this.

I did not narrow `CapabilityStatus` to `'present' | 'restored'`. That would need the reachability spec's
`if (entry.status === 'pending')` changed (not in this batch's files), and it risks a merge hunk with track B.

## 6. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran typecheck, lint for 5 projects. The harness was re-run after the final comment-only trim and is still green. |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | Successfully ran test for 4 projects (the harness has no test target). **All 4 were Nx cache hits:** no file in chat, core, ui or the webview changed, so the inputs equal the Batch 35 run (chat 2228 + 2 skipped, core 1109, ui 624, webview 224). |
| `npx nx build ptah-extension-webview` | Success. Initial total **3.46 MB** (error budget 3.5 MB; the 2.5 MB warning is pre-existing). |
| Gate G **B36-G1**, `--repeat-each=3 --workers=2 --reporter=list` | **26/27** (5.6 m). See the failure record below. |
| Gate G **B36-G2**, same command | **27/27 passed** (5.6 m). Per-host runs 1.6-1.9 m. |
| Settings folder `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings --reporter=list --workers=2` | **72 passed, 2 skipped, 0 failed** (3.1 m). The 2 skips are the existing `test.fixme` main-model deep link in `settings-providers.e2e.spec.ts` (one per host). The visual spec covers both hosts × both themes; the Electron fold is annotated `fold-pending` as designed. |
| `settings-visual.e2e.spec.ts` alone (earlier) | 4/4 |
| The same, Electron only, with `--reporter=json` | 2/2; the `fold-pending` annotation is present on both |

**B36-G1 failure record:**
- **Test:** #6, "webview > settings > reachability (vscode) › every present/restored capability is reachable".
- **Error:** `Error: worker process exited unexpectedly (code=3221226505, signal=null)`, 0 ms.
- No entry ran, so there is no entry id and no stack frame.
- **Suspected cause:** 0xC0000409, the known Windows Playwright worker crash (HANDOFF "Known pre-existing failures"). Its
  other two vscode repeats passed (1.8 m, 1.7 m).
- As the rule requires, the gate was re-run with `--repeat-each=3`: B36-G2 is 27/27.

## 7. Captures

All in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`.

- The visual runs re-took every `current-orchestration-*` capture: the tab, roles-open, role-popover, order-popover,
  matrix popovers and the two modals, in {vscode, electron} × {anubis, anubis-light}.
- **30 show as modified in `git status`.** They are byte-level re-renders: this batch changes no UI. The tab captures
  match Batch 35. VS Code shows the roles summary above the fold; Electron shows it at the bottom edge.
- All 52 non-Orchestration `current-*` files were restored from `%TEMP%\b36-shots-backup` after each capture run. After
  the last restore, `git status` shows **0** modified non-Orchestration captures and **0** `baseline-*`.

## 8. Deviations

1. **`settings.fixtures.ts` (not in the batch file list).** `bootSettings` gained an optional `overrides` (one
   parameter, one spread).
   - **Why:** the Copilot sign-in and `judge` deep-link scenes need one changed read **in either host**.
     `bootVariant` always boots VS Code, and a static fixture is serialised into the page at boot.
   - The file was already 702 lines (over the 700 rule) before this batch; it is now 703.
2. **The orchestration container is unchanged.** The gate needs no density fix: VS Code fits at 643 px, and Electron
   is the user's decision (item 4).
3. **Gate G #73 race fix in the table** (section 3). A test-only change, made in this batch's own table file.

## 9. For Gate V 36 (additions from this batch)

- **Item 4 (unchanged):** Electron roles summary at 779 px (119 over). Enforcement is ready behind
  `ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED`; flip it after the decision (and after any layout change).
- **Item 5 (extended):** Esc is also ignored for about 100-300 ms while an order move saves, because the disabled
  move buttons drop focus to `<body>` (section 3).
- The new scenes exercise the copy already listed for review: "Awaiting sign-in" / "Signed in", "Set up {provider}",
  " Not saved.", "Follows main agent → {driver}".

## 10. Revise round 1 (coordinator): the order popover keeps focus during a save

The coordinator classed the section 3 / item 5 finding as a defect to fix before the commit, not a user item.

**Defect.** In the policy bar's order popover (Batch 33), every ▲/▼ had `[disabled]="first|last || !canReorder()"`.
`canReorder()` is false while a save runs (`feedback.saving()` = commit `saving`), so a move natively disabled the
focused button. Focus dropped to `<body>` for about 100-300 ms, and Esc, which the popover hears only from inside, was
ignored.

**Fix** (`libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts`, now 298 lines):
- Native `disabled` now marks only the structural ends: ▲ on the first row and ▼ on the last.
- While a move cannot run (a save in flight, or the policy or instances not yet read), the buttons get
  `aria-disabled="true"`. They look disabled through `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed` on
  `MOVE` (Tailwind 3.4.19's built-in variant) and stay focusable.
- `moveAgentUp` / `moveAgentDown` now return early when `!canReorder()`. `savePreferredOrder` keeps its own guard.
- `refocus` is kept and its comment corrected. Re-ordering can move the row's element, and a row can reach an end
  where its button is natively disabled; `afterNextRender` restores focus in the same task, before any key event.
- If Esc closes the popover during the save, the finished save finds no buttons, so focus stays on the trigger.

**Specs** (`agent-orchestration-config.component.spec.ts`, **23/23**):
- New `deferNextSave()` helper: the next write stays in flight with commit `saving`, as the real state reports it.
- "cannot reorder while a save runs (D3)" is rewritten. During a deferred save, ▼ has `aria-disabled="true"` and
  `disabled === false`; a click does not write; `aria-disabled` clears once the save ends.
- **New test:** "keeps focus on the button used while the save runs, and Esc then closes and returns focus to the
  trigger". ▼ is focused and clicked, and the save is held. Then:
  - `document.activeElement` is still ▼, with `aria-disabled="true"`;
  - Esc closes the popover and focus is on the Edit order trigger;
  - after the save finishes, the popover stays closed and the trigger keeps focus.
- "cannot reorder until both … are read" now asserts `aria-disabled` and that a click writes nothing.
- The new assertions fail on the old code, where `aria-disabled` was null and `disabled` was true.

**Workarounds removed** (the assertions are kept):
- **Scene** "order popover…": the toast wait and `toBeEnabled` are gone. ▼ is checked with `toBeFocused` and Esc is
  pressed at once, which in Electron falls inside the save. The "1. Antigravity" chip assertion moved after the
  close.
- **Gate G #73:** the toast wait and `toBeEnabled` are gone; it asserts `toBeFocused`, then Esc.

**Verification (this round):**

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness` | Successfully ran for 2 projects |
| `npx jest --config libs/frontend/chat/jest.config.ts …/agent-orchestration-config.component.spec.ts --maxWorkers=2` | **23/23** |
| `npx nx build ptah-extension-webview` | Success, initial total **3.46 MB** |
| orchestration scenes `--repeat-each=2 --workers=2` | **64/64** (59.6 s) |
| Gate G `--workers=2 --reporter=list` (once) | **9/9** (1.2 m; per-host 1.1 m / 1.2 m), no failure |

- No visual spec ran this round, so no capture was rewritten. Modified non-Orchestration captures: 0. `baseline-*`: 0.
- The `aria-disabled` look shows only during a save, so no capture changes.

**Gate V 36 list update:** the "Esc ignored during an order save" addition to item 5 (section 9) is **fixed**. Item 5
itself is unchanged: Esc after clicking the toast's Undo, which moves focus out of the popover.

**Files added to this batch:** `CHAT\ptah-ai\agent-orchestration-config.component.ts` and its spec.

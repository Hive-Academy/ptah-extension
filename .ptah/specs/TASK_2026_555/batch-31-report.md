# Batch 31 report: Cursor credential popover + Copilot toggle move (S6), with the visual drift checkpoint

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-01. Base: HEAD `07da3f4f6` (30).
Track A worktree only; no track B file touched. Nothing is staged or committed.

- No `git stash`, restore, checkout, reset or clean was used.
- Only the affected `current-orchestration-*` captures were retaken. The other `current-*` files were copied aside and
  restored after the smoke run; `git status` shows 0 modified non-orchestration captures and 0 `baseline-*` files.

| Requirement | State |
| --- | --- |
| `CursorCredentialPopoverComponent` (#64, 551 env note), on the Cursor row's Credentials action | Done |
| Show/hide on the key (#49) | Done |
| "Set" badge from `cursorApiKeyStored` | Done |
| "CURSOR_API_KEY is set in the environment and takes precedence over the stored key." when `cursorApiKeyEnvSet` | Done (verbatim) |
| "Remove stored key" → `saveCursorCredential('')` | Done (two-step confirm) |
| Key cleared on destroy (`ptah-cli-config.component.ts:177` pattern) | Done |
| `CopilotAutoApproveToggleComponent`: the uncertain-write and recheck logic moved from the AOC, rendered in Copilot's permission popover | Done |
| The toggle writes `state.saveSettings({orchestration:{copilotAutoApprove}})`, not a private RPC | Done |
| Old AOC toggle kept until Batch 33 (transient duplicate) | Kept, unchanged |
| Reachability entries updated | #63 and #64 re-pointed to the new surfaces |
| Visual drift checkpoint (matrix density and structure, both themes) | §5: no structural drift |

Paths are relative to `libs/frontend/chat/src/lib/settings/ptah-ai/` unless they start with `libs/`.

---

## 1. Cursor credentials (`cursor-credential-popover.component.ts`, 155 lines)

**Where it opens:** the matrix renders "Credentials" on every row with `credentialAction` (Cursor only), on its
installed row and on its Uninstalled row alike. Cursor installs once a key resolves (`cursor-cli.adapter.ts:208-223`).

- The button sits beside "Install guide" on the Uninstalled row (`cli-orchestration-matrix.component.ts:267`).
- The popover is a `NativePopoverComponent` with a transparent backdrop; Esc closes it.
- On open, the key field takes focus (`focusCredentialKey`, `:387`).

**Status (`:114-115`):**

- The "Set" / "Not set" badge comes from `cursorApiKeyStored` alone, never from `cursorApiKeyConfigured`, which also
  counts the env var.
- It reads "Not loaded" when the orchestration read has no data (never a stale value).
- With `cursorApiKeyEnvSet`, the 551 note shows (`:46`) in an info-bordered box; the text stays base-content
  (deviation 6).

**Key field:** `type=password`, with a show/hide button (`aria-label` "Show API key" / "Hide API key", `aria-pressed`,
`:63`). The help copy names cursor.com → Dashboard → Integrations and the secrets store.

**Writes:**

- **Save** (`save`, `:137`): `state.saveCursorCredential(key, context)`.
- **Remove stored key** (`remove`, `:149`): a two-step confirm, then `saveCursorCredential('', context)`. The confirm
  copy says whether Cursor keeps working: it does when `CURSOR_API_KEY` is set.
- Both go through `runDrawerWrite`, the drawer's own-outcome runner, so this popover shows only its own write's result
  and never an earlier save's (D15).
- The state reads back `cursorApiKeyStored`, so "Key saved." / "Stored key removed." appear only when the store
  confirms. Otherwise the outcome is an alert: "The key was not saved." or "Could not confirm the change…".
- There is no Save-to target and no toast or Undo, because the secret is per machine and cannot be written back.
  This is why the feedback toast ("Saved … to All Ptah apps") is not used here.

**Key lifetime:**

- The key is held only in the component's signal, never in service state.
- It is cleared and re-masked after a confirmed save, kept after a failed one so the user can retry, and cleared on
  destroy (`ngOnDestroy`, `:129`).
- Every control is disabled while any save runs (D3).

## 2. Copilot auto-approve (`copilot-auto-approve-toggle.component.ts`, 128 lines)

The toggle renders at the bottom of Copilot's permission ℹ popover (`cli-orchestration-matrix.component.ts:228`). It
keeps the old label, `aria-label` and testids (`copilot-auto-approve`, `-error`, `-recheck`), so it is a real move.

**Mapping the moved logic (AOC `:466-581`) onto the state service:**

| Old AOC path (private RPC) | New path | Toggle shows |
| --- | --- | --- |
| `agent:setConfig` succeeded with `success: true` | commit `saved` | the re-read value; toast "Saved Copilot auto-approve to All Ptah apps." with Undo (a second `saveSettings`) |
| Uncertain write, read-back differs | commit `failed` / `partial` / `blocked` (nothing written) | the re-read value, plus alert "Could not save Copilot auto-approve. The saved setting is unchanged." |
| Uncertain write, read-back failed | commit `unconfirmed`, the re-read failed (`saved() === null`), or the save command threw | indeterminate, disabled, "Could not confirm whether…", and "Check saved setting again" (`recheck` → `state.refreshOrchestration()`) |
| (new) refused: another save in flight | `saveSettings` resolved `false` | unchanged; toast "Another change is still saving." |

**How the toggle tells the cases apart (`toggle`, `:67-91`):** the `write` closure only calls `state.saveSettings`
(Batch 17 constraint). It records that method's own answer (`started` / `refused` / `threw`), because
`SettingsSaveFeedbackService.save` does not return it.

**Display rules:**

- The checkbox goes back to the saved value at once; only the read-back moves it.
- It is disabled while its write runs, while any save runs, and while unconfirmed. It never shows an unread value
  (D15).
- `saved()` is null when the orchestration section has no data. The toggle then shows "The saved setting could not be
  read." and offers the re-read.

## 3. Matrix and harness changes

**`cli-orchestration-matrix.component.ts` (476 lines):**

- Imports both components.
- Adds the `credentials` popover kind and the `focusCredentialKey` handler.
- Updates the class doc: Add, Tiers and Edit are still not rendered (Batch 32).
- Popover roots (permission, install, credentials, model/effort) reset `whitespace-normal text-left`. They sit inside
  `nowrap` / right-aligned cells; see the defects in §5.

**`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts` (148 lines):**

- **#63** (baseline `present`) is re-pointed. It goes: Copilot row ℹ → toggle → a real `agent:setConfig
  {copilotAutoApprove: true}`. The toggle reads back checked and the badge turns "Auto-approve: On". Toast Undo then
  sends `{copilotAutoApprove: false}` and the toggle is unchecked again.
- **#64** (baseline `present`) is re-pointed. It goes: Cursor Credentials (on its Uninstalled row) → "Not set", the
  help copy, the focused key field, masked → shown, Save enabled. Nothing is saved, because the fixture has no stored-key
  read-back.
- Both ids stay in `BASELINE_PRESENT_IDS`, so the guard is unchanged.

**`settings-reachability.table.ts`:** the two old entries were removed (they moved to the entries file). The file is
**708 counted lines, down from 712**. `EXPECTED_CAPABILITY_COUNT` stays 96.

**`settings-visual.e2e.spec.ts` (`captureMatrixPopovers`), two new captures:**

- the Copilot permission popover with the toggle
- the Cursor credentials popover, focused

Both assert that the popover is on screen and on top, and has no content overflow (`noOverflow`). The Cursor one also
asserts left-aligned help text.

This batch created 4 code files and modified 6, against the batch's 6 files in total. The extras are:

- the matrix spec
- the model/effort popover (a one-line root-class fix)
- the entries file (where #63 and #64 now live)
- the visual spec (the captures the orchestrator asked for)

## 4. Copy for user review

All of this is new UI copy; none comes from earlier approved text except the 551 sentence, which the batch specifies.

| Where | Copy |
| --- | --- |
| Cursor popover title / status | "Cursor credentials"; "Stored API key" + "Set" / "Not set" / "Not loaded" |
| Cursor help | "Create a key at cursor.com → Dashboard → Integrations. Ptah keeps it in this machine's secrets store and never shows it again." |
| Cursor env note (batch text, verbatim) | "CURSOR_API_KEY is set in the environment and takes precedence over the stored key." |
| Cursor field label | "API key" / "Replace API key" (when one is stored); placeholder "crsr_…" |
| Cursor remove confirm | "Remove the stored Cursor key? Cursor keeps using CURSOR_API_KEY from the environment." / "… Cursor stops working until a key is set again." |
| Cursor outcomes | "Key saved." / "Stored key removed." / "The key was not saved." / "The stored key was not removed." / "Could not confirm the change. Check the \"Set\" status before retrying." |
| Copilot toggle | "Auto-approve Copilot tool calls" (old label); errors are the old AOC wording; new: "The saved setting could not be read." |
| Toast (feedback service format) | "Saved Copilot auto-approve to All Ptah apps." |

Still pending user review from Batches 29-30 (in batches.md Task 36's list): the Copilot and Ptah-instance permission
copy, and the install guides.

## 5. Visual drift checkpoint (matrix density and structure, both themes)

**Compared:** `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png` and the popover captures
against `prototypes/final/screenshots/orchestration-{anubis,anubis-light}-1024x768.png`, `orchestration-anubis-full.png`
and `interactions/orchestration-1/-2/-3.png`. `orchestration-1` is the Batch 32 add-instance modal, so it was not
compared yet.

**Structure: no drift.** The tab matches the prototype in:

- the section card and heading with its hint
- the eight-column `table-xs` matrix (VS Code; Electron moves Status and Provider under the name, the narrow layout
  accepted in Batch 30)
- the instance row with its Ptah CLI, key and tier badges and Test / Delete
- the Uninstalled group with its header and shaded rows
- the cell popovers anchored under their cells

The Copilot auto-approve control now sits with Copilot's permissions, as the plan places it. Cursor's Credentials sits
on its row.

**Density follows §1.2, not the prototype rows.**

| Host | Header bottom | First row bottom | Rows |
| --- | --- | --- | --- |
| VS Code | 150 | 191 | 41 px; Glm 95; Cursor 61 (two actions stacked); Pi 33 |
| Electron | 190 | 233 | 43-61 px; Glm 113 |

Overflow is 0 in both hosts.

**Defects found and fixed in this batch:**

1. The Copilot permission detail ran past the popover's right edge. The popover inherited `whitespace-nowrap` from the
   Permissions cell.
2. The Cursor popover text was right-aligned, inherited from the Actions cell.

Both are fixed on every popover root, and the visual spec now asserts no content overflow and left-aligned help text.

**Remaining differences, all already accepted:**

- deviation 6 text colours
- D11: no system-CLI Test, no quota state
- no prototype sub-lines (`~/.codex/auth.json`, …)
- the policy bar (Batch 33) and "Add Ptah CLI Instance" (Batch 32) not yet built; the old AOC is still below the
  matrix (D14)
- the floating compact model list (Visual round 1)

**New small difference:** the Cursor row's Actions cell stacks "Credentials" over "Install guide" (row 61 px). The
prototype shows only "Install Guide", because it had no credentials action. Keeping both on one line would widen the
Actions column past the VS Code box (overflow > 0).

**Open item carried from Batch 30:** the Electron fold for Batch 36 (roles summary projected ≈746 px; options are
recorded in `batch-30-report.md`). This batch adds ≈18 px to the Cursor row in Electron as well, so the overrun is now
≈104 px. Collapsing the Uninstalled group (option 1) would remove ≈104 px, about all of it.

## 6. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --skip-nx-cache` | Successfully ran typecheck, lint for 5 projects (one existing `max-lines` warning on the table: 708) |
| `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui ptah-extension-webview --skip-nx-cache --output-style=static -- --maxWorkers=2` | chat **2149 passed + 2 skipped** (129 suites; Batch 30 2127, +22); core 1109/1109; ui 619/619; webview 224/224 |
| `npx nx build ptah-extension-webview --skip-nx-cache` | **No budget error.** Initial total **3.48 MB**, unchanged (981.03 kB over the 2.5 MB warning, vs 981.10 kB at Batch 30). The new components load in the deferred `cli-orchestration-matrix-component` chunk: 45.65 kB raw / 11.29 kB transfer (was 33.36 kB) |
| `settings-visual.e2e.spec.ts --reporter=list` | **4/4 passed**; Providers fold green (ratchet) |
| Gate G `--reporter=list` (after the #63 fix below) | **9/9 passed** (2.3 m; each host's walk 2.0 m) |
| Gate G `--repeat-each=3 --workers=2` (after the fix; the 8-worker run is diagnosed below) | **27/27 passed** (7.2 m; walks 1.6-2.3 m each) |

### Gate G: failures found and diagnosed

**Runs 1 and 2 (before the fix): a real defect in my #63 entry.**

- Symptoms: both hosts, every repeat. The walks timed out at 180 s, and #43, #44 and #64 each took about 10 s.
- The first diagnosis (machine load, so raise the walk's 180 s budget) was **wrong**. The timeout change was reverted
  before any commit; `settings-reachability.e2e.spec.ts` equals HEAD.
- With time to finish, a later run showed the cause: `#63: expect(locator('[data-testid="cli-permission-popover"]')).toHaveCount(0) … Received: 1`.
  - #63 clicks the toast's Undo, which sits outside the popover, so focus leaves the popover.
  - The closing Esc then never reaches the popover: `NativePopoverComponent` handles Esc only on its own host.
  - The popover's backdrop stayed open and intercepted every click in the next entries (#64, #43, #44: "…
    subtree intercepts pointer events"). That is the 10 s each.
- **Fix** (`settings-cli-matrix.entries.ts`, `throughMatrixPopover`): close with Esc when focus is still inside the
  popover, else with the panel's own Close button. Then assert that it closed.
- **Product note:** a user who clicks the toast's Undo with the popover open can close it by clicking outside
  (backdrop) or with its Close button; Esc works again once focus is back inside. This is the existing
  `NativePopoverComponent` behaviour, unchanged.

**Run 3 (after the fix): `--repeat-each=3` had 5 of 27 fail, with no assertion failure.**

- 3 walks timed out at 3.0 m. The one that names its last step was on RUX-10, a Providers entry.
- 2 "kept selectors" tests failed with `route.fetch: Timeout 10000ms exceeded` (the fixture server did not answer).
- Cause: CPU at 100%. Other sessions' jest and nx runs were on the machine (task-580, task-584, the main checkout),
  plus six concurrent walks from 8 workers. The same walk takes 2.0 m alone.
- Per execution default 7 this was recorded and the gate was run again with `--repeat-each=3`, capped at
  `--workers=2` to stop adding six concurrent walks (result in the table above).

The +22 chat tests are: Cursor popover 11, Copilot toggle 8, matrix +3 (Cursor Credentials on both rows, the Copilot
toggle only in Copilot's popover, Credentials on Cursor only).

The webview build and the visual run took longer than the 600 s foreground limit while track B was building, so that
combined command finished in the background. Its log is `%TEMP%`'s `b31-visual.log`; the result is unchanged.

### Captures (retaken: only `current-orchestration-*`, 1024×768, both hosts × both themes)

All in `.ptah/specs/TASK_2026_555/screenshots/angular/`:

- `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- `current-orchestration-popover-{model,effort,permission}-{host}-{theme}-1024x768.png`
- **new:** `current-orchestration-popover-copilot-{host}-{theme}-1024x768.png` (Copilot permissions + toggle)
- **new:** `current-orchestration-popover-cursor-{host}-{theme}-1024x768.png` (Cursor credentials)

## 7. Risks and notes

- **Transient duplicate (batches.md Risks):** the AOC's own Copilot toggle and the old PtahCliConfig "Cursor API key"
  field stay until Batches 33 and 34. They write the same keys, so either reflects the other after a refresh.
- **The credentials rule** ("credentials still require a passing connection check", task.md) has no Cursor probe RPC
  to satisfy. The old field saved without a check too. The popover relies on the `cursorApiKeyStored` read-back, and
  the next run verifies the key. Recorded here for the Gate V 36 review.
- **D11:** no state changes. "Needs API key" stays the Cursor status until detection reports it installed (Re-detect).

## 8. Out-of-scope observations

- `settings.fixtures.ts`'s `agent:setConfig` resolver ignores `cursorApiKey` for `cursorApiKeyStored`, so Gate G
  cannot drive a real Cursor save and read-back. A stored-key derivation in the fixture would let #64 assert the write.
  That file is outside this batch.

## Files

- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.spec.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/copilot-auto-approve-toggle.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/copilot-auto-approve-toggle.component.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts` (popover root
  `whitespace-normal text-left` only)
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts`
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts`
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts`
- CREATED `.ptah/specs/TASK_2026_555/batch-31-report.md` (this file)

# Batch 34 report: retire PtahCliConfig (S6, EXCEPTION, D14 atomic)

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-02. Base: HEAD `45fbd7146`
(Batch 33). Track A worktree only. Nothing is staged or committed.

- I did not use `git stash`, restore, checkout, reset or clean.
- Before the visual run I copied all 92 `current-*` captures to `%TEMP%\b34-shots-backup`. Afterwards I copied back
  every non-Orchestration capture (section 7).

## 1. What changed

- **Deleted:** `PtahCliConfigComponent` (`ptah-ai/ptah-cli-config.component.ts`, 258 lines) and its spec. The export
  is gone from the settings barrel (`libs/frontend/chat/src/lib/settings/index.ts`, old line 13).
- **`OrchestrationSettingsComponent`:**
  - `<ptah-cli-config />` is unmounted. That was the old "CLI agents / Add CLI agent / Glm · Ollama Cloud" block under
    the roles.
  - **`cli-agents` deep link:** it now focuses the matrix table `[data-testid="cli-matrix"]` (plan Component 10, S6
    row).
  - **Deferred matrix:** the matrix renders in `@defer`, so the container finds it through a template ref.
    `#cliMatrix` + `viewChild<string, ElementRef>('cliMatrix', {read: ElementRef})`. A class query would make the
    matrix an eager dependency again.
  - **Focus timing:** the query resolves when the deferred block renders. That re-runs the focus effect for a
    `cli-agents` link that arrived before the chunk.
  - **Background roles:** the role path moved into `openBackgroundRoles()` and is unchanged.
- **Matrix table** (`cli-orchestration-matrix.component.ts:97-99`): it gets `tabindex="-1"` and `scroll-mt-4`, so it
  can take programmatic focus. It is not a Tab stop. This is the same pattern as the roles section
  (`data-focus="background-models" tabindex="-1"`).
- **#45 Model count** was shown only by the deleted component, and the matrix did not show it. I moved it into the
  instance Model popover (`cli-model-effort-popover.component.ts:113-117`, computed at `:150-154`).
  - The text reads "12 models available from Ollama Cloud.", with the singular "1 model".
  - It is hidden until `cliAgents` has loaded.
  - It is not shown in system-CLI popovers.
  - This is new copy for Gate V 36 (Deviation 2).
- **`settings.component.ts`:** only the routing-table doc comment changed. It now names the S6 `cli-agents` target.
  The routing itself was already correct: `cli-agents` goes to Orchestration.
- **Stale references:** comments that cited the deleted file now name "the Ptah CLI instance manager retired in Batch
  34":
  - `add-cli-instance-modal.component.ts:18, :179`
  - `cli-model-effort-popover.component.ts:17, :47`
  - `cursor-credential-popover.component.ts:17`
  - `providers-commit.service.ts:236`

  `providers-settings.component.spec.ts:679` now asserts that `ptah-cli-orchestration-matrix` is absent from
  Providers, instead of the deleted selector.

### Harness (Gate G)

- **`settings-reachability.table.ts`:**
  - Every entry that drove the old component is removed from the table: #39 from `mainAgentModel`, and #42, #45, #46,
    #48, #50-#52, #55-#57, #59-#62 and #65-#69 from `cliAgents`.
  - Only #58 (the catalog deep link, which never used the old component) stays in `cliAgents`.
  - Imports are trimmed.
  - `EXPECTED_CAPABILITY_COUNT` stays **97**, and `BASELINE_PRESENT_IDS` is untouched (64 ids). The table went from
    986 to 906 lines.
- **`settings-cli-matrix.entries.ts`:**
  - **Re-pointed entries:** they live in a new `INSTANCE_ENTRIES` block, spread first into `CLI_MATRIX_ENTRIES`. Each
    one makes real clicks on the matrix, its modals and its popovers (section 3).
  - **New helpers:**
    - `throughCellPopover` closes the popover with its own Close button, because the model search's first Esc closes
      only its list.
    - `throughInstanceModel`.
    - `throughDelegatedCell`.
  - **Shared variant page:** `liveVariant` gives one `ALL_CLIS_LIVE` page per session page. It is booted once and
    reused, and the browser context's teardown closes it.
- **`settings-drawer.reach.ts`:**
  - Removed `cliConfigSection` and `throughDelegatedEdit`; their only target was the old component.
  - `throughVariantBoot` now delegates to a new exported `bootVariant` that returns the open page. Its behaviour is
    unchanged.
- **`settings-routing-map.entries.ts` RM-3:** clicks the routing map's "Manage matrix", then asserts that
  `[data-testid="cli-matrix"]` is visible **and focused**.

## 2. Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\`.

| Change | Path |
| --- | --- |
| DELETED | `libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts` |
| DELETED | `libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.spec.ts` |
| MODIFIED | `libs\frontend\chat\src\lib\settings\index.ts` (export removed) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts` (139 lines) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts` (matrix stub; order bar → matrix → roles; `cli-agents` focuses the table, also after a clear and re-request; the "real CLI manager" suite removed) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\settings.component.ts` (doc comment) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\settings.component.spec.ts` (landing suite renders a matrix stub; new case: the `cli-agents` deep link focuses `[data-testid="cli-matrix"]` and no `#providers-cli-heading` exists) |
| MODIFIED | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.table.ts` |
| MODIFIED (extra) | `libs\frontend\chat\src\lib\settings\ptah-ai\cli-orchestration-matrix.component.ts` (table `tabindex="-1"`, 533 lines) |
| MODIFIED (extra) | `libs\frontend\chat\src\lib\settings\ptah-ai\cli-model-effort-popover.component.ts` (#45; 251 lines) and its `.spec.ts` (+2 tests) |
| MODIFIED (extra) | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-cli-matrix.entries.ts` (434 lines) |
| MODIFIED (extra) | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-drawer.reach.ts` (291 lines) |
| MODIFIED (extra) | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-routing-map.entries.ts` (RM-3) |
| MODIFIED (extra, comments/assertion only) | `providers\add-cli-instance-modal.component.ts`, `ptah-ai\cursor-credential-popover.component.ts`, `providers\providers-settings.component.spec.ts`, `libs\frontend\core\src\lib\services\providers-commit.service.ts` |
| CAPTURES | 36 `current-orchestration-*` modified (section 7) |
| CREATED | this report |

No new `as any` or `@ts-ignore`. Every non-spec file I touched is under 700 lines, except `settings-reachability.table.ts`
(906 lines). It was already over the limit and is an accepted data table (a `max-lines` warning since Batch 16); this
batch shrank it by 80 lines.

## 3. Grep proof

`git grep -n "PtahCliConfigComponent\|ptah-cli-config" -- libs apps`, excluding `libs/backend`: **0 hits**.

The only remaining hits are 2 backend import paths, `ptah-cli-config-persistence.service`, in
`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/index.ts` and `ptah-cli-registry.ts`. The batch excepts these
backend symbols. `PtahCliConfigPersistence` in `apps/ptah-electron*` matches neither pattern.

The deleted heading id `#providers-cli-heading` is left only in two absence assertions:
- `orchestration-settings.component.spec.ts:91`
- `settings.component.spec.ts:302`

## 4. Parity: each Ptah-instance capability → where it lives now → Gate G entry

Matrix = `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`;
Popover = `ptah-ai/cli-model-effort-popover.component.ts`; Add modal = `providers/add-cli-instance-modal.component.ts`;
Tier modal = `providers/cli-tier-mapping-modal.component.ts`; Cursor popover = `ptah-ai/cursor-credential-popover.component.ts`.

| Capability (parity-inventory #) | Now lives at | Gate G reach entry (real clicks) |
| --- | --- | --- |
| List instances with name and provider badge (#42) | Matrix row: name, "Ptah CLI" badge `:132`, provider column / narrow inline `:136-142, :162` | **#42**: the Glm row is `data-kind="instance"`, the "Ptah CLI" badge is visible, and exactly one visible "Ollama Cloud" (column in VS Code, inline in Electron) |
| Status / key status / tier badges (#43, #44, #54) | Matrix `:147-160` | #43, #44, #54 (Batch 30, unchanged) |
| Model count (#45) | Popover `:113-117` (instance Model popover) | **#45**: Glm Model cell → "12 models available from Ollama Cloud." |
| **Add** (#46) | Matrix "Add Ptah CLI Instance" `:89` (and the no-instance row `:324-327`) → Add modal name `:62`, provider `:72`, key `:104-106` | **#46**: Add → name, provider (Moonshot), key fields live, "Create Instance" → Esc → focus back on Add |
| Copilot inline login (#47) | Add modal `:85-96` | #47 (Batch 32) |
| Keyless / optional-key hints (#48) | Add modal hint `:116`, `keyHint` `:180-195` | **#48**: Add → Ollama Cloud → hint contains "run ollama signin" |
| Show/hide key (#49) | Add modal `:109` | #49 (Batch 32) |
| **Edit** name / replace key (#50) | Matrix Edit `:260` → Add modal in edit mode | **#50**: Edit → name field holds "Glm", key field live, "Save changes" → Esc → focus back on Edit |
| Enable/disable (#51) | Matrix checkbox `:119-123` | **#51**: the Glm toggle is visible, enabled and checked |
| **Test** connection (#52) and inline result (RUX-11) | Matrix Test `:262`, result `:270` | **#52**: "Test Glm" is visible and enabled; RUX-11 clicks it and checks "Test passed." |
| Tier mapping (#53) | Matrix Tiers `:258` → Tier modal | #53 (Batch 32) |
| **Delete** with confirmation (#55) | Matrix Delete `:266`, confirm `:247-252` | **#55**: Delete → "Confirm delete Glm" is live → Cancel → Delete is back |
| Commit feedback (#56) | Feedback toast on every matrix write (`SettingsSaveFeedbackService`) | **#56**: Glm toggle off → `ptahCli:update {enabled:false}` → toast "Saved Glm off" → checkbox reads back unchecked → restored in `finally` ("Saved Glm on") |
| Empty state with Add (#57) | Matrix `cli-matrix-no-instances` `:324-327` | **#57**: variant page with `ptahCli:list` empty → "No Ptah CLI instance yet." plus its Add button |
| **Per-instance model** (#39 picker, `ptahCli:update.selectedModel`) | Matrix Model cell `:166-179` → Popover `ProviderModelPickerComponent` `:110` | **#39**: Glm Model cell → `ptah-provider-model-picker` visible → Close |
| **Cursor key** (#64) | Matrix Credentials `:282` → Cursor popover key `:61`, Save `:72`, status `:42`, help `:52` | #64 (Batch 31, unchanged) |
| **Delegated model** Codex/Copilot/Cursor/Antigravity/opencode/Pi (#59, #61, #65-#68) | Matrix Model cell `:173` → Popover compact search field `:87` | **#59, #61, #65, #66, #67, #68**: the cell opens the popover for that row and field, the combobox is live → Close. Codex, Antigravity and opencode run on the shared page. Copilot (off in the fixture) and Cursor and Pi (not installed) run on one shared `ALL_CLIS_LIVE` variant page |
| **Delegated effort** Codex/Copilot/Pi (#60, #62, #69) | Matrix Effort cell `:197` → Popover effort options `:95` | **#60, #62, #69**: the cell opens the popover and "Provider default" is live → Close. RUX-8 also writes and undoes an effort |
| Copilot auto-approve (#63) | Matrix permission popover `:236-238` | #63 (Batch 31) |
| `cli-agents` deep link (RM-3) | `orchestration-settings.component.ts:120, :128-130` → matrix table `:97-99` | **RM-3**: routing map "Manage matrix" → table visible and focused |

All 64 baseline ids are still `present` or `restored` (guard test green). No `pending` entry exists.

## 5. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` (no passthrough) | "Successfully ran targets typecheck, lint for 5 projects". After the variant-page change, the harness alone was re-run (`-p @ptah-extension/webview-e2e-harness`): green. |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | Successfully ran test for 4 projects (the harness has no test target). **chat 2202 passed + 2 skipped** (130 suites: the old spec's suite is gone). **core 1109/1109** (36). **ui 624/624** (31). **webview 224/224** (11). |
| Targeted jest (container, popover, settings, providers specs) | 36/36 and 100/100 |
| `npx nx build ptah-extension-webview --skip-nx-cache` | Success, no budget error. Initial total **3.46 MB** (Batch 33: 3.48 MB; the deleted component left `main.js`). The pre-existing 2.5 MB warning is now 959.93 kB over. `cli-orchestration-matrix-component` is still a lazy chunk (65.07 kB raw / 14.65 kB transfer). |
| `settings-visual.e2e.spec.ts` + `settings-orchestration.e2e.spec.ts`, `--workers=2` | **18/18 passed** (1.6 m) |

## 6. Gate G record (`--reporter=list`, cwd `libs\frontend\webview-e2e-harness`, `--workers=2`)

CPU was at 100% (`Win32_Processor.LoadPercentage`) from other sessions during every run.

| Run | Code | Repeats | Result | Failures, diagnosed |
| --- | --- | --- | --- | --- |
| G1 | first draft (one variant boot per delegated entry) | 3 | **22/27** | 5 × "every present/restored capability is reachable". Each one was `Test timeout of 180000ms exceeded`, then `locator.count: Target page, context or browser has been closed` at `settings-reachability.e2e.spec.ts:89:67` (the per-step backstop), plus one `route.fetch: read ECONNRESET` at `csp-stub.ts:40:34`. The steps running at timeout were vscode **#49**, electron **#31**, vscode **#53**, vscode **#62** and electron (unnamed). No assertion failed. **Cause:** the run ran out of time, and my draft added 5 full second-page boots (#61, #62, #65, #68, #69) on a starved CPU. **Fix:** one shared `ALL_CLIS_LIVE` variant page (`liveVariant`), booted once per session. |
| G2 | final | 1 (diagnostic) | **9/9** | none. vscode 2.0 m, electron 2.1 m (Batch 33 was about 1.8 m). |
| G3 | final | 3 | **26/27** | 1: vscode repeat 0, **#64 Cursor API key** (a Batch 31 entry this batch did not change). `Test timeout of 180000ms exceeded`, then `locator.count: Target page … closed` at `settings-reachability.e2e.spec.ts:89:67`. No assertion error. The concurrent electron repeat 0 also took 3.0 m (it passed); repeats 1-2 took 1.7-1.8 m each. Suspected cause: CPU starvation during the first pair (the known watcher-timeout-under-load flake). It did not reproduce. |
| **G4** | **final** | **3** | **27/27 passed (6.2 m)** | none. Each test took 1.7-2.2 m. |

The D14 proof is Gate G green with the old component deleted: G4, every repeat in both hosts.

## 7. Captures and fold

**Captures:** I re-took all `current-orchestration-*` (tab, roles-open, order-popover, the matrix popovers and the
modals), both hosts and both themes, 1024×768. They are all in
`D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`:

- `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- `current-orchestration-roles-open-*`, `current-orchestration-order-popover-*`
- `current-orchestration-popover-{model,effort,permission,copilot,cursor}-*`, `current-orchestration-modal-{add,tiers}-*`

**Restore:** every non-Orchestration `current-*` was copied back from `%TEMP%\b34-shots-backup`. The capture
`git status` shows:
- **36 modified**, all `current-orchestration-*` (the other 4 re-took byte-identical);
- 0 non-Orchestration files changed;
- 0 `baseline-*` changed.

**Fold** (bottoms in px from the viewport top, 1024×768; budget 660):

| Host / theme | orchestration-policy-bar | cli-matrix header | first row | background-roles-summary |
| --- | --- | --- | --- | --- |
| vscode / anubis | 125 | 206 | 247 | **643 (fits)** |
| vscode / anubis-light | 125 | 206 | 247 | **643 (fits)** |
| electron / anubis | 165 | 270 | 313 | **779 (119 over)** |
| electron / anubis-light | 165 | 270 | 313 | **779 (119 over)** |

These are identical to Batch 33: the deleted block rendered below the roles summary, so the fold is unchanged.
- VS Code still fits.
- The Electron overrun (119 px) is still Gate V 36 item 4 (the matrix's narrow layout).

## 8. Deviations

1. **Files beyond the batch's 7 paths.**
   - **Tests would fail without them:**
     - the container spec imported the deleted class;
     - `settings-drawer.reach.ts` held the old helpers;
     - RM-3 targeted the deleted heading;
     - the matrix table needed `tabindex="-1"` for the S6 focus target. The matrix file is outside the list.
   - **The quality grep needed them:** comment edits in 4 files, and one absence assertion in the Providers spec.
   - **The matrix entries file:** the re-pointed entries live there, beside the helpers they use. The table is over its
     `max-lines` budget.
2. **#45 Model count is new UI in the instance Model popover.**
   - The matrix had no place for it, and #45 is a frozen baseline id, so dropping it would break D14.
   - I put it in the popover rather than in the row because a badge in the row would add height to the Glm row, which
     is already 113 px in Electron (the fold).
   - Copy for Gate V 36: "{N} models available from {Provider}." / "1 model available from {Provider}.".
3. **#56 now proves the feedback through the toast** ("Saved Glm off"), not the container's
   `providers-commit-feedback` panel. Every matrix write reports through `SettingsSaveFeedbackService` (Batch 30).
4. **Delegated entries for Copilot, Cursor and Pi run on a variant page** where every CLI is installed and on.
   - On the shared fixture, Copilot is off and Cursor and Pi are not installed. The matrix deliberately shows those
     cells as plain text (#71, restored in Batch 30), so these entries cannot reach them there.
   - The old flat list showed all 9 fields regardless.
5. **The matrix table is the focus target, as the plan says.** It has no visible focus ring for a mouse-initiated deep
   link, the same as the roles section (`tabindex="-1"`, default browser outline).

## 9. Out of scope, noted

- **Host text in the Test result:** `cli-orchestration-matrix.component.ts:476` renders `Test failed: ${row.lastTest.reason}`.
  That is the host's reason text, described in the code as sanitized (Batch 30, RUX-11).
  - This batch did not touch that line.
  - It conflicts with "fixed sentences only" if the host reason is not sanitized. I recommend checking it in the
    Gate V 36 combined review.
- **Chevron direction:** in `current-orchestration-roles-open-*` the open `<details>` chevron points left. The icon
  is `ChevronRight` with `group-open:rotate-90`. This is pre-existing (Batch 33). **Fixed in Revise round 1 below.**
- **CPU:** load stayed at 100% from other sessions throughout. The G1 and G3 timeouts are recorded above.

## Revise round 1 (orchestrator)

**Request:** the open background-roles chevron must point down (⌄), and the closed one right (›). The rotation goes on
`[open]` and the icon stays decorative.

**Root cause** (measured in the browser, not guessed):
- `lucide-angular` copies its host `class` onto the inner `<svg>`. So `group-open:rotate-90` on the icon applied twice:
  the host and the svg each computed `matrix(0, 1, -1, 0, 0, 0)`.
- The two turns add up to 180°, which drew "‹".
- Closed looked right only because the rotate was inactive.
- Pixel dumps of the old capture confirmed it: "›" closed at y 621-627, "‹" open.

**Fix** (`orchestration-settings.component.ts`, the summary):
- The turn moved to a decorative wrapper:
  `<span class="inline-flex shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" data-testid="background-roles-chevron">`.
- The icon inside keeps only `block h-3.5 w-3.5 text-info`.
- `group` stays on the `<details>`.

**Tests:**
- **Container spec:** +1 test. The chevron is `aria-hidden`, the wrapper carries `group-open:rotate-90`, and the
  icon's class has no rotate. File total 17/17.
- **`settings-visual.e2e.spec.ts` `captureRolesOpen`:** asserts the rendered turn in both hosts and both themes:
  - closed: wrapper `none`, icon and svg `none`;
  - open: wrapper `matrix(0, 1, -1, 0, 0, 0)`, icon and svg `none`.

  The old double turn fails this assertion.

**Verification:**

| Check | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness` | Successfully ran for 2 projects |
| Container spec | 17/17 |
| `npx nx build ptah-extension-webview --skip-nx-cache` | Success. Initial total 3.46 MB; matrix chunk still lazy (65.07 kB) |
| `settings-visual.e2e.spec.ts --workers=2` | 4/4 (chevron assertions green in all four). Fold unchanged (VS Code 643, Electron 779) |

Gate G was not re-run for this round. The change is template-only in the summary, and no reach entry reads the
chevron.

**Captures:**
- Only `current-orchestration-roles-open-{vscode,electron}-{anubis,anubis-light}-1024x768.png` were re-taken.
- Every other `current-*` was restored from `%TEMP%\b34r-shots-backup`. Each of them is byte-identical to its
  pre-revise copy, and no `baseline-*` changed.
- The VS Code captures now show "⌄" (pixel dump, rows 22-25).

**Accepted for now, listed for the Gate V 36 code review:** the matrix's "Test failed: {reason}" line
(`cli-orchestration-matrix.component.ts:476`) shows a host reason. It is accepted because the registry sanitizes the
reason (`ptah-cli-rpc.handlers.ts:301-303`, Batch 12b), and the handler's own catch returns the fixed
`PTAH_CLI_RPC_ERRORS.testConnection`.

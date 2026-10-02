# Batch 52 report — live-data defects (before Batch 38), tasks 52.1-52.7

Author: the Orchestration owner, an in-process frontend-developer, track A worktree (head 520d88c34). No commit and no
change to batches.md.
- Evidence: the Batch 37 live Electron docs shots (`%TEMP%\b37-docs-shots`).
- Reference: `prototypes/final/screenshots/index-anubis-1024x768.png`.

Path prefixes used below:
- `CHAT` = `libs/frontend/chat/src/lib/settings`
- `HARNESS` = `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`

## 52.1 CLI version text

**Cause.** `probeCliVersion` (`cli-adapter.utils.ts:361`) returns the CLI's first `--version` stdout line verbatim, and
the matrix printed `v{{ row.version }}`. Live lines are "codex-cli 0.155.1", "opencode v2.0.12" and "GitHub Copilot CLI
1.0.83.", so the cell showed "vcodex-cli 0.155.1".

**Where it is fixed.** I fixed it in the UI, not at the source. The raw line is a wire value (`CliDetectionResult.version`)
that other consumers also read: `tasks-ui/.../task-agent-discovery.service.ts:69` says "Run through {cli} {version}", and
Cursor uses the sentinel `'sdk'`. Changing the backend string would change that contract for every consumer. The pure
function makes the UI safe for any line. The tasks-ui sentence has the same raw-line issue; it is outside this batch and
noted below.

**Fix.**
- `CHAT/ptah-ai/cli-matrix-rows.ts:150` adds `cliVersionLabel(raw)`: the first semver-like token as `v{token}` ("v0.155.1",
  "v2.0.12", "v1.0.83", "v0.9.0-beta.2"). A line with no such token is shown trimmed, without a `v`.
- Rows carry `version` (the raw line) and `versionLabel` (`:43`, `:201`).
- `CHAT/ptah-ai/cli-orchestration-matrix.component.ts:141-149`:
  - The name row is `flex-nowrap`, and the name never shrinks.
  - The version span shows `versionLabel` on the name's line, truncates at 8rem, and has the raw line as its `title`
    (`data-testid="cli-matrix-version"`).

**Specs.**
- `CHAT/ptah-ai/cli-matrix-rows.spec.ts`, "Batch 52: live CLI values": six `cliVersionLabel` cases, plus a row that keeps
  the raw line.
- `CHAT/ptah-ai/cli-orchestration-matrix.component.spec.ts`, "Batch 52: live-shaped values": the label, the title,
  `truncate`, the `flex-nowrap` parent, and no "vcodex".

## 52.2 Model cell shows one value

**Cause.** This is a backend parse defect, confirmed on this machine with `agy models` (agy 1.2.x). The CLI now prints a
status line, then one `id<TAB>display name` line per model:
```
Fetching available models...
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
```

`AntigravityCliAdapter.listModels()` treated each whole line as both id and name. So:
- the model list offered "Fetching available models..." as a model;
- every option's id was the tab-joined line;
- a picked model was saved as "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)" and passed whole to `--model`.

The matrix printed that saved value, so the cell showed the id and the name on three lines.

**Fix at the source** (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`):
- `parseAgyModels` (`:207`): skips a tab-less status line ending in "...", and splits `id<TAB>name`. The old one-label
  format ("Gemini 3.1 Pro (High)") still parses as id = name.
- `agyModelId` (`:227`) takes the id of a value saved by the earlier parse. `buildAntigravityArgs` (`:249`) now passes
  only that id to `--model`, so models saved before this fix still spawn correctly.

**UI safety for saved values.** `CHAT/ptah-ai/cli-matrix-rows.ts:159`, `cliModelDisplay(value)`: an `id<TAB>name` value
shows the id, with "id (name)" as the title.
- The matrix model cell (`cli-orchestration-matrix.component.ts:198, 207, 571-579`) shows that one value: the id, in mono
  like the other rows.
- It has `line-clamp-2` (two lines at most, as in the prototype) and a `title` with the full value.
- Its accessible name uses the id.

**Specs.**
- Backend `antigravity-cli.adapter.spec.ts`: the agy 1.2 format (status line skipped, id/name split), and
  `--model claude-sonnet-4-6` for a tab-saved value. The old-format and `--model` cases still pass (52 tests).
- `cli-matrix-rows.spec.ts`: `cliModelDisplay`.
- The matrix spec: id-only text, `line-clamp-2`, and the title.

## 52.3 / 52.6 Main Agent node head

**Cause.** The node head allowed the badge group up to 70 % of the width with `flex-wrap`, and let the title wrap (the
Gate V 28 rule: "the title wraps instead of pushing badges to a row of their own"). With three live overrides (Effort ·
App, Authentication · Workspace, Provider · Workspace), the field badges stacked on three rows and "MAIN AGENT" broke over
two lines.

**First attempt (52.3, replaced).** The first field badge plus "+N", truncating, came out as "Eff…" + "+2" in a 261 px
VS Code node: unreadable. 52.6 replaces it.

**Final pattern (52.6, prototype `index-anubis-1024x768.png`).** The head shows **one badge per overridden scope layer**,
never truncated:
- The App layer badge is named after the host (Batch 27b): "VS Code override" in VS Code, "Desktop app override" in
  Electron.
- The workspace layer badge is "Workspace override". A rare Global override reads "Global override".
- Order: App, then Workspace. At most the host's layers, so at most 2 in practice.

Each layer badge is a popover trigger (`aria-haspopup="dialog"`, `aria-expanded`). Its accessible name lists the fields,
for example "Workspace override: Main agent authentication, Main agent provider". The dialog lists the fields overridden
at that layer as the existing D16 field badges ("Authentication · Workspace"), each with its own layers and Clear / Use
global actions. A clear closes the layer dialog and hands the clear to the host's review. Inherited fields show nothing
(RUX-6). The "+N" pattern is removed.

**Layout.** The title is one line (`whitespace-nowrap`, `shrink-0`). The status pill and the projected layer badges are
items of the same wrapping row: the badge slot is `display: contents`, and every button in it gets `relative z-10` above
the stretched node action. A badge that does not fit beside the title moves, whole, to the next line under it.

Measured (`B52 main node head` / `B28 fold` logs):

| Case | Badge lines under the title | Main node height | Fold (Gate V 28) |
| --- | --- | --- | --- |
| Default fixture, one layer, VS Code 261 px | 1 ("Workspace override") | unchanged | card 5 at **590** ≤ 660 |
| Default fixture, one layer, Electron 316 px | 0 (beside the title) | unchanged | map + Connections heading at **547** ≤ 660 |
| Live shape, two layers, VS Code | 2 (each badge on its own line; together 271 px > 233 px content), tops 211 / 239 | 197 px | card 5 at **618** ≤ 660 |
| Live shape, two layers, Electron | 1 ("Desktop app override" beside the title, "Workspace override" under it), tops 223 / 251 | 153 px | heading at **557** ≤ 660 |

Both hosts keep the fold in both shapes. In VS Code the two-layer case takes two badge lines rather than one, because two
whole layer badges are wider than the node; nothing is truncated or clipped.

**Files.**
- `CHAT/providers/main-agent-scope-badges.component.ts`, rewritten for layers:
  - testid `main-scope-layer`, with `data-layer` and `data-fields`;
  - its popover `main-scope-layer-popover`.
- `CHAT/providers/providers-settings.component.ts`: `mainScopeFields` computed (`:223`) replaces the two badge loops. 626
  lines.
- `CHAT/providers/routing-map-node.component.ts:37-53`: the wrapping one-line-title head.
- `CHAT/providers/setting-scope-row.component.ts`:
  - `scopeBadgeShown()` and `scopeBadgeLook()` (layer colour and icon) are shared with the layer badges.
  - The 52.3 truncation changes are removed; the field badge renders as before.
- **The shared `ui` change is no longer needed.** The 52.3 `max-w-full` on `native-popover`'s trigger existed only for
  truncation, so it and its spec line were reverted by exact path. `libs/frontend/ui` has no Batch 52 change.

**Specs.**
- `main-agent-scope-badges.component.spec.ts`, rewritten:
  - two layer badges in App, Workspace order, named "VS Code override" (VS Code) or "Desktop app override" (Electron);
  - the accessible name; no truncation;
  - the dialog listing that layer's field badges, and a clear from inside it;
  - the one-layer and no-override cases.
- `providers-settings.component.spec.ts`, `routing-map.component.spec.ts` and `routing-map-node.component.spec.ts` are
  updated for the layer badge and the `contents` slot with `[&_button]:z-10`.

## 52.7 A model saved before 52.2 is the selected catalogue model

The picker read the stored value as it was, so a tab-joined "id<TAB>name" matched no catalogue id and was listed as
"saved, not in the current list".

`CHAT/ptah-ai/cli-model-effort-popover.component.ts` (`savedModelId`) now reads the saved value through the same
normaliser as the cell, `cliModelDisplay(value).label`, for both `selectedId` and the "saved, not in the list" check.
Such a value is therefore the selected catalogue model.
- Undo still writes back the stored value as it was.
- Normalise-on-next-write: picking any other model writes a clean id. Re-picking the same model writes nothing, because
  the search field emits only a change. So a stored tab value stays until the next real change. Its spawn already uses
  the id (52.2, `agyModelId`).

**Spec.** `cli-model-effort-popover.component.spec.ts`, "Batch 52.7": `selectedId` is `claude-sonnet-4-6`, and the
options are the catalogue alone (no "saved, not in the current list" row).

## 52.4 Live-like fixture data in the harness

New `HARNESS/settings-live-shape.fixtures.ts`, `liveShapeOverrides(page)`. It is an opt-in `bootSettings` override, so
`settings.fixtures.ts` is unchanged. It provides:
- raw version lines for codex, copilot, opencode and antigravity;
- the `id<TAB>name` Antigravity model;
- three Main Agent override layers: effort in App, authentication and provider in the workspace. A cleared override
  reads back as inherited.

`HARNESS/settings-visual.e2e.spec.ts`, "live-shaped values — Batch 52", both hosts × both themes. It asserts:
- the layer badges' text ("VS Code override" / "Desktop app override", then "Workspace override");
- the title is one line;
- badges sit at most two lines under the title, none runs past the node, and none is clipped (`scrollWidth`);
- the Gate V 28 fold (`assertProvidersFold`) holds with the taller node;
- the workspace layer dialog lists its two fields, and Esc returns focus to the layer badge;
- the four version labels and titles, each on the name's line;
- the Antigravity model id, its title, and at most two lines.

It captures `current-live-providers-*` and `current-live-orchestration-*`.

**Baseline smoke.** Every routing-map title is one line (≤ 17 px; it was ≤ 34). The pill is on the title's line, and the
layer badges are on it or the next. No layer badge runs past the node or is clipped. The scope-popover capture now opens
the layer badge first.

**Gate G / reach helpers** (selector safe-list updated in this batch):
- `openScopeBadge` opens the Main Agent layer badge first when the field badge is inside it.
- `#17` reaches "Workspace override", then "Effort · Workspace".
- `RUX-6` checks one layer badge with one field. Esc closes the field popover (focus on the field badge), then the layer
  popover (focus on the layer badge).

**Harness race fixed along the way (52.3 run).** The model-search capture typed into the field on the same render that
opened the list, which keeps the open contract (no active row), so the 51.3 wait never met. The capture now waits for
`aria-expanded="true"` before typing. Baseline smoke `--repeat-each=3`: 12/12 passed.

## 52.5 Electron docs shots

Steps:
1. `npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron`, then (cwd `apps/ptah-electron-e2e`)
   `npx playwright test --config=docs-screenshots.config.ts workspace-settings.shot.ts`: **3 passed (1.3 m)**. Run after
   52.3 and again after 52.6/52.7. As in Batch 37, the docs harness launches against a throwaway copy of the real
   profile (`docs-profile.ts`); the running Ptah instance was not touched.
2. Kept:
   - `apps/ptah-docs/public/screenshots/settings-overview.png`, from the second run (52.6).
   - `agents-orchestration.png`, from the first run. The second run's copy was identical: 0 pixels over the threshold.
3. Restored by exact path (`git restore -- <path>`) after each run, outside scope: `recent-workspaces.png`,
   `setup-new-project.png`, `theme-toggle.png`, `workspace-switcher.png`.

**What the shots show (live profile).**
- `agents-orchestration.png`:
  - Versions read "v0.155.1" (Codex), "v1.0.83" (Copilot), "v1.2.15" (Antigravity) and "v2.0.12" (OpenCode), each on the
    name's line.
  - Antigravity shows "claude-sonnet-4-6" on one line.
  - opencode's long id wraps to exactly two lines.
- `settings-overview.png`:
  - The Main Agent head reads "MAIN AGENT" on one line, with "Active" at the right.
  - Under the title: "Desktop app override", then "Workspace override", both whole.
  - Provider "OpenAI Codex", model `gpt-5.6-sol`.

## Verification (final, after 52.6/52.7)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview @ptah-extension/cli-agent-runtime`:
  "Successfully ran targets typecheck, lint for 6 projects".
- `npx nx run-many -t test -p (same) -- --maxWorkers=2`: "Successfully ran target test for 5 projects". The harness has
  no test target.
- `npx nx build ptah-extension-webview`: exit 0, after the last app change.
- Gate G (`settings-reachability.e2e.spec.ts --reporter=list`): **9 passed**.
- Full settings folder (`--reporter=list --workers=2`): **92 passed, 2 skipped**. The 2 skips are the existing
  `test.skip` "deep link main-model opens the popover", one per host.
- Live-shape visual test alone: 4 passed, with the fold numbers above.

## Captures (compared with the tree before this batch, `b36b-diff` pattern)

**New (8):** `current-live-providers-{vscode,electron}-{anubis,anubis-light}` and
`current-live-orchestration-{vscode,electron}-{anubis,anubis-light}`.

**Kept (92), real Batch 52 changes, by tab:**
- **Providers (52.6 layer badge; in VS Code it moves under the one-line title):**
  - `current-providers-*` (4), `current-scope-popover-*` (4; now the layer dialog with the field popover open)
  - `current-provider-catalog-*` (4), `current-main-agent-{popover,model-search,save-to}-*` (12)
  - `current-drawer-*` (28: the page behind or beside the drawer)
- **Orchestration (52.1: the name and version share one `flex-nowrap` baseline row, a small shift of that cell):**
  - `current-orchestration-{vscode,electron}-*` (4)
  - `current-orchestration-popover-{model,effort,permission,copilot,cursor}-*` (20)
  - `current-orchestration-order-popover-*` (4), `current-orchestration-role-popover-*` (4),
    `current-orchestration-roles-open-*` (4)
  - `current-orchestration-modal-{add,tiers}-vscode-*` (4)

**Put back (30), no pixel over the threshold:** each was copied back by exact path from the pre-batch copy of the tree.
- Advanced (19), Search & Voice (7, of which 6 voice drawers).
- Orchestration (4): the Electron add and tiers modals, where the matrix cell sits behind the dialog.

The list is in `%TEMP%\b52\zero.txt`. No `baseline-*` file changed.

## Out of scope (not changed)

- `tasks-ui/.../task-agent-discovery.service.ts:69-70` builds "Run through {cli} {version}." from the same raw line
  ("Run through codex codex-cli 0.155.1."). It could reuse a version normaliser; that belongs to the tasks UI owner.

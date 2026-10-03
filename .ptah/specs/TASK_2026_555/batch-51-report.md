# Batch 51 report — muted token + style polish (after the merge), tasks 51.1-51.6

Author: the Orchestration owner, an in-process frontend-developer, track A worktree (head 31337c533, the merge of track
B). No commit and no change to batches.md. Source: batches.md "Batch 51" (51.1-51.5) and task.md "Gate V 50
(2026-10-02, user)" (4).

## 51.1 Muted text token contrast

**Cause.** There were two separate problems.

1. The token `--bcm` was measured only against `base-100` (it was built as base-content mixed 40 % toward base-100 in
   OKLCH). In Settings, muted text also sits on base-200 (the "Order:" bar, the matrix subtitle and the roles copy) and on
   base-300 (row and header bands). There it fell below AA:

   | Theme | base-100 | base-200 | base-300 |
   | --- | --- | --- | --- |
   | anubis-light | 5.01 | 4.47 | 4.16 |
   | anubis (dark) | 5.29 | 4.94 | 4.37 |

2. Every table header (`<th>` in `thead`) is coloured by daisyUI's own rule, `.table :where(thead, tfoot)`, which is
   base-content at 60 % alpha, not by the muted token. On anubis-light's base-100 that gives 4.45:1. This covers the
   Advanced and Search & Voice tables: 33 of the 38 axe violations before this batch.

No component adds an extra opacity on muted text: the axe scan found none.

**Fix (theme and app-styles level only; no per-component change).**

- `apps/ptah-extension-webview/tailwind.config.js`: new `--bcm` per theme. Each is the largest OKLCH mix of
  base-content toward base-100 that still clears 4.6:1 on every base surface. Both remain clearly muted: the mix is
  about 37-38 % toward base-100.
  - anubis-light: `50.847645% 0.043215 351.109855` (36.75 % mix). Was `53.2596% 0.0412 354.4634`.
  - anubis: `64.337084% 0.007433 26.281219` (38.25 % mix). Was `63.048152% 0.00745 23.427972`.
- `apps/ptah-extension-webview/src/styles.css` (new block after the per-theme `--bcm` list, in `@layer components`):
  `.table :where(thead, tfoot) { color: var(--fallback-bc, oklch(var(--bcm, var(--bc)))); }`. Table headers now use the
  measured token. It falls back to base-content, so an unmeasured theme cannot fail.
- The other 32 daisyUI themes are unchanged; their `--bcm` values and the ≥ 5.0:1 rule against base-100 still hold.

**Specs.**
- `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`: new guard
  `theme "anubis"/"anubis-light" on every base surface`, checking ≥ 4.5:1 against base-100, base-200 and base-300. The
  old light value fails it at 4.47 and 4.16. 114 tests pass.
- `apps/ptah-extension-webview/src/app/settings-shared-styles.spec.ts` (new): checks that the table-header rule uses
  `--bcm`.

**Contrast, token against each surface (culori WCAG, from the theme source):**

| Theme | Surface | Before | After |
| --- | --- | --- | --- |
| anubis-light | base-100 `#faf7f5` | 5.01 | **5.56** |
| anubis-light | base-200 `#efeae6` | 4.47 | **4.96** |
| anubis-light | base-300 `#e7e2df` | 4.16 | **4.61** |
| anubis | base-100 `#131317` | 5.29 | **5.56** |
| anubis | base-200 `#1a1a20` | 4.94 | **5.20** |
| anubis | base-300 `#242430` | 4.37 | **4.60** |
| anubis-light table header | base-100 (was base-content at 60 % alpha) | 4.45 | **5.56** |

**axe `color-contrast`** was run on all four tabs, in both hosts and both themes, at 1024×768. On the Orchestration tab
the scan included the roles section opened and the Uninstalled group expanded. It used a temporary probe spec, deleted
after use.

Before (HEAD tokens, built separately):

| Host / theme | Providers | Orchestration | Advanced | Search & Voice |
| --- | --- | --- | --- | --- |
| vscode, anubis | 0 | 0 | 0 | 0 |
| vscode, anubis-light | 0 | **3** | **9** | **5** |
| electron, anubis | 0 | 0 | 0 | 0 |
| electron, anubis-light | 0 | **2** | **9** | **10** |

The failing nodes, all in anubis-light:
- `#81636e` on `#efeae6`, **4.45:1**: "Order:", the matrix subtitle "Click model or effort cells…", and the roles copy
  "These assignments…".
- `#7d6e81` on `#faf7f5`, **4.45:1**: every table `<th>` on Advanced and Search & Voice.

The Uninstalled header cases from V36-3 (4.14 light, 4.39 dark) no longer appear in the scan. That header has been
`text-base-content` since 36b. The muted rows under it now measure 4.61 / 4.60 against base-300.

After: **0 violations in all 16 host × theme × tab combinations.** The remaining "incomplete" results (3-4 per tab on
Providers and Orchestration) are all axe `nonBmp` on the "→" arrow glyphs, which use the same, now passing, token.

## 51.2 aria-disabled buttons look like native disabled

**Fix.** One shared rule in `styles.css` (same new block, `@layer components`).

- `:where(ptah-settings) .btn[aria-disabled='true']` (and its `:hover`) copies daisyUI's `.btn:disabled` declarations:
  - `--tw-border-opacity: 0`
  - neutral fill at `--tw-bg-opacity: 0.2`
  - base-content text at `--tw-text-opacity: 0.2`
  - plus `cursor: not-allowed`
  
  It deliberately omits `pointer-events: none`, so the button stays focusable and clickable; the handlers refuse the
  click.
- `:where(ptah-settings) button[aria-disabled='true']:not(.btn)` gets `cursor: not-allowed; opacity: 0.6`. This covers
  the roles-table cell.
- The rule is scoped to Settings. Other surfaces that use `aria-disabled` on buttons (git diff view, clone card, message
  bubble, Open-in button) keep their own styles; they were not checked here.
- `:where()` keeps the specificity equal to daisyUI's, so a component utility can still refine its own disabled look.

**Per-component aria-disabled classes removed:**
- `provider-consumer-assignments.component.ts:20` (CELL: `aria-disabled:cursor-not-allowed aria-disabled:opacity-60`).
- `cursor-credential-popover.component.ts` (the `INERT` constant and its use on `ACTION` and Save).
- `agent-orchestration-config.component.ts:15` (MOVE): `aria-disabled:opacity-50 cursor` replaced by
  `aria-disabled:border-transparent aria-disabled:bg-transparent`. This mirrors MOVE's own `disabled:` ghost look, so
  the native-disabled first/last arrows and the aria-disabled arrows during a save look the same.

**Specs.**
- `settings-shared-styles.spec.ts`: checks the rule's declarations, and that it has no `pointer-events`.
- `settings-orchestration.e2e.spec.ts`, the Cursor N3 scene: the empty-field "Save key" is `aria-disabled`, its computed
  text colour ends in `/ 0.2)`, its cursor is `not-allowed`, its pointer-events are not `none`, and it takes focus.
- The `%TEMP%\b36d-crop-cursor.png` case now reads like daisyUI disabled (grey fill, faint text) instead of primary at
  50 %. Compare `%TEMP%\b51\cur-before.png` and `%TEMP%\b51\cur-after.png`.

## 51.3 Model-search capture waits for the active row

`HARNESS/settings-visual.e2e.spec.ts` (before the `main-agent-model-search` capture) waits for three things:
- `aria-activedescendant` is set.
- The option it names has `aria-selected="true"`.
- That option has its `bg-primary` highlight.

Then it captures.

## 51.4 saveGeneric spec asserts its result

`CHAT/feedback/settings-save-feedback.service.spec.ts`, `describe('saveGeneric (G2)')`. Every case now asserts the
returned `SettingsSaveResult`:
- `'saved'`: with Undo, without Undo, and the first of two concurrent saves.
- `'failed'`: from `ok:false`, and from a throw.
- `'refused'`: while a generic save is in flight, and while a Providers commit is saving.

The suite passes.

## 51.5 Gate G no longer depends on the network

**Cause.** The production build inlines the Google Fonts CSS from `styles.css`, so the page requests the woff2 files
from `fonts.gstatic.com` directly. `installCspStub` sent every request through `route.fetch()`, which needs the network.

**Fix.** `HARNESS/../../csp-stub.ts`:
- `fonts.gstatic.com` requests are fulfilled from a byte copy in `libs/frontend/webview-e2e-harness/src/lib/fonts/gstatic/`,
  at the same paths. That is 15 files: Inter v20, Cinzel v26, JetBrains Mono v24.
- A path that resolves outside the copy is blocked. A file not in the copy is aborted with a console warning, never
  fetched.

The repo and `node_modules` had no local copy of these fonts, so I added one:
- **Size:** 325 KB of woff2 (376 KB on disk with the licences).
- **Licence:** all three families are SIL Open Font License 1.1, which allows redistribution with the licence. The OFL
  texts are vendored as `fonts/OFL-inter.txt`, `OFL-cinzel.txt` and `OFL-jetbrainsmono.txt` (copyright lines: The Inter /
  Cinzel / JetBrains Mono Project Authors).

**Proof.** A temporary probe (deleted after use) launched Chromium with
`--host-resolver-rules=MAP fonts.gstatic.com 0.0.0.0, MAP fonts.googleapis.com 0.0.0.0`, so the hosts cannot be
reached. Result:
- Two font responses, both 200 from the local copy.
- 0 failed requests.
- `document.fonts.check('500 12px Inter')` and the JetBrains Mono check both true.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview`:
  "Successfully ran targets typecheck, lint for 5 projects".
- `npx nx run-many -t test -p … (same 5) -- --maxWorkers=2`: "Successfully ran target test for 4 projects". The harness
  has no `test` target.
- `npx nx build ptah-extension-webview`: exit 0.
- Gate G, `settings-reachability.e2e.spec.ts --reporter=list`: **9 passed**.
- Full settings folder, `--reporter=list --workers=2`: **88 passed, 2 skipped**. The 2 skips are the existing
  `test.skip` "deep link main-model opens the popover on the model control" (vscode and electron); they are not new.

## Captures (against HEAD, `b36b-diff` pattern: a pixel counts when the summed channel difference is > 24)

The run rewrote 136 captures.

**Restored with `git restore -- <path>` (106):** no pixel over the threshold.
- In these the only change is the muted-token shift. It is real but below the threshold: for example, 10,604 pixels
  differ at threshold 0 and 2,026 at threshold 12 in `current-providers-vscode-anubis-light`. That is not visible.
- By tab:
  - Providers: all `current-providers-*`, `current-provider-catalog-*`, `current-scope-popover-*`,
    `current-main-agent-*` and `current-drawer-*` (28 drawer).
  - Orchestration: all `current-orchestration-*` except the four Cursor popovers.
  - Advanced and Search & Voice: the remaining variants listed below as not kept.

**Kept (30), by tab:**

- **Orchestration (4), 51.2:** `current-orchestration-popover-cursor-{vscode,electron}-{anubis,anubis-light}`. The empty
  "Save key" now has daisyUI's disabled look (about 1,350 pixels).
- **Advanced (20), 51.1 table headers on the muted token:**
  - `current-advanced-{vscode,electron}-{anubis,anubis-light}`
  - `current-advanced-output-style-{vscode,electron}-{anubis,anubis-light}`
  - `current-advanced-mcp-{vscode,electron}-{anubis,anubis-light}`
  - `current-advanced-mcp-localhost-confirm-{vscode,electron}-{anubis,anubis-light}`
  - `current-advanced-vscode-lm-{vscode,electron}-{anubis,anubis-light}`
- **Search & Voice (6), 51.1 table headers:**
  - `current-search-voice-{vscode,electron}-{anubis,anubis-light}`
  - `current-go-vet-electron-{anubis,anubis-light}`

No `baseline-*` file changed.

**Note:** `current-advanced-mcp-{vscode,electron}-anubis-light` also differed by a hover fill on the focused "edit style"
pencil. 51.6 routes those captures through the shared helper; see below.

## 51.6 One shared capture helper for every settings spec

**Change.** `capture()` and `capturePath()` moved out of `settings-visual.e2e.spec.ts` into a named harness file,
`HARNESS/settings-capture.ts`. It is imported by `settings-visual.e2e.spec.ts` and by the track B
`settings-advanced-search-voice.e2e.spec.ts`, whose own `shoot()`, `capturePath` and output-dir code are deleted. There
is one copy, not two.

Each capture now:
- waits for `waitForSettled` (no `aria-busy`, spinner or loading row);
- moves the pointer to (0, 0);
- screenshots with `animations: 'disabled'`;
- creates the output folder itself.

The `baseline-*` switch (`SETTINGS_CAPTURE_BASELINE=1`) now applies to both specs. No settings spec calls
`page.screenshot` directly any more; `grep` finds only the helper. The harness typecheck and lint pass.

**Run.** The build was current (harness-only change), so no rebuild.
`settings-advanced-search-voice.e2e.spec.ts` + `settings-visual.e2e.spec.ts`, `--reporter=list --workers=2`:
**12 passed**.

**Captures** (126 rewritten, compared with the tree before the run, `b36b-diff` pattern):
- **Kept (8):** a removed hover artefact. In each, the focused row button (the Details chevron, or the style pencil)
  lost its hover fill, and the hovered card lost its hover background:
  - `current-advanced-output-style-{vscode,electron}-anubis-light`
  - `current-advanced-mcp-{vscode,electron}-anubis-light`
  - `current-advanced-mcp-localhost-confirm-{vscode,electron}-anubis-light`
  - `current-advanced-vscode-lm-{vscode,electron}-anubis-light`

  All 8 were already among the 30 Batch 51 keeps, so the kept set is still 30 files.
- **Put back (118):** 0 pixels over the threshold. Each was copied back by exact path from the pre-run copy of the
  tree, which keeps the earlier Batch 51 keeps; `git restore` would have reverted those to HEAD. This covers the other
  Advanced and voice-drawer captures, and every Providers, drawer, main-agent and Orchestration capture.

No `baseline-*` file changed.

## Files

- MODIFIED `apps/ptah-extension-webview/tailwind.config.js` (two `--bcm` values and their comments).
- MODIFIED `apps/ptah-extension-webview/src/styles.css` (new Batch 51 block: table headers and aria-disabled).
- MODIFIED `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`.
- CREATED `apps/ptah-extension-webview/src/app/settings-shared-styles.spec.ts`.
- MODIFIED `CHAT/providers/provider-consumer-assignments.component.ts`, `CHAT/ptah-ai/agent-orchestration-config.component.ts`
  and `CHAT/ptah-ai/cursor-credential-popover.component.ts` (per-component aria-disabled classes removed).
- MODIFIED `CHAT/feedback/settings-save-feedback.service.spec.ts`.
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/csp-stub.ts`.
- CREATED `libs/frontend/webview-e2e-harness/src/lib/fonts/` (15 woff2 files and 3 OFL texts).
- MODIFIED `HARNESS/settings-visual.e2e.spec.ts` (51.3, 51.6) and `HARNESS/settings-orchestration.e2e.spec.ts` (51.2 assertion).
- CREATED `HARNESS/settings-capture.ts`; MODIFIED `HARNESS/settings-advanced-search-voice.e2e.spec.ts` (51.6).

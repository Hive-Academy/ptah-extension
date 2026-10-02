# Batch 53 report — Batch 38 findings (B38-1 to B38-5) and the baseline smoke split (53.6)

Author: the Orchestration owner, an in-process frontend-developer, track A worktree (head b45a7ca46). No commit and no
change to batches.md. Source: `visual-review.md` "## Batch 38 final review".

Path prefixes used below:
- `CHAT` = `libs/frontend/chat/src/lib/settings`
- `UI` = `libs/frontend/ui/src/lib/native`
- `HARNESS` = `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`

## 53.1 B38-1: the card reads the recorded check

**Cause.** The card's state came from the route status alone. The connection's own recorded check
(`route.providers[].lastCheck`), which the drawer shows, never reached it. So after a failed drawer check the card
still read "Connected".

**Fix.**
- `CHAT/providers/provider-connection-card.state.ts`:
  - A new state, `check-failed` (`:35`).
  - The pure function `applyRecordedCheck(state, check, routeProbedAt)` (`:72`). A failed record wins over Active,
    Connected, Not checked and Check unavailable, unless the route's own probe is newer than the check (`checkedAt <
    route.probedAt`). An unreadable time on either side never hides the failure.
  - A more specific state (Needs API key, Unreachable, Sign-in required, Not installed) or a running check is kept.
  - A later verified record replaces the failed one, which clears it.
- The `check-failed` row of the state table:
  - Label: "Check failed".
  - Copy: "The last check of {provider} failed. Retry, or open the details for the reason." This is fixed copy; the
    reason stays in the drawer's fixed reason line, never host text.
  - Action: Retry.
  - Colour sits on the error dot, with an error tone and spine on the card; the text stays `text-base-content`.
- `CHAT/providers/provider-connection-card.component.ts` has two new inputs, `lastCheck` and `routeProbedAt`, and
  `resolvedState` applies `applyRecordedCheck`.
- `providers-settings.component.ts:129` passes `lastCheckOf(id)` and `route.probedAt`.
- On the active connection, a failed check shows "Main agent · Needs attention · Check failed", from the existing
  blocked-main rule.

**Specs.**
- `provider-connection-card.state.spec.ts`:
  - the `check-failed` state-table row and action row;
  - a 15-row `applyRecordedCheck` table: newer, same instant, older, no probe time, unreadable time, verified clears, no
    record, and the more specific or running states that are kept.
- `providers-settings.component.spec.ts`, "the card carries its own check (Batch 53, B38-1/B38-2)".

## 53.2 B38-2: card Check / Retry check only their own connection

**Cause.** The card's "Check connection" and "Retry" called `state.checkConnection()`, which is `refresh()` over 12
reads and records no check.

**Fix.** `providers-settings.component.ts:477`, `checkFromCard(id)`. Both card outputs call it.
- **Checkable connections** go through `state.checkProviderConnection(id)`, the drawer's path: API-key, custom, CLI and
  sign-in connections (Moonshot, sovereigneg, Claude API, Claude CLI, GitHub Copilot, OpenAI Codex). It runs
  `auth:checkConnection` for that connection alone, which records `lastCheck`, then re-reads the route.
- **Connections the host cannot check:** local servers and key-optional routes (Ollama, LM Studio, Ollama Cloud). The
  same call re-reads the route alone (`ProvidersConnectionSetupService.checkConnection` → `hooks.refreshRoute()`).
  These now re-read the route instead of all 12 sections; that is the one behaviour that changed for them.
- **While the route read itself has failed** (the card reads "Check unavailable"), Retry keeps the full
  `state.checkConnection()` re-read, which is what can repair the page.
- Busy and D3: no start while a save or a check runs. While its own check runs the card reads "Checking…"; the same
  `connectionCheck` signal drives the drawer, and `connectionStatus` returns `checking` at `:454`.
- Its action leaves the card face, so focus moves to the card itself (`role="button"`), never to `body`.
- D15: the card shows the recorded result only after the route re-read.

**Gate G.** No reachability entry used the card's check, so no selector or RPC expectation changed. GV28-2 (the drawer
check) still passes.

**Specs.**
- `providers-settings.component.spec.ts`:
  - card Retry calls `checkProviderConnection('second')`, not `checkConnection`;
  - "Checking…" while it runs, with no second start;
  - with a failed route read, Retry calls `checkConnection`.
- Playwright `HARNESS/settings-providers.e2e.spec.ts:175`, "the card's own check (Batch 53)", in both hosts:
  1. A failed drawer check on Moonshot ("Check failed" in the drawer).
  2. Closing the drawer shows the card at `data-state="check-failed"`, reading "Check failed", with no host text.
  3. The card's Retry sends exactly one `auth:checkConnection {providerId: 'moonshot'}`.
  4. The verified result returns the card to Connected, and focus is on the card.

**Docs shot.** 53.1 and 53.2 do not change `settings-overview.png`. The docs run checks no connection, so no card has a
recorded check. The re-run left `settings-overview.png` byte-identical (not modified).

## 53.3 B38-3: model list at least as wide as its field

**Cause.** `UI/provider-model-picker/provider-model-search-field.component.ts:71` passed `[matchInputWidth]="compact()"`,
so only the compact (Orchestration) list followed the field.

**Fix.**
- The search field now always passes `[matchInputWidth]="true"` (`:71`).
- `UI/autocomplete/native-autocomplete.component.ts:349-353`: `matchInputWidth` now sets `min-width` to the field width
  and `max-width` to the larger of the field and 448 px (28rem, `MATCHED_PANEL_MAX_PX`, `:67`). The list is never
  narrower than its field; longer rows may widen it up to 28rem; it is never narrower than a field wider than 28rem.
- One `ui` change covers the Main Agent popover, the drawer's Models & Tiers picker, and the compact Orchestration list.

**Specs.**
- `provider-model-search-field.component.spec.ts`: min-width = field and max-width 448 px for compact and non-compact,
  and a 520 px field keeps 520/520.
- Playwright (baseline smoke): `B53 model list vs field` logs list 280 / field 280 (VS Code dark), and 278 / 278 for
  the other three combinations. It was 214 vs 280. It asserts list ≥ field.

## 53.4 B38-4: the order strip shows whole chips, then "+N"

**Cause.** The strip was `overflow-hidden` with an end fade, so the fifth chip was cut mid-glyph ("5. OpenC").

**Fix** (`CHAT/ptah-ai/agent-orchestration-config.component.ts`):
- An invisible, out-of-flow measuring copy holds every chip, one arrow and a "+N" sample (`:86`).
- `measureChips()` (`:223`) counts the whole chips that fit the strip's width. When not all fit, it keeps room for
  "→ +N".
- The strip renders those chips, then a "+N" chip (`policy-order-more`, `:82`) whose title is the whole order.
- The end fade is removed.
- One `ResizeObserver` on the strip, disconnected on destroy, recounts on a resize or a changed list. With no layout
  (a test DOM), every chip shows.
- The Edit button's accessible name and the order popover still list the whole order.

**Results** (`B53 order strip` logs; checked in both hosts and both themes, default and live-shape fixtures):

| Host | Shown |
| --- | --- |
| VS Code | "1. Codex → 2. Antigravity → 3. Glm → 4. Copilot → +1" |
| Electron | "1. Codex → 2. Antigravity → +3" |

Overflow is 0 everywhere and no chip is clipped. The live docs shot now reads "1. Codex → 2. Copilot → 3. Antigravity →
+2".

**Specs.**
- `agent-orchestration-config.component.spec.ts`, "order strip: only whole chips, then +N": a mocked observer and widths
  give 200 px → codex and antigravity plus "+3", and 400 px → all five, no "+N". The aria-label keeps the whole order.
- Playwright `assertOrderStripWhole` (`HARNESS/settings-visual.e2e.spec.ts:158`), in the baseline smoke and the
  live-shape test, all 4 host × theme combinations: no chip past the strip, none clipped, chips + N = 5, and the Edit
  label ends with the fifth entry.

## 53.5 B38-5: the 800 px fold assertion without rounding jitter

**Cause.** `scrollWidth - clientWidth` is an integer. The three-track grid lays out at 752.00x px, and `scrollWidth`
sometimes rounds that up, giving the intermittent "1 px overflow" with nothing cut (Batch 38 answer 5).

**Fix** (`HARNESS/settings-visual.e2e.spec.ts:118-140`):
- It measures the widest laid-out descendant of the Providers page with fractional `getBoundingClientRect().right`.
  Subtrees inside an overflow-clipping or scrolling box are skipped: they cannot widen the page.
- That edge is compared with the smaller of the page box's inner right edge and the viewport width, with a 1 px
  tolerance. The reason is documented in the code: a real overflow is at least a whole pixel.

**Runs.**
- Baseline smoke `--repeat-each=10 --workers=2`: 39 passed and 1 failed. The failure was a worker crash, not an
  assertion: "worker process exited unexpectedly (code=3221226505)", Windows 0xC0000409, in the vscode/anubis run.
- That combination was re-run `--repeat-each=10`: **10/10 passed**.
- All 88 logged measurements read `overflow 0px`.

## 53.6 The baseline smoke split into region tests

**Trigger.** The team-leader's folder run timed out on "baseline smoke — both tabs (electron, anubis-light)" at 30 s,
waiting for `connection-detail-drawer`. In `--repeat-each=3`, 10 of 12 failed at about 30 s; in Batch 52 the test took
10-17 s. The machine was at 100 % CPU from other sessions.

**(1) What Batch 53 added.** I measured with a temporary timing copy of the old test (deleted after use; one run per
host × theme, `--workers=2`, under the same load). The phases each took:

| Phase | VS Code (dark / light) | Electron (dark / light) |
| --- | --- | --- |
| Boot | 2.6 / 2.7 s | 1.9 / 2.3 s |
| Tab captures | 0.6 s | 0.5-0.7 s |
| **53.4 order-strip check** | **0.17 / 0.23 s** | **0.12 / 0.13 s** |
| Orchestration fold | 0.4-0.6 s | 0.5-0.6 s |
| Roles open + role popover | 1.5-1.8 s | 1.7-1.8 s |
| Order popover | 0.9 s | 0.7-1.0 s |
| Matrix popovers | 4.8-6.4 s | 5.5-6.8 s |
| Back to Providers + fold | 0.8-1.1 s | 1.2 s |
| Routing map | 0.3-0.5 s | 0.5-0.7 s |
| Main Agent popover | 0.5-0.6 s | 0.6-0.7 s |
| Model list (includes the **53.3 width check**, one `evaluate`) | 0.3-0.6 s | 0.7-0.8 s |
| Model search capture, manual ID, Save to | 1.3-1.8 s | 1.8-2.7 s |
| Scope popover | 1.0-1.1 s | 1.1-1.6 s |
| Catalog | 0.7-1.1 s | 0.9-1.2 s |
| 7 drawers | 7.8-8.4 s | 11.4-12.0 s |
| **Whole test** | **25.2-29.7 s** | **31.2-34.5 s** |

Batch 53 added about 0.2-0.3 s per run: the order-strip check plus one `evaluate` for the list width. The jump from
10-17 s to 25-35 s is the machine load, which multiplied every phase. The test was fragile because it was one long
sequence against a 30 s limit; the 53 checks did not cause it.

**(2) Fix: one test per region, sharing setup** (`HARNESS/settings-visual.e2e.spec.ts`).
- A new helper, `openSettingsAt(page, url, host, theme, tab)`: boot, 1024×768, open the tab, wait for it to settle; on
  Orchestration it also waits for the matrix rows.
- Each host × theme combination now has eight tests, all named "baseline smoke — …":
  - tab captures
  - Orchestration order strip, fold, roles and order popover
  - Orchestration matrix popovers
  - Providers fold and routing map
  - Providers Main Agent popover, model search and Save to
  - Providers scope popover and catalog
  - connection drawers, Overview and Credentials (4)
  - connection drawers, Models & Tiers and Advanced (3)
- **Every assertion and capture call is moved verbatim**, generated by a script that slices the old body. Counts:
  `expect(` 139 → 143 and `await capture(` 18 → 19. The increase is only the helper's matrix wait and the drawer loop
  appearing in two tests; the helper calls are unchanged.
- The old "fold failure reported at the end" workaround is dropped: each fold check now fails its own test, and the
  other captures run in other tests.
- **State kept equal.** In the single run, the Models & Tiers / Advanced drawers came after sovereigneg's Overview
  drawer. Its closing returned focus to the card, which scrolled the Providers page by 62 px in Electron (measured with
  a temporary probe). The second drawer test focuses that card first, so the page behind those drawers, and so their
  captures, stay as they were (0 pixels over the threshold against HEAD).
- No blanket timeout increase.
- **One modest explicit timeout.** `bootSettings` (`settings.fixtures.ts`) gives `page.goto` 30 s instead of the 15 s
  navigation default. The reason is documented in the code: under 100 % CPU the app build's `load` was seen past 15 s
  in one region test (`TimeoutError: page.goto: Timeout 15000ms exceeded`, `vis-r3b`). Boot is setup, and every
  assertion keeps its own timeout.

**Durations after the split** (`settings-visual`, `--repeat-each=3 --workers=2`, 108 tests):

| Test | Average | Max |
| --- | --- | --- |
| tab captures | 2.4 s | 3.0 s |
| Orchestration order strip, fold, roles, order popover | 4.1 s | 5.5 s |
| Orchestration matrix popovers | 5.6 s | 7.6 s |
| Providers fold and routing map | 2.5 s | 3.7 s |
| Main Agent popover, model search, Save to | 3.6 s | 4.7 s |
| scope popover and catalog | 2.7 s | 3.7 s |
| drawers, Overview and Credentials | 5.2 s | 6.0 s |
| drawers, Models & Tiers and Advanced | 5.1 s | 6.5 s |
| live-shaped values (Batch 52) | 3.3 s | 3.8 s |

The largest is 7.6 s, about 25 % of the 30 s default. In a run during the heaviest load (`vis-r3b`) the maxima were
8.3-8.4 s, still under 30 %.

**Runs.**
- `settings-visual --repeat-each=3 --workers=2`:
  - `vis-r3`, before the goto change: **108/108 passed**.
  - `vis-r3b`: 107/108. The one failure was `page.goto` at 15 s during boot under the heaviest load.
  - `vis-r3c`, after the goto change: **108/108 passed**.
- Full settings folder, `--workers=2`: **122 passed, 2 skipped** (the existing `test.skip` "deep link main-model").

**(3) Margin across the folder.** The ten slowest tests of the final folder run, against their timeouts:

| Test | Duration | Timeout | Share |
| --- | --- | --- | --- |
| reachability (electron) | 138 s | 600 s (`test.setTimeout`) | 23 % |
| reachability (vscode) | 126 s | 600 s | 21 % |
| orchestration "Cursor key (36d.b)" (electron) | 8.2 s | 30 s | 27 % |
| orchestration "deep link judge" (electron) | 7.8 s | 30 s | 26 % |
| orchestration "repeated deep link judge" (electron) | 7.7 s | 30 s | 26 % |
| orchestration "tier-mapping modal focus" (electron) | 7.5 s | 30 s | 25 % |
| orchestration "Cursor key (36d.a)" (electron) | 6.8 s | 30 s | 23 % |
| orchestration "on/off" (electron) | 6.7 s | 30 s | 22 % |
| orchestration "role Set up" (electron) | 6.6 s | 30 s | 22 % |
| orchestration "Cursor key (36d.b)" (vscode) | 6.4 s | 30 s | 21 % |

In an earlier folder run under heavier load, `settings-advanced-search-voice` tests reached 9-11.7 s against their own
120-180 s timeouts (under 10 %). **Nothing in the folder is within 50 % of its timeout.**

**Captures.** The split regenerates the same images.
- The 44 accepted Batch 53 captures are back byte-identical from `%TEMP%\b53-accepted`. Three of them had only 2-pixel
  anti-aliasing noise in this run (`current-live-orchestration-vscode-anubis`,
  `current-orchestration-popover-model-vscode-{anubis,anubis-light}`).
- Every other rewritten capture has 0 pixels over the threshold against HEAD and was restored with
  `git restore -- <path>`.
- No new visible change; `git status` lists exactly the 44 accepted files. No `baseline-*` file changed.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview`:
  "Successfully ran targets typecheck, lint for 5 projects".
- `npx nx run-many -t test -p (same) -- --maxWorkers=2`: "Successfully ran target test for 4 projects". The harness has
  no test target.
- `npx nx build ptah-extension-webview`: exit 0, after the last app change.
- Gate G (`settings-reachability.e2e.spec.ts --reporter=list`): **9 passed**.
- Full settings folder (`--reporter=list --workers=2`): **94 passed, 2 skipped**. That includes the 2 new card-check
  scenes. The 2 skips are the existing `test.skip` "deep link main-model", one per host.
- Non-spec file sizes: `providers-settings.component.ts` 648, `agent-orchestration-config.component.ts` 366 (≤ 700).

## Captures (compared with HEAD, `b36b-diff` pattern)

**Kept (44), real 53 changes:**
- **Orchestration, 53.4** (the order strip now ends in whole chips and "+N"): every capture that shows the policy bar.
  - `current-orchestration-{vscode,electron}-*` (4)
  - `current-orchestration-popover-{model,effort,permission,copilot,cursor}-*` (20)
  - `current-orchestration-order-popover-*` (4), `current-orchestration-modal-{add,tiers}-*` (8)
  - `current-live-orchestration-*` (4)
- **Providers, 53.3:** `current-main-agent-model-search-*` (4). The list is now as wide as the field.

**Restored with `git restore -- <path>` (36):** no pixel over the threshold. These are the 49 sub-threshold rewrites the
Batch 38 run had left, plus this run's. No `baseline-*` file changed.

## Docs shots

The Electron app was rebuilt (`build-dev copy-renderer-dev -p ptah-electron`) and the docs shot re-run
(`docs-screenshots.config.ts workspace-settings.shot.ts`, throwaway profile copy): **3 passed**.
- **Kept the new `agents-orchestration.png`.** B38-4 is fixed live: "1. Codex → 2. Copilot → 3. Antigravity → +2" and
  nothing cut. The rest is unchanged.
- `settings-overview.png` came out byte-identical and stays unmodified.
- The four out-of-scope PNGs were restored by exact path.

# Batch 49 report: harness reachability and scenes for Advanced / Search & Voice (TASK_2026_555, track B)

Author: in-process frontend-developer (Advanced/Search owner). Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice`, on top of `3286a18ec`. No git writes,
no `batches.md` edit, no app or chat-lib source changed. The orchestrator's brief allowed this batch to build and run
Playwright in track B (single writer); team-leader-b's reminder that only it builds was superseded by that brief.

**Status: Gate G green (27/27 with `--repeat-each=3`). The new scene spec is red on purpose: it pins component defects
outside this batch's ownership (section 6). Those need an owner before Batch 50.**

## 1. Files

All under `libs/frontend/webview-e2e-harness/src/lib/scenarios/`.

| File | Change |
|---|---|
| `settings/settings-advanced.entries.ts` | CREATE (370 lines). 24 Gate G entries ADV-1..24 |
| `settings/settings-search-voice.entries.ts` | CREATE (300). 19 Gate G entries SV-1..19 |
| `settings/settings-advanced-search-voice.fixtures.ts` | CREATE (291). Stateful RPC fixtures for the two tabs, plus per-method failure injection (`AsvState.failures`) |
| `settings/settings-advanced-search-voice.reach.ts` | CREATE (~185). Shared helpers: tab remount, toast/Undo/D15 assertions, Esc-focus check, drawer close, second-page variant boot |
| `settings/settings-advanced-search-voice.e2e.spec.ts` | CREATE (325). Captures + fold, focus scene, D15 scene, for both hosts |
| `settings/settings-reachability.table.ts` | MODIFY. 2 import lines, 1 spread line, count 94 → **137** + one comment line. `BASELINE_PRESENT_IDS` untouched |
| `settings/settings-reachability.e2e.spec.ts` | MODIFY. Per-host timeout 180 s → 600 s (comment explains: base entries alone took 3.4 min under load) |
| `settings/settings.fixtures.ts` | MODIFY. 1 import + `bootSettings` installs `withAdvancedSearchVoice(state, statefulSettingsFixtures(state))` |
| `marketplace/marketplace.fixtures.ts` | MODIFY (+29). Additive `rpcError(message)`: a resolver may return it to answer with a transport failure (`success:false`). Needed for the effort D15 path, which only fails on `result.isSuccess() === false` |

`apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts` was **not** changed: no step breaks because of track B. See
section 8 for an older silent skip.

Merge note for track A: the table diff is 4 lines (imports after `ROUTING_MAP_ENTRIES`, one spread line, the count),
and `settings.fixtures.ts` is 2 lines in `bootSettings` + imports.

## 2. New entry ids (count 94 → 137, +43)

Advanced (map §4 rows A1-A37):

| Id | Capability |
|---|---|
| ADV-1 | Membership & data: Community badge, status, one primary (Create Account), Explore Builders |
| ADV-2 | Key not active: warning copy + Re-enter opens the key popover (second-page boot, `reason:'expired'`) |
| ADV-3 | Member: identity, plan text, Manage Membership primary, Log out inline confirm + Cancel (second-page boot) |
| ADV-4 | Membership key popover: masked field, local format check |
| ADV-5 | Export (real call) and Import behind its inline confirm (`settings:import` / `command:execute`, "Settings imported.") |
| ADV-6 | System prompt mode on/off + status badge; Saved toast; Undo is a second `enhancedPrompts:setEnabled` |
| ADV-7 | Drawer D-SP: generated-at, stack, markdown preview, Regenerate confirm (cancelled), Download call; focus returns |
| ADV-8 | No generated prompt: toggle locked with the Setup Wizard sentence; drawer empty state, Regenerate disabled |
| ADV-9 | Chat reasoning effort popover, 6 choices, `config:effort-set`, Undo |
| ADV-10 | Dynamic workflows, `agent:setConfig {workflowsDisabled}`, Undo |
| ADV-11 | Ultracode on pins X-High (cell disabled); off restores Medium |
| ADV-12 | Output style: activate (Saved + Undo), tier/"Drops default coding instructions" badges |
| ADV-13 | Missing active style banner + Clear the selection (`activate {name:null}`) |
| ADV-14 | New style opens D-OS; Cancel closes |
| ADV-15 | Edit opens D-OS filled in; Save style writes `outputStyle:save` |
| ADV-16 | Delete behind inline confirm (`outputStyle:delete`); built-ins disabled |
| ADV-17 | Unreadable files list + Rewrite it here (drawer in repair mode) |
| ADV-18 | Fallback-injection banner + Copy to this project |
| ADV-19 | CLI parity `<details>`: tick, choose a style, the confirm names the `.claude` path, Cancel writes nothing |
| ADV-20 | MCP port: validation, Save, restart note, Undo |
| ADV-21 | 5 namespace rows; toggle Git Worktree + Undo |
| ADV-22 | Allow localhost: enable asks first (checkbox stays off), Cancel; enable → write; disable saves at once |
| ADV-23 | VS Code LM badges (Default/Configured/capabilities), model change `llm:setDefaultModel` + Undo |
| ADV-24 | Set as Default when another provider is default (second-page boot: `LlmProviderStateService` caches its status) |

Search & Voice (map §4 rows V1-V29; voice and go vet are Electron-only, and in VS Code those entries assert the
sections are absent):

| Id | Capability |
|---|---|
| SV-1 | Several web search providers (Serper on, Saved + Undo); the "at least one" note |
| SV-2 | Key status badges and the three signup links |
| SV-3 | Set key popover: masked, show/hide, `webSearch:setApiKey`, key never rendered |
| SV-4 | Clear key: inline confirm, Cancel returns focus, `webSearch:deleteApiKey`, no Undo |
| SV-5 | Test connection → per-provider "Works" |
| SV-6 | Max results slider (save on release, Undo) |
| SV-7 | Voice + go vet render on Electron only |
| SV-8 | Voice matrix model/status cells (base.en Ready, Sarah Ready) |
| SV-9 | Unavailable provider disabled with "Unavailable: API key not configured" as text |
| SV-10 | STT provider choice (`voice:setProviderConfig`) + Undo |
| SV-11 | Local STT Whisper model (Saved + Undo), Downloaded status |
| SV-12 | Local STT HF/folder source with id validation, back to Curated |
| SV-13 | Local STT download when not downloaded (`voice:downloadModel`) |
| SV-14 | Local TTS (TTS switched to Local and back): Kokoro voice + Undo, Preview (`voice:synthesize`), custom source |
| SV-15 | ElevenLabs key: failed test shows the fixed category sentence (no host text), Save disabled; passing test enables Save; Clear asks first |
| SV-16 | ElevenLabs voice (Saved + Undo), TTS model and output format selects |
| SV-17 | ElevenLabs voice list: fixed failure sentence, Retry loads |
| SV-18 | go vet: root/binary readout; enable confirm names the root; Cancel returns focus; enable/disable writes |
| SV-19 | go vet stale consent reason in the card ("Out of date") |

Not given a separate entry (covered by unit specs or in-scope rows above, stated for the review): the output-style
collision banner (needs a cross-tier name clash), go vet error mapping, the membership key server verify (only the
local format check is driven).

## 3. Scenes (`settings-advanced-search-voice.e2e.spec.ts`)

| Test (per host) | What it does |
|---|---|
| `captures and fold (host, theme)` ×4 | The 12 capture names below, fold §2.2 asserted, fold §3.2 measured (section 4) |
| `drawers, popovers and inline confirms close on Esc and return focus` ×2 | 15 overlays (12 in VS Code); every one is measured, failures collected and reported together |
| `D15: failed writes show no "Saved", revert, and show the fixed sentence` ×2 | effort (transport failure via `rpcError`), output style (`{success:false}`), output-style parity cancel, web search (`{success:false}`), and on Electron STT (`{ok:false}`) and TTS (`{ok:false}`). Each asserts an alert-role toast with exactly the fixed sentence, no "Saved", "host detail" absent from the page, and the control reverted |

## 4. Fold table (1024×768, fold line 660 px; px from viewport top; nothing scrolled in any run)

| Host / theme | Advanced: tabs / Membership bottom (height) / Agent behaviour bottom | Advanced rows | Search & Voice: web search bottom / provider rows / voice rows bottom |
|---|---|---|---|
| vscode / anubis | 83 / 163 (80) / **436** | 43,41,41,58 | 383 / 41,41,41 / n/a |
| vscode / anubis-light | 83 / 163 (80) / **436** | 43,41,41,58 | 427 / **63**,41,**63** / n/a |
| electron / anubis | 123 / 227 (104) / **532** | 43,41,57,74 | 499 / **63,57,63** / **686** |
| electron / anubis-light | 123 / 227 (104) / **532** | 43,41,57,74 | 499 / **63,57,63** / **686** |

- **Map §2.2 (Advanced): PASS in all four** and enforced (Membership ≤ 140 px, Agent behaviour card ≤ 660).
- **Map §3.2 (Search & Voice): FAIL**: provider rows exceed 48 px (the "Update key" + "Clear" actions wrap to two
  lines: in light theme in both hosts, and in Electron's narrower page in both themes), and on Electron the voice rows
  end at 686 px. Following the execution default 3 ratchet, this budget is **measured, logged and attached as a
  `fold-pending` annotation, not enforced** (`SEARCH_VOICE_FOLD_ENFORCED = false`). Batch 50's density fix flips it to
  `true` in the same change.

## 5. Gate G and verification

| Check | Result |
|---|---|
| `npx nx build ptah-extension-webview` | success; initial total **3.33 MB** (error budget 3.5 MB; the 2.5 MB warning is pre-existing) |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` | "Successfully ran targets typecheck, lint for 5 projects". Harness eslint: 0 errors; `max-lines` warnings still **1** (the table, 716 → 719 counted lines); the other 41 warnings are in untouched chat/marketplace specs |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | "Successfully ran target test for 4 projects" (the harness has no `test` target; core and ui came from the Nx cache, their sources are unchanged) |
| Gate G, `--repeat-each=3 --workers=2` | **27 passed (7.0 m)**. Per host: vscode 2.1 / 2.1 / 1.8 min, electron 2.4 / 2.4 / 1.9 min |
| Scenes, `--repeat-each=3 --workers=2` | captures+fold **12/12 pass**; focus **0/6** (same 3 confirms every run); D15 **0/6** (output-style rows only, section 6). Effort, web search, STT and TTS D15 checks pass in every run |

Gate G runs leading up to the green one (diagnosed before each re-run, logs in `%TEMP%\b49-gateG-{1..4}.log`):

1. Run 1: VS Code hit the old 420 s test timeout (7.0 m under load from the concurrent track A Gate G); Electron failed
   ADV-19 (radio, section 6), ADV-24 (status cache), SV-17 (panel outlives the drawer). The kept-selectors test hit a
   `page.goto` 15 s timeout (load). Fixes: ADV-24 moved to a second-page boot; SV-17 remounts the tab and queues the
   failure after the matrix's own voice-name read; ADV-19 remounts after the cancel and its radio check moved to the
   D15 scene.
2. Run 2: both hosts failed at ADV-2: `csp-stub` `route.fetch` timed out at the 10 s action timeout while the second
   page reloaded the 3.3 MB bundle. Fix: the variant page uses a 30 s default timeout. The timeout was raised to 600 s
   (JSON step timings showed base entries alone at 2.3-3.4 min).
3. Run 3: VS Code green (4.1 m). Electron: the System prompt drawer stayed open after ADV-7 (Esc after Download did
   not reach it), so every later entry waited 10 s. Fix: reach entries close drawers through their footer buttons in
   `finally` (`closeDrawers`). Esc stays pinned by the focus scene.
4. Run 4: VS Code green. Electron: SV-15 left D-VOICE open. Reproduced in a temporary debug spec (deleted): the
   "Saved ElevenLabs API key." toast rendered after `dismissToast` had already returned and **intercepted the click on
   the drawer's Close** (`settings-toast ... intercepts pointer events`). Fix: `dismissToast(page, expected)` waits for
   the expected toast before dismissing. Then 4/4 debug repeats were clean, and the repeat-3 Gate G was green.

## 6. Findings for the owners / Gate V 50 (component code, outside this batch)

1. **D15: Output style radio does not revert after a failed activate** (`output-style/output-style-list.component.ts`).
   The store restores `active`, but when the RPC answers before a change-detection pass, the `[checked]` binding never
   changes, so the clicked radio stays checked on screen. The fixed sentence and the alert toast are correct; only the
   control is wrong. Intermittent: 4 of 6 runs.
2. **A cancelled parity confirm leaves the clicked radio checked** while the saved style is unchanged (same component,
   same cause). Deterministic: 6 of 6 runs. Suggested fix for both: after the save settles or the confirm is cancelled,
   write the saved state back to the radio elements, the same way the other batches handle checkboxes.
3. **Esc does not close three inline confirms**, in both hosts, every run: Import (`advanced-settings.component.ts`
   `import-confirm`), output-style Delete (`output-style-delete-confirm`) and Allow localhost
   (`mcp-port-config.component.ts` `allow-localhost-confirm`). The web-search, ElevenLabs and go vet confirms (they have
   `(keydown.escape)`), all three drawers, and the four popovers pass. Not measured: Log out confirm (needs a member
   boot), Regenerate confirm (inside D-SP, where Esc closes the drawer) and the parity confirm.
4. **The settings toast covers the drawer footer Close.** The toast is `fixed bottom-6 right-6 z-50`, and every drawer
   footer action sits in the same corner. For up to 8 s after a save inside a drawer, Close cannot be clicked (seen in
   Gate G run 4). This is a usability defect for Gate V 50.
5. **Map §3.2 fold fails** (section 4): provider rows 57-63 px; Electron voice rows end at 686 px.

## 7. Capture paths

All in `D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice\.ptah\specs\TASK_2026_555\screenshots\angular\`,
`current-{name}-{host}-{theme}-1024x768.png`. Untracked; they overwrote the orchestrator's round-1 files of the same names.
No other `current-*` or any `baseline-*` was touched (the smoke spec was not run).

- Both hosts × both themes (28): `advanced`, `advanced-system-prompt-drawer`, `advanced-output-style`,
  `advanced-output-style-drawer`, `advanced-mcp`, `advanced-mcp-localhost-confirm`, `advanced-vscode-lm`, `search-voice`.
- Electron only × both themes (8): `voice-drawer-local`, `voice-drawer-local-tts`, `voice-drawer-elevenlabs`, `go-vet`.

Fixture difference from round 1: `llm:getProviderStatus` now lists capabilities (`streaming`, `tool-use`) and a
second VS Code LM model, so `advanced-vscode-lm` shows capability badges (A35). The Local TTS drawer capture switches
TTS to Local in the same session (a real write), not through a second boot.

## 8. Deviations and notes

1. **Scenes in a new spec, not `settings-visual.e2e.spec.ts`.** This keeps the two smoke runs from overwriting each
   other's captures and keeps track A's file untouched.
2. **Two shared harness files changed beyond the batch list**: `marketplace.fixtures.ts` (`rpcError`, additive) and
   `settings.fixtures.ts` (2 lines). Without `rpcError`, the effort failure cannot be driven.
3. **Search & Voice fold not enforced** (ratchet; section 4).
4. **The scene spec is red** by design, pinning section 6 items 1-3. Gate G is green.
5. **Showcase tour:** `settings-tour.scene.ts` step 7 looks for `[data-testid="settings-toggle-web-search-provider"]`
   with no `-<id>` suffix. It already failed to match at the track base `41b85393c`, and its `isVisible()` guard skips
   the step silently. This was not introduced by track B, so the file was not changed; it belongs with Task 37.1.
6. Persisted-settings writes: none changed (harness only).

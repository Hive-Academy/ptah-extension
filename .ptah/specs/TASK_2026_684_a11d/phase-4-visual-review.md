# Phase 4 visual review - decision model row editor (TASK_2026_684_a11d)

## Setup notes

- After: worktree `ollama-cloud-decision-model` (HEAD 460293200). Built with `nx run ptah-electron:build-dev` then `copy-renderer-dev` (NX_NO_CLOUD, parallel=1), launched `electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9335` (NODE_ENV=development, profile "Ptah Dev"). Driven with Playwright `connectOverCDP` (scripts in `.ptah/tmp/p4-*.mjs`).
- Before: temporary detached worktree at 641743bd1 (node_modules junction), same build and launch on 9335, one instance at a time. Worktree and junction removed afterwards.
- Themes: `document.documentElement.dataset.theme` = `anubis` (dark) / `anubis-light` (light); the stored theme was not changed. Widths: viewport emulation at 1531 (the default window in the after run; the base run's window opened at 795 wide, so both were forced to the same widths) and 900, height 983.
- Surface: Settings > Agent Orchestration > Background model roles (expand) > Decision model.
- Fake key `test-key-not-real` was only typed into the password field and cleared; nothing was saved with it. The script's switch back to Unset auto-saves (Unset saves at once), which wrote `decisionModel: {kind: unset}` to ~/.ptah/settings.json; the file was restored byte-identical to the original (no decisionModel key). skillSynthesis.enabled stays false.
- Not captured: Ollama Cloud "key present" vs "no key" differ only through host state (no live key); the notice is one static sentence for both. The stored-key Remove control IS shown (see finding 4) but a real stored-key state was not reachable. Jev with stored key not reachable. Loading state not captured.
- Pre-existing, same in before: top nav clipped and page-level horizontal scrollbar at 900 wide.

## Screenshots (all under `.ptah/specs/TASK_2026_684_a11d/visual/`, absolute prefix `D:/projects/ptah-extension/.claude-worktrees/ollama-cloud-decision-model/.ptah/specs/TASK_2026_684_a11d/visual/`)

Each stem exists for `dark-1531`, `light-1531`, `dark-900`, `light-900` (`<stem>-<theme>-<width>.png`).

| Stem | Shows |
|---|---|
| before-01-row-closed | Row as it was (closed) |
| before-02-editor | Old editor, kind picker (Unset, Ollama, Jev, Structured only) |
| before-03-jev / before-03-ollama / before-03-structured | Old Jev, Ollama, Structured editors |
| after-01-row-closed | Row now (closed) |
| after-02-picker-unset | Editor with kind picker, Unset |
| after-03-ollama-cloud | Ollama Cloud: help text, Set up Ollama Cloud, model field |
| after-04a-custom-empty | Custom endpoint, empty (Save disabled) |
| after-04b-custom-needs-https | http non-loopback URL + typed key: needs-https error |
| after-04c-custom-invalid-url | Invalid URL error |
| after-04d-custom-valid | Valid https URL, Save enabled |
| after-05-focus-decision-kind / -base-url / -model / -api-key / -save | Tab focus rings |
| after-06-jev | Jev with key field and Remove stored key |

Log with measured geometry, contrast and focus stops: `visual/_after-log.txt`.

## Measurements

- Contrast (canvas-normalised colours): error text 5.62 dark / 6.94 light; help text 5.07 dark / 6.04 light; disabled Save label 5.65 dark / 5.39 light. All meet 4.5:1.
- Focus: kind, URL, model, key, Remove, Save all show a 2px outline (light: dark ring; dark: light ring). Tab order is logical. No stop without a ring.
- Error association: URL input has `aria-invalid=true`, `aria-describedby="decision-model-base-url-help decision-model-base-url-error"`, error `<p role="alert">`. Good.
- Secrets: the key input is `type=password`, the typed fake key never appears in DOM text; error text is a fixed sentence (no raw host or secret text).
- Targets: close 24x24, Remove stored key 110x24, Save 139x32, selects 32 high (all at or above 24x24).
- Layout: no horizontal overflow added at 900 or 1531. Jev and Ollama Cloud editors fit; Custom editors are 504 px (546 px with an error).

## Findings

1. SERIOUS - Custom endpoint editor is taller than the room around the row and has no max-height or internal scroll. With the row centered in a 983 px tall window the popover opens above the row and its top is 26 px (no error) to 66-73 px (with error) above the viewport, so the "Decision model" heading, close button and kind picker are off-screen until the page is scrolled (verified: scrolling 150 px reveals it; Esc closes). Worse at shorter windows. Shots: after-04a-custom-empty-dark-1531, after-04b-custom-needs-https-dark-1531, after-04a-custom-empty-light-900. Likely: `decision-model-row.component.ts:129-136` (`ptah-native-popover` host) and `:173` editor container (needs `max-h` plus `overflow-y-auto`, or bottom placement with scroll-into-view on open).
2. MODERATE - Layout shift when the URL error appears: the popover is bottom-anchored, so the editor grows upward by 40 px and the Base URL input being typed in jumps up 40 px (y 78 to 38 at 1531). Model, key and Save stay put. Reserving the error row or making errors not change the editor height avoids it. Shots: after-04a vs after-04b-custom-needs-https-dark-1531. Likely `decision-model-row.component.ts:~280-300` (conditional `@if (fieldError('baseUrl'))` block).
3. MODERATE - Inline validation messages are prefixed with the save-failure sentence ("Could not save the decision model. An API key needs an https base URL unless the endpoint is on this machine."), shown while typing before any save is attempted. Reads as a failed save. Message source is the shared validation text (`libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, returned by `endpointFieldError` in `decision-model-row.view.ts:371`). Shots: after-04b/04c-custom-*.
4. MODERATE - "Remove stored key" is shown for Jev and Custom on a fresh profile where no key is stored (and for an unsaved typed key), because `keyMayBeStored` defaults to true when the host does not say (`decision-model-row.component.ts:528-532`). A destructive action for a key that may not exist. Shots: after-06-jev-dark-1531, after-04d-custom-valid-light-1531.
5. MINOR - Tab from the last editor control (Remove stored key) leaves the popover and lands on page controls behind it (subagent cache TTL, then budget toggle) although the trigger declares `aria-haspopup="dialog"` and Esc closes. Likely the shared `NativePopoverComponent`, `decision-model-row.component.ts:148`. Evidence: focus stops in `_after-log.txt`.
6. MINOR - The Ollama Cloud and custom model input have no placeholder, so the empty field in `after-03-ollama-cloud-*` reads as a blank bar; help text below carries the meaning. `decision-model-row.component.ts` model input (placeholder only set for Jev).

No visual-breaking defects. Compared to before: Jev layout improved (Save no longer wraps beside Remove), new kinds match the existing editor styling in both themes, contrast and focus meet AA.

Verdict: REVISE

## Addendum - console RPC timeout check (agent:getConfig)

- After build (460293200), relaunched on 9335 with a temporary `--user-data-dir` (not the Ptah Dev profile, because peer session 683 runs on it), page reloaded with a console listener, Settings > Agent Orchestration opened, observed 30 s: no "[ClaudeRpcService] RPC timeout" and no error-level console message; the decision row went straight to its loaded state (no Loading... frame seen, under ~250 ms). Caveat: a fresh empty profile, so it does not reproduce the user's data-heavy Ptah Dev profile and says nothing about whether the timeout occurs there.
- Base build (641743bd1): not measured. Console was not recorded during the earlier runs and the base worktree was already removed (instructed). Indirect evidence only: in the earlier base capture on the Ptah Dev profile, `before-03-jev-dark-1531.png` shows the decision row as "not reachable / Status not reachable" and a "Loading delegated CLI models..." line a few seconds after opening Settings. The after capture of the same profile (`after-06-jev-dark-1531.png`) showed "unset / Unset - code ranking". The timeout is therefore plausibly profile- or host-timing related rather than caused by Batch 17, but this was not proven.
- Before-capture window note: the Ptah Dev profile run was the one I used earlier for both builds; ~/.ptah/settings.json was restored to its original content.

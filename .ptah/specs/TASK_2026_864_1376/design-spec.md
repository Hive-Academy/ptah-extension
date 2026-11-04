# Design spec - Provider-aware readiness (TASK_2026_864_1376)

Design system applied: the existing Ptah renderer system (`apps/ptah-extension-webview/tailwind.config.js`,
`src/styles.css`), themes `ptah-glass` (dark) and `ptah-glass-light` (light), `data-glass-surface`
roles (`chrome`, `content`, `tile`), daisyUI pill buttons, the `state-run|need|err|done` ink tokens
and `base-content-muted`. No new token, component family or colour is introduced. Every surface below
is an elevation of a component that exists in `libs/frontend/onboarding/src/lib/ready/`.

Prototype: `prototype/` (open `prototype/index.html`; add `?theme=light` and `?bare=1`).

## 1. Scope map

| Surface | Today | Change |
| --- | --- | --- |
| Home banner | `ptah-claude-readiness-banner`, Claude-only copy | Names the chosen connection; same box, same one action (AC 4.3) |
| Strip (Home, stage 1, stage 2) | Item 1 "Claude Code" | Item 1 follows the chosen connection or "Connection" (AC 4.4); new word "Taking longer" |
| Stage 1 `/onboarding/ready` | One Claude Code panel | Connection choice control + two panels (Claude Code, Codex) with the same facts |
| Stage 2 settings step | Banner "Fix Claude Code", lead "besides Claude Code" | Banner follows the chosen connection; lead names the chosen connection |
| Home footer link | "Review Claude Code and settings" | "Review your connection and settings" |

Parity: every keep and move row of `parity-inventory.md` is present (section 12 maps them).

## 2. Visual direction (decision, not a menu)

Quiet, factual, symmetrical. Both providers get the same panel, the same four facts and the same chip
words. Hierarchy comes from the main connection, not from colour: the chosen provider has a primary
border and a "Main connection" tag; the other has a base-100 fill, a hairline border and a muted tag.
Warning colour (`state-need` / `state-err`) is spent only on the chosen provider.

## 3. Tokens used (source: tailwind.config.js themes, styles.css)

| Role | Dark `ptah-glass` | Light `ptah-glass-light` | Tailwind class in the app |
| --- | --- | --- | --- |
| Page | base-100 `#17191d` | `#f7f3fd` | `bg-base-100` |
| Panel fill (main) | base-200 `#202329` | `#eee8f8` | `bg-base-200` + `data-glass-surface="content"` |
| Panel fill (information only) | base-100 | base-100 | `bg-base-100` + `data-glass-surface="content"` |
| Hairline | base-300 `#2a2e35` | `#e2daf1` | `border-base-300` |
| Text | base-content `#f2f2f1` | `#1e1936` | `text-base-content` |
| Secondary text | `--bcm` oklch(90.05% .0071 268.54) | oklch(46.559% .0614 293.53) | `text-base-content-muted` |
| Primary (border, radio, button) | `#e4b94a` / content `#1b1403` | `#7c5700` / `#fff8e6` | `border-primary`, `btn-primary` |
| Run ink | `#93bdff` | `#2449b0` | `text-state-run` |
| Need ink | `#ffb066` | `#8f5200` | `text-state-need` |
| Error ink | `#ff9696` | `#a31f26` | `text-state-err` |
| Done ink | `#5fe0a0` | `#0f6434` | `text-state-done` |
| Radii | panel 22px, card/banner 14px, notice 12px, chip/pill 9999px, copy row 8px | same | `rounded-[22px]`, `rounded-[14px]`, `rounded-xl`, `rounded-full`, `rounded-lg` |
| Motion | `animate-spin` (existing 1.4 s pulse), skeleton `animate-pulse` | same | disabled under `prefers-reduced-motion` |

Reduced transparency: prototype renders the opaque mapping (`--glass-fill-tile` = base-200,
`--glass-fill` = base-100), which is the worst case for contrast. Glass-on only lightens fills behind
text that already passes here.

Banner tint (finding 4, existing defect confirmed): `state-need` is `var(--state-ink-need, oklch(var(--wa)))`
in `tailwind.config.js:33` with no `<alpha-value>`, so Tailwind cannot apply `/70` or `/10`. The built
stylesheets (`dist/apps/ptah-electron/renderer/styles.css`, `dist/apps/ptah-extension-webview/browser/styles.css`)
contain `.border-state-need` and `.bg-state-need` only, no `/70` or `/10` rule: the current banner draws no
tint and no custom edge. The same defect exists wherever `state-*` takes an opacity suffix (for example
`item-status-card.component.ts` `border-state-run/55`, `project-guidance.page.ts` `border-state-err/70`), which
this task does not touch. Contract for the banner in this task: explicit `color-mix`, theme-aware because it
reads `--state-ink-need`: border `border-[color-mix(in_srgb,var(--state-ink-need)_70%,transparent)]`, fill
`bg-[color-mix(in_srgb,var(--state-ink-need)_10%,oklch(var(--b1)))]` (or an equivalent small CSS class in
`styles.css`). The prototype uses the same expression. Measured (section 4): banner edge against the page
5.38:1 dark / 3.14:1 light (non-text 3:1 met), text on banner fill 12.95 / 13.37.

## 4. Contrast (criterion: WCAG 2.2 AA, 4.5:1 text, 3:1 non-text; the project's onboarding-ready sweep applies the same)

Measured with a script (OKLCH to sRGB, WCAG relative luminance). Dark | light.

| Pair | Dark | Light |
| --- | --- | --- |
| text on base-200 / base-100 | 14.05 / 15.71 | 14.05 / 15.39 |
| muted on base-200 / base-100 / base-300 | 11.70 / 13.07 / 10.13 | 5.93 / 6.49 / 5.25 |
| run ink on base-200 / base-100 | 8.22 / 9.19 | 6.60 / 7.23 |
| need ink on base-200 / base-100 | 8.74 / 9.77 | 5.20 / 5.69 |
| error ink on base-200 / base-100 | 7.54 / 8.43 | 6.30 / 6.90 |
| done ink on base-200 / base-100 | 9.49 / 10.61 | 6.06 / 6.63 |
| text on banner fill (need 10% over base-100) | 12.95 | 13.37 |
| text on selected card (primary 10% over base-100) | 12.98 | 13.36 |
| muted on selected card | 10.80 | 5.64 |
| primary button label on primary | 9.88 | 6.16 |
| primary border vs base-100 / base-200 (non-text) | 9.50 / 8.50 | 5.96 / 5.44 |
| radio ring and outline-button edge (base-content 60% over base-200, non-text) | 5.95 | 4.20 |
| strip badge glyph (base-100 on need ink) | 9.77 | 5.69 |
| banner edge (need ink 70% over page base-100, non-text) | 5.38 | 3.14 |
| chosen sign-in failure edge (error ink 70% over base-100, non-text) | 4.74 | 3.87 |

All pass. Rule that follows: outline buttons and radio rings use `base-content` at 60%, not 45%
(45% measured 2.74:1 in light and fails 3:1). Information-only chips use `text-base-content-muted`
(not a fainter tone), so the "quiet" look never costs contrast. Disabled controls are exempt
(`aria-disabled`, 60% opacity).

## 5. Stage 1 layout (`/onboarding/ready`)

Order, top to bottom (DOM order = visual order = focus order):

1. Strip (current step 1). `mb-5`.
2. Title row: tile (`size-11`, `data-glass-surface="tile"`, Lucide `PlugZap`) + `h1`
   "Check Claude Code and Codex" (`text-[1.7rem] font-semibold`, `tabindex=-1`, route-entry focus kept).
3. Lead (`mt-2 max-w-[62ch] text-base-content-muted`): "Ptah works with Claude Code or Codex. Pick the one
   you use as your main connection, and make sure it is installed and signed in. If you skip this, you can
   fix it later."
4. Connection choice (section 6). `mt-5`.
5. Two provider panels in `grid grid-cols-2 gap-4 items-start`, one column below 720 px.
   DOM order Claude Code then Codex always (no reordering when the choice changes: nothing jumps).
6. Continue note (when not ready), footer row (Re-check / Continue anyway or Continue).

### 5.1 Provider panel (same for both providers)

`rounded-[22px] border p-5 (max-[480px]:p-4)`; `data-testid` and `data-state` kept; `aria-busy` while
checking, taking-longer or rechecking.

| Part | Spec |
| --- | --- |
| Header | `h2` `text-lg font-semibold` + tag; subline `text-sm text-base-content-muted`; chip right (wraps below at narrow widths) |
| Tag, main | `rounded-full border border-primary px-2 text-xs font-semibold` with Lucide `CircleCheck`, text "Main connection" |
| Tag, other | `border-base-300 text-base-content-muted text-xs`, text "Not your main connection", no icon |
| Chip | existing: `rounded-full border border-base-300 px-2.5 py-0.5 text-xs font-medium`, `data-glass-surface="tile"` |
| Facts `dl` | existing: `grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm`; one column at 480 px. Rows Installed, Version, Signed in. Use `[overflow-wrap:anywhere]` (not `break-all`) so words do not split mid-word |
| Help block | `mt-5 border-t border-base-300 pt-4`; `h3` `font-semibold`; body `text-sm text-base-content-muted` |

Main panel: `border-primary bg-base-200`. Information-only panel: `border-base-300 bg-base-100` (flatter on
purpose). Neutral panel (nothing chosen: loading, unreadable, not confirmed): same as information-only,
no tag.

### 5.2 Chip table

| State | Word | Icon (Lucide) | Ink (main panel) | Information-only panel |
| --- | --- | --- | --- | --- |
| checking | Checking | `Loader` spinning | state-run | same |
| slow (AC 5.1) | Taking longer | `Clock` spinning | state-run | same |
| ready | Ready | `CircleCheck` | state-done | same (a positive fact keeps its tone) |
| missing | Not installed | `Download` | state-need | `CircleMinus`, muted ink, dashed border |
| signed out | Not signed in | `LogIn` | state-need | `CircleMinus`, muted ink, dashed border |
| stale (Codex) | Sign in again | `LogIn` | state-need | `CircleMinus`, muted ink, dashed border |
| could not check | Could not check | `CircleAlert` | state-err | `Info`, muted ink, dashed border |

Information only (decision 4, AC 4.5): never `state-need`, never `state-err`, never an alert or warning
icon, never a banner, never a strip "need" marker, help closed by default.

### 5.3 Facts text (per provider, same four facts)

| State | Installed | Version | Signed in |
| --- | --- | --- | --- |
| checking, taking longer | skeleton + sr-only "Checking" | skeleton | skeleton |
| ready (Claude Code) | mono path | mono version | "Yes. Your Claude account is connected." |
| ready (Codex) | mono path | mono version | "Yes. Codex is signed in." |
| bundled Codex (AC 1.2) | mono "Ptah bundled copy: <path>" then "Yes. Ptah's bundled copy is used." | version | as signed in / out; no install help ever. The path is the one the runtime selected (section 5.5 rule 1b), so it is the path the sign-in runs |
| missing | "No `claude` / `codex` command was found." | "Not available" | "Install <name> first." |
| signed out | path | version | "No. Sign in to use <name>." |
| stale (Codex) | path | version | "Your Codex sign-in has expired. Sign in again." |
| sign-in unreadable (Codex, AC 1.9, 1.11) | path (installed stays true) | version | "Ptah could not read the Codex sign-in data." |
| could not check, binary unknown, timeout | "Unknown" | "Not available" | "<name> did not answer in time. Your sign-in could not be read." |
| could not check, binary unknown, local | "Unknown" | "Not available" | "Ptah could not ask this computer about <name>." |
| sign-in check only failed (timeout or local), binary resolved (finding 3) | path (known) | version (known) | "<name> did not answer the sign-in check in time. Your sign-in could not be read." / "Ptah could not read your <name> sign-in." |
| Codex home folder unreadable or empty (AC 1.9) | path (known) | version (known) | "Ptah could not read the Codex home folder, so no sign-in was found. This is not the same as being signed out." |

Installed and signed in are two independent facts for both providers (AC 1.1, 1.3). "Unknown" and
"Not available" appear only when binary detection itself is unknown. A resolved path and version stay
visible on every auth-only failure, for the chosen and the information-only panel alike. This also fixes
the present Claude Code view, which masks a resolved CLI row when only the ambient sign-in read fails
(`claude-readiness.store.ts:37-48,78-86` keeps the row; the view must show it). The chip still says
"Could not check" (it describes the sign-in fact); the help title names the failed fact ("Ptah could not
read your Codex sign-in", "Ptah could not read the Codex home folder"). Prototype: `stage1-states.html`, last section.

### 5.4 Help blocks

| State | Claude Code | Codex |
| --- | --- | --- |
| missing | Existing install block unchanged: tablist macOS / Linux, Windows, npm; copy rows; PATH hint; docs link | Same pattern. Tablist "Install method for Codex": npm, Homebrew; rows `npm install -g @openai/codex`, `brew install --cask codex`; same PATH hint; "Open the official Codex install guide" (https, system browser). Command and URL values are placeholders: AC 2.5 puts them in one shared source checked against the official docs at implementation |
| signed out | Existing: `claude` copy row, plan note, named-account link | "Sign in to Codex" block (section 5.5): primary "Sign in with Codex" (in-app `auth:codexLogin`, Lucide `LogIn`, hint "Opens your browser. Ptah never sees your password."), then "Or in a terminal" copy row. Installed Codex selected: `codex login`. Bundled-only: the copy row holds the full resolved path, quoted, then ` login` (for example `"/opt/Ptah/resources/codex/codex" login`), labelled "Or in a terminal, with Ptah's bundled copy", with the note "Codex is not installed on this computer, so a plain `codex login` would not work. The button and this command both use Ptah's bundled copy." Never a bare `codex login` row when no installed Codex was selected |
| stale | n/a (reads as signed out) | Title "Sign in to Codex again", same block |
| sign-in running, success, failure, cancelled, timed out (AC 2.3) | n/a | Section 5.5. Re-check stays available. Chosen panel: warning treatment only for failure and timeout. Information-only panel: information styling and a polite status, never an alert (finding 2) |
| could not check | Existing error block + `claude doctor` hint + collapsible manual help | Same shape; timeout hint `codex --version`; unreadable cause title "Ptah could not read the Codex sign-in data" with "Check that your Codex home folder is readable, or run `codex login` again." Always "This is not the same as being signed out." |
| taking longer | Single line, no actions: "This is taking longer than usual. Ptah is checking <name> again on its own. You do not need to do anything." | same |
| ready | no help (AC 2.4) | no help |

Copy rows reuse `ptah-command-copy-row` untouched (copy, "Copied" 2 s, inline fallback, sr announce).

Information-only panel: the same help blocks live inside `<details>` closed by default, summary
"Set up <name> as well (optional)" (missing), "Sign in to <name> as well (optional)" (signed out, stale),
"More about this" (could not check). The chosen panel shows help expanded, never in a disclosure.

### 5.5 Codex sign-in block (real in-app sign-in, Electron; decision 7)

Behaviour read from code (the Codex CLI itself was not run): `auth:codexLogin` runs `codex login --device-auth`
(`interactive-login-methods.ts`). Where the host has an auth command runner (`auth-command-runner.ts`,
today only `CliPlatformCommands`) the command is spawned, every output line is pushed as `auth:loginOutput`,
a code like `ABCD-12345` and a URL are parsed into `auth:deviceCode { userCode?, verificationUri?, expiresInSeconds? }`,
the call resolves on process exit with the real code, and the runner kills the process after 10 minutes. Where it
has no runner the handler calls `openTerminal` and reports success. Electron has no runner and `openTerminal`
only logs a warning (`electron-platform-commands.ts`), so today the button would report success without starting
anything. Host contract this design needs (implementation is the architect's):

1. Electron gets the runner capability: it spawns the login in the main process using the executable path the readiness check and runtime already selected (rule 1b), never a bare `codex` looked up on PATH; forwards `auth:loginOutput`
   and `auth:deviceCode`, opens the first `https://` sign-in URL in the system browser (`shell.openExternal`, https only),
   and resolves with exactly one outcome: `success`, `failed` (with a reason string and exit code), `cancelled`,
   `timed-out`. The UI never shows "Waiting" or success before the process is actually running or has exited 0.
1b. Executable (Revision 2, finding 1). The runner takes its path from the same `selectCodexExecutable` result that readiness
   and the runtime use (`select-codex-executable.ts:67-118`): the supported installed `codex` when one probes fine
   (`selected.source === 'installed'`), otherwise the bundled copy (`source === 'bundled'`, which is what the panel shows as
   "Ptah bundled copy"). The existing semantics stay: installed is preferred, an installed Codex below the minimum version or not
   startable falls through to bundled, and `bundledFallback` stays the fallback for runtime use. If the selected path itself fails
   to start at login time, the runner does not silently retry another binary; it reports `failed` ("Ptah could not start Codex at <path>.")
   and the UI offers Try again. If no supported Codex is selectable (`CodexExecutableUnavailableError`), the button is not shown:
   the panel is in the install state. The manual terminal row mirrors this: bare `codex login` only when the selected source is
   `installed`; the quoted full bundled path otherwise. Whether the bundled binary is runnable from a terminal on every OS
   (execute permission, path quoting on Windows) is verified at implementation; if it cannot be, the row is replaced by the sentence
   "Terminal sign-in needs Codex installed on this computer. Use the button above." (no command).
2. A cancel action exists (not in the codebase today; the name is the architect's, the existing `auth:codexLogin` route stays).
   It kills the process and the pending call returns `cancelled`. Cancel is not a failure and not a timeout.
3. After `success` the host refreshes readiness (the handler already clears the Codex cache and resets the SDK) and
   the UI re-checks automatically; the user does not press Re-check.
4. Other hosts keep their path: VS Code opens its terminal. The block then shows only the terminal hand-off state
   (state 12): "Codex sign-in opened in a terminal. Finish signing in there, then press Re-check." It never shows
   Waiting, success or failure, because the outcome is not observable there. The CLI/TUI runner is unchanged.
5. Whether to run `--device-auth` or plain `codex login` (which opens the browser itself through a local callback)
   is the architect's call; the UI handles both: the URL, the code, and the "Open sign-in page" and "Copy link" controls are each
   shown only when the host saw them.
6. No claim without evidence (Revision 2, finding 2). The host cannot observe a browser that the CLI opens by itself. Copy may say a
   browser or page is open only after one of: a URL was parsed from output, a device code was parsed, or `shell.openExternal` returned
   an explicit result (success: "Ptah opened the sign-in page in your browser."; failure: "Ptah could not open your browser. Use Open
   sign-in page or copy the link."). Before that the block shows neutral progress copy (state 4). If nothing is observed within a bounded
   time (20 seconds, the architect may tune it) the block moves to state 4b. The CLI supports a device flow: the existing code runs
   `codex login --device-auth` (`interactive-login-methods.ts`, `cli-platform-commands.ts:55,61` parse its code and URL), so
   "Use a device code" re-runs the login in that mode; the Codex CLI itself was not run here, so the flag stays an implementation check.

Where the same block is used (the block is one shared component; this task does not redesign these pages):
stage 1 `/onboarding/ready` Codex panel (specified here and in `stage1-signin.html`);
Providers page, `providers-connection-setup.service.ts:278` (button area of the Codex connection setup);
chat view, `chat-view.component.ts:346` (where it starts a Codex sign-in today). On those two hosts only the block's
status line and actions are shared; their layout stays. All three call the same `auth:codexLogin` route, so the
host fix repairs all three.

| # | State | Look (anatomy: `rounded-xl border p-3`, 16 px Lucide icon, title `font-semibold`, detail `text-sm text-base-content-muted`) | Actions | Announcement |
| --- | --- | --- | --- | --- |
| 1 | Ready to start | Primary "Sign in with Codex" + hint, then terminal copy row (`codex login`, installed Codex) | Sign in with Codex | none |
| 1b | Ready to start, bundled copy only | As 1, facts show "Ptah bundled copy: <path>"; copy row holds the quoted full bundled path + ` login` with the explanatory note (section 5.4 signed-out row, rule 1b) | Sign in with Codex | none |
| 2 | Starting | `Loader` spinning in state-run. Title "Starting Codex sign-in...", detail "Ptah is starting Codex. This can take a few seconds." | Cancel sign-in (ghost) | polite "Starting Codex sign-in." |
| 3 | Waiting, URL and device code | Title "Waiting for you to sign in", detail "Open the sign-in page and finish signing in there. Ptah continues on its own when you are done." plus, only when an open result was observed, "Ptah opened the sign-in page in your browser." Code box: label "Enter this code on the page", code in mono `text-2xl font-semibold tracking-[0.12em]`, `Copy code` outline button, "The code expires in about 15 minutes." (only when `expiresInSeconds` is known). Footer line "Ptah stops waiting after 10 minutes." | Open sign-in page (outline, `ExternalLink`, https only), Copy link (outline, "Copied" 2 s), Cancel sign-in (ghost). No primary: the user's task is in the browser | polite "Waiting for Codex sign-in." once; code is never re-announced |
| 4 | Nothing seen yet (first 20 s) | `Loader` spinning, title "Starting Codex sign-in...", detail "Codex is running. Ptah is waiting for it to show a sign-in page or code." No code box, no Open link, no mention of a browser. Footer "Ptah stops waiting after 10 minutes." | Cancel sign-in | polite "Starting Codex sign-in." |
| 4b | Nothing seen after 20 s (still running) | Neutral information styling in both roles (not an error): `Info` icon, title "Codex has not shown a sign-in page yet.", detail "Ptah cannot tell whether a browser opened. Try again, use a device code instead, or cancel." | Try again (outline, restarts), Use a device code (outline, re-runs in device mode), Cancel sign-in (ghost). Leaves to state 3 or 5 the moment a URL or code arrives | polite "Codex has not shown a sign-in page yet." |
| 5 | Waiting, URL only | As 3 without the code box | Open sign-in page, Copy link, Cancel sign-in | same |
| 6 | Signed in, checking | `Loader` spinning, title "Signed in to Codex.", detail "Ptah is checking your sign-in now..." | none | polite "Signed in to Codex. Checking." |
| 7 | Signed in, ready | Panel chip becomes Ready, block disappears, facts "Yes. Codex is signed in."; focus moves to Continue when Codex is chosen | none | polite "Codex is ready." |
| 7b | Signed in, still not confirmed | Chosen: warning notice "Codex finished signing in, but Ptah could not confirm it. Press Re-check." Information-only: same text, information styling | Re-check | alert (chosen) / polite (information-only) |
| 8 | Failed, with reason | Title "Codex sign-in did not finish." detail: reason in plain words: "Codex closed with an error (exit code 1). You are still not signed in." or "Ptah could not start `codex`. Check that it is installed and on your PATH, then try again." Collapsible "Show details" with the last output lines in mono (`max-h-28 overflow-auto`, focusable) when output exists | Try again (chosen: primary; information-only: outline) | chosen: `role="alert"`; information-only: polite status |
| 9 | Cancelled | Information styling in both cases (the user did it): `Info` icon, title "Sign-in cancelled.", detail "You are still not signed in. Nothing was changed." | Sign in again (outline) | polite "Codex sign-in cancelled." |
| 10 | Timed out | Same as 8 with title "Codex sign-in timed out." and detail "Ptah stopped waiting after 10 minutes. The page or code may have expired. Start a new sign-in." | Try again | as 8 |
| 11 | Terminal hand-off (non-Electron hosts) | `Info` icon, title "Codex sign-in opened in a terminal.", detail "Finish signing in there, then press Re-check. Ptah cannot see how it ends in this app." + copy row | Re-check | polite |

Chosen versus information-only (finding 2, decision 4, AC 4.5): when Codex is chosen, failure and timeout use
the `state-err` border (error ink 70% via the explicit `color-mix`, 4.74 dark / 3.87 light against the page), `CircleAlert`,
`role="alert"`, primary "Try again". When Codex is not chosen the same states use a dashed `base-300` border,
muted `Info` icon, `role="status"` (polite), outline "Try again", and the block stays inside the closed-by-default
disclosure "Sign in to Codex as well (optional)"; failure feedback and Re-check remain (AC 2.3). The detail line
for information-only failures adds "Your main connection is not affected." Waiting, success, cancelled and
terminal hand-off look the same in both roles (in progress and positive facts keep their tone).
While a sign-in runs, Re-check stays available (outline) and is not disabled; Continue anyway stays ghost. If the
disclosure is closed while a sign-in runs, the chip does not change; the summary gains the word "In progress".
Reduced motion: spinners become the static `Loader` shape. The device code is selectable text; its
accessible label spells the characters ("K, 7, Q, F, dash, 3, M, 9, P, X").

## 6. Connection choice control

`role="radiogroup"` labelled by the visible label "Main connection", described by the help line
"Ptah uses this for chat and agents. The other one is optional. You can change this later in Providers."

| Part | Spec |
| --- | --- |
| Cards | 2 columns, one at 480 px, `gap-3`. Each `label` card: `rounded-[14px] border border-base-300 bg-base-200 px-4 py-3`, native `<input type=radio class="radio radio-primary">`, 32 px icon tile (`Terminal` for Claude Code, `Code` for Codex), name `font-semibold`, descriptor `text-[13px] text-base-content-muted` ("Anthropic's coding agent", "OpenAI's coding agent") |
| Selected | `border-primary`, fill primary 10% over base-100 |
| Focus | native radio focus; card shows the 2 px `base-content` ring with 2 px offset (`--glass-focus`) |
| Status in card | none. Status is the panel chip; a status chip in a radio label would double-announce |

The control reads only the persisted `authMethod` / `anthropicProviderId` pair (AC 3.1). It never writes
until the confirm is pressed (AC 3.6). Panels follow the saved choice, not the pending selection: panel
roles, banner and strip change only after a confirmed save (AC 3.10).

### 6.1 Confirm block (appears directly under the cards when the selection differs from the saved choice)

`rounded-xl border border-primary p-3 text-sm`, fill primary 8% over base-100, `role="group"`
`aria-label="Confirm main connection change"`.

- Title: "Use Codex as your main connection?" (`font-semibold`)
- Line 1: "This ends running chat sessions in this workspace." or "... in every workspace." (reuses the Providers
  popover copy and target rule, AC 3.7)
- Line 2 muted: "Saved to: This workspace." / "Saved to: Every workspace."
- Actions: "Use Codex" (`btn btn-primary btn-sm`, Lucide `CircleCheck`), "Cancel" (`btn btn-ghost btn-sm`)
- Unavailable (AC 3.8): button `aria-disabled`, extra line "Where to save is not loaded yet. You cannot
  change the connection until it loads." (`role="status"`).

### 6.2 Choice states (all in `prototype/stage1-choice.html`)

| # | State | What shows | Live region |
| --- | --- | --- | --- |
| 1 | Loading (AC 3.2) | Two skeleton cards, `aria-busy`, no radio checked, no confirm; strip "Connection / Checking"; no banner; panels neutral | sr-only "Loading your saved connection" |
| 2 | Loaded, unchanged (AC 3.1, 3.6) | Saved radio checked; nothing else | none |
| 3 | Other card selected (AC 3.7) | Confirm block | none; focus stays on the radio |
| 4 | Write target missing (AC 3.8) | Confirm with `aria-disabled` button and reason | `role="status"` |
| 5 | Saving | Cards `aria-disabled`, button "Saving..." with spinner | `role="status"` "Saving your main connection..." |
| 6 | Saved, re-read ok (AC 3.10) | Notice `ok`: "Saved. Codex is your main connection." Panels, banner, strip follow | `aria-live="polite"` |
| 7 | Saved, refresh failed (AC 3.14) | Notice `ok`: "... Some settings could not be refreshed. Press Re-check to read them again." | polite |
| 8 | Save returned false (AC 3.9) | Notice warn `Info`: "Another save is in progress. Try again in a moment." Previous choice stays selected | polite |
| 9 | Blocked, failed, partial (AC 3.12) | Notice bad `role="alert"`: "Not saved. Your main connection is still <previous>. You can try again." | alert |
| 10 | Unconfirmed (AC 3.13) | Notice warn `role="alert"`: "Ptah could not confirm the change, so it may not be in effect yet. Showing the connection that is saved now." + link "Open Providers". Radio shows the persisted value after re-read | alert |
| 11 | Saved, status not confirmed (AC 3.19) | Nothing checked. Notice warn `role="alert"`: "Saved, status not confirmed. Your change was saved, but Ptah could not confirm the saved connection. Nothing is selected until it can." + "Try again" (outline, reads only, no write) + "Open Providers". Strip "Connection / Not confirmed" (idle marker). Both panels neutral. No banner | alert |
| 12 | Cannot read saved connection (AC 3.3) | Nothing checked. Notice bad `role="alert"`: "Ptah could not read your saved connection." + "Try again". Strip "Connection / Not confirmed". No write | alert |
| 13 | Other connection saved (AC 3.15) | Help line becomes "Your main connection is OpenRouter. Claude Code and Codex below are for information. Choose one to switch."; nothing checked; notice "You can manage OpenRouter in Providers." + link; both panels information-only; strip item 1 "OpenRouter / Set in Providers" | polite |

Notice anatomy: `rounded-xl border px-3.5 py-2.5 text-sm`, Lucide 16 px icon at the start
(`CircleCheck` done, `Info` or `CircleAlert` need, `CircleAlert` err), message in base-content (not the ink
colour: text stays AA-safe in both themes), tone only on the icon and the border.

### 6.3 Preselect rule (decision 5, AC 3.1, 3.4, 3.16)

Preselect = the saved connection, always, whatever the route health. Fresh install with neither ready:
the Providers page value is preselected and nothing is written; the footer note names that connection
("A warning stays on the next screens until Claude Code is ready."). Saved Codex, not signed in,
route unresolved: Codex radio checked, Codex panel main with chip "Not signed in", banner names Codex.
`prototype/stage1-fresh.html` is clickable: select Codex, read the confirm, press "Use Codex".

## 7. Re-check, footer and the one primary action

Footer unchanged in structure (`flex flex-wrap justify-between gap-3`, buttons `min-h-9`).
Re-check checks both providers once (no per-provider Re-check button). Left text "Checking your computer..."
during the mount read only.

One primary per surface, decided top-down:

| Situation | Primary | Others |
| --- | --- | --- |
| A change is pending in the confirm block | "Use <name>" | Re-check `btn-outline`; Continue / Continue anyway `btn-ghost` |
| Chosen connection ready | Continue | none |
| Chosen Codex signed out and the host can run sign-in | "Sign in with Codex" | Re-check `btn-outline`, Continue anyway ghost |
| Codex sign-in is running (states 2 to 6) | none (no primary while the user works in the browser) | Re-check `btn-outline`, Continue anyway ghost |
| Otherwise not ready, or nothing chosen | Re-check | Continue anyway ghost |
| Rechecking | Re-check label "Checking...", `aria-disabled`, keeps focus | |

Continue uses the saved connection: ready means the chosen connection is ready, whatever the other one is
(AC 4.1, 4.2). Continue note when not ready: "You can continue without it. A warning stays on the next
screens until <chosen name> is ready." When nothing is chosen: "... until a connection is ready."
Continue anyway keeps writing `skippedAt`; Continue keeps writing `claudeAt` (AC 4.6 record naming is the
architect's).

## 8. Banner (Home, stage 2)

Existing box unchanged: `role="status" rounded-[14px] border px-4 py-3 text-sm` with the explicit `color-mix` border and fill of section 3 (replaces `border-state-need/70 bg-state-need/10`, which do not render), `data-glass-surface="chrome"`, 24 px dot with `TriangleAlert`, one action `btn btn-sm min-h-9`
linking `/onboarding/ready`. Not dismissible. Shown only when the chosen connection is missing, signed out,
stale or could not check (terminal). Never while checking, never for "taking longer", never when the
selection is unknown, not confirmed or another connection.

| Chosen | State | Lead (bold) | Home action (icon) |
| --- | --- | --- | --- |
| Codex | missing | "Codex is not installed." | "Install Codex" (`Download`) |
| Codex | signed out | "Codex is not signed in." | "Sign in" (`LogIn`) |
| Codex | stale | "Codex needs you to sign in again." | "Sign in" (`LogIn`) |
| Codex | could not check | "Ptah could not check Codex." | "Check again" (`RefreshCw`) |
| Claude Code | missing / signed out / could not check | unchanged lead (today's copy) | unchanged |

Body, Home and settings (finding 5): "<Name> is your main connection. You can still pick a path." (settings: "...
You can keep going."). No claim about which flows fail is made. The earlier sentence "Analysis and agent generation
may fail until it is ready" is removed: which flows depend on Claude Code when Codex is chosen is an open question
of the architect (`task-description.md`). Until the architecture review fixes it, this copy is provisional and may
only gain a dependency sentence that review establishes. The chosen-provider name and the single action stay.
Settings action: "Fix <Name>" (`Terminal`).

## 9. Strip

Existing `ol aria-label="Setup progress"`, 3 items, markers and badges unchanged. Item 1 label and word:

| Selection | Label (Lucide icon) | Word | Marker |
| --- | --- | --- | --- |
| Claude Code chosen | Claude Code (`Terminal`) | Ready / Checking / Taking longer / Needs install / Needs sign-in / Could not check | done / checking / checking / need / need / need |
| Codex chosen | Codex (`Code`) | same words | same |
| Codex stale | Codex | Needs sign-in | need |
| Other connection | its name (`PlugZap`) | "Set in Providers" | idle |
| Loading | Connection (`PlugZap`) | Checking | checking |
| Cannot read, not confirmed | Connection | "Not confirmed" | idle |

"Taking longer" uses the `checking` marker (spinner, base-300 ring): no warning tone. The provider that
is not chosen never touches the marker. Item 2 and 3 words, current-step ring, and the collapse of
non-current items to `sr-only` text below 720 px are unchanged.

## 10. Accessibility

Focus order on stage 1: strip (not focusable) -> h1 (`tabindex=-1`, focused on route entry, as today) ->
radiogroup (one tab stop, arrow keys move and select a pending choice; with nothing checked the first
radio is the tab stop) -> confirm block (Use, Cancel) or notice actions (Try again, Open Providers) ->
Claude Code panel (summary of disclosure if any, OS tablist as one tab stop, active tabpanel
`tabindex=0`, copy buttons, docs link) -> Codex panel (same, then Sign in button) -> Re-check -> Continue
anyway or Continue. Tab lists keep arrow-key wrap and move focus (existing).

Focus handling: after Cancel or a finished save the confirm block disappears, so focus moves to the
checked radio (or the first radio if none). After Try again resolves the notice is removed, focus moves
to the checked radio. After Re-check resolves ready for the chosen connection, focus moves to Continue (as
today); Re-check keeps focus otherwise. Opening a closed `<details>` moves no focus.

Announcements, through the existing `OnboardingAnnouncerService` polite region and the choice area's own
live region. One message per event, never repeated by the panels (panels and chips are not live regions;
the banner keeps `role="status"`):

| Event | Message | Politeness |
| --- | --- | --- |
| Re-check finished, per provider | "Claude Code is ready." / "Codex is still not signed in." / "Ptah still could not check Codex." (one message per provider, Claude Code first) | polite |
| Taking longer starts | "Checking Codex is taking longer than usual. Ptah is checking again." (once per mount read) | polite |
| Terminal could not check | "Ptah could not check Codex." | polite |
| Follow-up resolves | the result message above | polite |
| Copy | "Copied" (existing) | polite |
| Codex sign-in | see section 5.5 table: starting, waiting, signed in, ready, cancelled polite; failure and timeout `role="alert"` for the chosen connection, polite status for the other | per state |
| Information-only failure of any kind | the same words, polite, never `role="alert"` | polite |
| Save ok, in progress | notice text | polite |
| Save not saved, unconfirmed, read error, status not confirmed | notice text | `role="alert"` |

Status never relies on colour: every state has a word and a distinct icon shape (check, spinner, clock,
download, log-in, alert, minus). Radio selection is exposed natively (`checked`); the tag "Main connection"
is text. Reduced motion: spinners and skeleton pulse are replaced by static icons.

## 11. Responsive and themes

| Width | Behaviour |
| --- | --- |
| 1280 px | Shell max 1120 px, panels 2 columns (each about 530 px) |
| 800 px | Panels 2 columns (about 370 px); chip wraps below the title; copy rows wrap |
| below 720 px | Panels 1 column; strip collapses non-current items to icons; h1 `text-[1.35rem]` |
| 400 px | Choice cards 1 column; facts 1 column; footer actions stack full width; verified no horizontal overflow (scrollWidth 400) |

## 12. Parity map (every keep / move row has a place)

| Parity capability | Place in this design |
| --- | --- |
| Derived states, missing beats error, path/version, refresh(false/true), rechecking, Electron-only | Section 5.2, 5.3, 7 (store logic is architect territory; every state has a surface here) |
| Banner conditions, not dismissible, `role="status"`, one action to stage 1 | Section 8 |
| Strip list, `aria-current`, items 2 and 3, markers without colour, sr-only collapse | Section 9 |
| Stage 1 h1 focusable, lead | Section 5 (copy changes to cover both providers) |
| Chip per state, facts, error "Signed in" per cause, `aria-busy`, `data-state` | Section 5.1-5.3 |
| OS tablist, copy rows, PATH hint, docs link, sign-in block, named-account link, error block with collapsible manual help | Section 5.4 (Claude Code unchanged; Codex gets the same) |
| Continue-without note, "Checking your computer...", Continue, Continue anyway, Re-check focus rules | Section 7 |
| Stage 2 strip, banner, lead, tabs, Back / Skip / Continue to setup | Section 8 and prototype `settings.html`; lead becomes "Choose what Ptah can use besides <chosen name>."; tabs, embedded pages and footer unchanged |
| Home strip, banner before resume banners, re-read on every visit, footer link | Section 13 |
| Providers popover save path, persisted reader | Section 6 (reuse; no new write path in the design) |

## 13. Shared surface with TASK_2026_863_3855

This design changes only these Home elements in `onboarding-home.component.ts` (template lines about 76-117
and 300-308 today). Nothing else on Home changes: no wrapper, no spacing class, no order.

| Element | Change |
| --- | --- |
| `<ptah-ready-strip class="mb-5" [current]="3" ...>` | Input `[claude]="readiness().state"` is replaced by the chosen-connection input (label, word, marker) of the strip component. Same element, same position, same classes |
| `<ptah-claude-readiness-banner class="mt-5" placement="home" ...>` | Inputs become provider-aware (chosen provider + its state); same element, same `mt-5`, same position before the resume banners. Component may be renamed by the architect; the placement in the template stays |
| Footer link text `Review Claude Code and settings` (`data-testid="onboarding-review-ready"`) | Text becomes "Review your connection and settings"; same `routerLink="/onboarding/ready"` |
| `readiness().state` re-read on every visit (lines about 419-421) | Source becomes the provider readiness store; call site unchanged |

Not touched by this task: h1, lead, workspace header, analysis card, resume banners, path tiles, no-workspace
block, Skip button. The other task owns them. Merge risk is limited to the two component tags and one link
text; both tasks should rebase on each other before review.

## 14. Prototype map (`prototype/`)

| File | Contents |
| --- | --- |
| `index.html` | Links |
| `home.html` | Strip and banner per state, footer link |
| `stage1-codex-main.html` | Reported case, full page: Codex chosen and ready, Claude Code not installed as information |
| `stage1-fresh.html` | Neither ready, saved Claude Code preselected; interactive choice and confirm; OS tabs and copy work |
| `stage1-states.html` | Provider panel per state, both providers, bundled, unreadable, auth-only failures with known path and version, information only, neutral |
| `stage1-signin.html` | Codex sign-in block: 12 states on the chosen panel, 4 on the information-only panel |
| `stage1-choice.html` | All 13 choice and save states |
| `settings.html` | Stage 2 top with banner variants |
| `assets/prototype.css`, `assets/prototype.js` | Hand-written CSS using the real theme tokens; theme switch and behaviour |
| `screenshots/` | Captures (see `prototype/README.md`) |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Choice control is a radiogroup of two cards above the panels, not radio inputs inside the panels | Radio inside each panel; segmented control; two cards above | Panels hold copy rows, tablists and buttons; interactive content inside a radio label is invalid and noisy for screen readers. Cards above give one tab stop and a clear confirm place | Yes |
| Panels follow the saved choice, not the pending radio | Panels follow the pending radio; follow the saved choice | AC 3.10 says panel, banner and strip follow after a save; AC 3.6 forbids side effects before confirm | Yes |
| Fixed panel order Claude Code, Codex | Chosen first | Reordering moves focus targets and layout on every save | Yes |
| Information-only provider: lower fill, hairline, muted tag, muted chip with dashed border, help in a closed disclosure | Hide the provider; keep warning tone | Decision 4 and AC 4.5; parity requires facts for both; muted ink keeps AA (11.7:1 dark, 5.9:1 light) | Yes |
| A ready provider that is not chosen keeps the green "Ready" chip | Mute it too | A positive fact is not a problem; consistency of the same facts for both | Yes |
| "Taking longer" is a non-warning chip with `Clock`, `state-run` ink and the strip `checking` marker | Reuse "Checking"; warning tone | AC 5.1 requires a non-warning state distinct from checking | Yes |
| One Re-check for both providers | Per-provider Re-check | Parity keeps one Re-check; announcements are per provider (NFR) | Yes |
| Codex sign-in is real and in app in Electron; one shared block on onboarding, Providers and chat (decision 7) | Terminal hand-off only; separate flows per page | User approved decision 7; `auth:codexLogin` is already shared by all three call sites | Yes |
| "Sign in with Codex" is the primary button when Codex is chosen and signed out, Re-check drops to outline | Keep Re-check primary | Skill rule: one primary per surface; in-app sign-in is the next step | Yes |
| Title "Check Claude Code and Codex" | "Get ready"; "Check your connection" | Route heading must cover both providers and stay a literal task statement; the strip already says "Get ready" | Yes |
| Codex install tabs in the prototype (npm, Homebrew) are examples only, not a constraint | Add Windows / macOS tabs | AC 2.5 assigns the final methods, commands and URL to the shared source and the then-current official docs; the architect is not locked to these two tabs | Yes |
| Banner and strip stay silent while the saved selection is loading, unreadable or not confirmed | Warn about both | AC 3.2, 3.3, 3.19 | Yes |

## Lane-introduced constraints

- [lane-proposed] Outline buttons and radio rings use `base-content` at 60% (measured 4.20:1 in light; 45% fails 3:1).
- [lane-proposed] Information-only chips use muted ink and a dashed border; they never use `state-need`, `state-err` or an alert icon.
- [lane-proposed] While a connection change is pending, Re-check is outline and the confirm button is the only primary (precedence table in section 7).
- [lane-proposed] Panel order is fixed (Claude Code, Codex) regardless of the choice.
- [lane-proposed] Facts text may not use `break-all`; use `overflow-wrap:anywhere`.
- [lane-proposed] Explicit `color-mix` border and fill for the banner and the chosen sign-in failure instead of `state-*` opacity suffixes (which do not render).
- [lane-proposed] Sign-in block has no primary action while waiting, and cancelled is information-styled in both roles.
- [lane-proposed] Failure of an information-only provider is information styling and a polite status; warning treatment is reserved for the chosen connection.

## Verification

Rendered with `ptah_browser_navigate` (file:// inside the worktree) and `ptah_browser_screenshot`, headless.
Revision 1 captures in `prototype/screenshots/` at 800 and 1280 px, dark and light, for the four changed pages:
`signin-*`, `states-*`, `home-*`, `settings-*` (`<page>-<theme>-<width>.jpg`). Earlier captures of unchanged
pages remain. The browser session keeps its first viewport, so each width used a fresh session. Not rendered
in Electron. No tests or builds were run.

## Revision 1 (Gate 1.7 round 1, verdict REVISE)

| # | Finding | Fix |
| --- | --- | --- |
| 1 Blocking | Electron has no runner and `openTerminal` is unsupported, so "Sign in with Codex" would report success without starting login | Section 5.5: host contract (Electron runner, one real outcome, cancel, auto re-check, terminal hand-off for other hosts that never shows success), eleven UI states including starting, waiting (URL / code / neither), success, failure with reason, cancelled, timed out, Cancel; the block is shared with the Providers page and chat view (call sites listed, pages not redesigned). New page `stage1-signin.html` |
| 2 Serious | Optional Codex failure looked like a warning | Section 5.5 chosen versus information-only paragraph, section 10: dashed information styling, `Info` icon, polite status, outline "Try again" for the unchosen provider; warning styling only for the chosen one. Failure feedback and Re-check kept (AC 2.3) |
| 3 Serious | Auth-only errors replaced known installed facts with "Unknown" | Section 5.3: installed and sign-in are independent facts; path and version stay on auth-only failures; "Unknown" only when binary detection is unknown; AC 1.9 empty or unreadable home row. Prototype: last section of `stage1-states.html`; captions on the old rows now say "binary detection unknown" |
| 4 Serious | `border-state-need/70` and `bg-state-need/10` cannot render | Section 3: verified `tailwind.config.js:33` has no `<alpha-value>` and the built Electron and webview stylesheets have no `/70` or `/10` rule for `state-need`. This is an existing defect (also affects other `state-*/NN` uses outside this task). Specified explicit `color-mix` classes reading `--state-ink-need`, used in the prototype, contrast measured in section 4 (edge 5.38 dark, 3.14 light; text on fill 12.95 / 13.37) |
| 5 Minor | Banner body claimed analysis and agent generation may fail | Section 8: sentence removed, copy marked provisional pending the architect's dependency answer; name and single action kept. `home.html` and `settings.html` updated |
| Constraint table | Codex install tabs must not bind the architect | Removed from Lane-introduced constraints; decision row says examples only. Three new lane-proposed constraints added for the color-mix approach, no primary while waiting, and information styling for unchosen failures |

## Revision 2 (Gate 1.7 round 2, verdict REVISE, two Serious findings)

| # | Finding | Fix |
| --- | --- | --- |
| 1 Serious | Bundled-only Codex could not sign in or show a usable manual command | Section 5.5 rule 1b: the login runner uses the executable path the readiness check and runtime selected (installed preferred, bundled when no supported installed one; no silent retry on another binary). Section 5.4: bundled-only terminal row shows the quoted full path plus ` login` with an honest note, or a no-command sentence if the binary cannot run from a terminal. New state 1b; prototype `stage1-signin.html` section "1b". |
| 2 Serious | "Waiting, nothing seen yet" claimed a browser was open | Section 5.5 rule 6: no browser claim until a URL, code or explicit `openExternal` result is seen. State 2 and state 4 use neutral "Starting Codex sign-in..." copy; states 3 and 5 say "Open the sign-in page..." with Open sign-in page and Copy link controls; new state 4b after 20 s offers Try again, Use a device code, Cancel. Cancel and timeout states unchanged. |

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Login runner uses the selected executable path, installed first then bundled | Bare `codex` on PATH; selected path | `select-codex-executable.ts:84-88,107-118` picks bundled exactly when no working installed Codex exists; readiness shows that path | Yes |
| No silent cross-binary retry on a failed start | Retry bundled automatically; report and offer Try again | A hidden second login would sign in a different binary than the facts show | Yes |
| Bundled-only terminal row shows the full quoted path; fallback to a no-command sentence if it cannot run | Hide the row; bare `codex login`; full path | Bare command cannot work with no installed Codex; the full path is the honest manual equivalent | Yes |
| Neutral copy until evidence; 20 s bound; 4b offers Try again, Use a device code, Cancel | Keep "Waiting for you to sign in"; fixed copy only | Browser launch by the CLI is unobservable; `--device-auth` is already used in `interactive-login-methods.ts` and parsed in `cli-platform-commands.ts:55,61` | Yes (bound is the architect's to tune) |
| Open sign-in page loses "again"; Copy link added | Keep "again" | The page may not have opened at all; copy link is the recovery when `openExternal` fails | Yes |

Verification: `stage1-signin.html` rendered with `ptah_browser_navigate` (file://, headless) and `ptah_browser_screenshot` at 800 px, dark (`screenshots/signin-r2-new-dark-800.jpg`, states 1b and 4b) and light (`screenshots/signin-r2-wait-light-800.jpg`, states 3 and 4). Not rendered in Electron. No tests or builds were run.

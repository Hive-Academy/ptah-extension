# Batch 37b2 executor report: Electron `go vet` consent card (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base 9b2586e5b
(37a..37b1d). No git command changed state; the tree is left dirty. `FE` = `libs/frontend/chat/src/lib/settings`.

## Files

| Status   | File                                                   | Change |
| -------- | ------------------------------------------------------ | ------ |
| CREATED  | `FE/ptah-ai/go-vet-consent-config.component.ts`        | `GoVetConsentConfigComponent` (`ptah-go-vet-consent-config`) |
| CREATED  | `FE/ptah-ai/go-vet-consent-config.component.spec.ts`   | 14 cases (O2 §7.3 card list + confirm/cancel, revoke, transport, no workspace, GET failure, timer) |
| MODIFIED | `FE/settings.component.ts`                             | import next to `VoiceConfigComponent`; added to standalone `imports` |
| MODIFIED | `FE/settings.component.html`                           | `<ptah-go-vet-consent-config />` inside the existing `@if (isElectron)` of the `tools` tab, after the voice card |

## Stack observed

Angular 22.1.7 (`package.json:93`), standalone + OnPush + signals/`inject()` (`FE/ptah-ai/voice-config.component.ts`);
daisyUI card/toggle/badge/btn classes as in `FE/pro-features/browser-settings.component.ts` (the settings cards use
daisyUI `toggle` directly, not a `Native*` primitive — no Native toggle/switch exists in `libs/frontend/ui/src/lib/native`);
RPC via `ClaudeRpcService.call` → `RpcResult`; workspace scope via `WorkspaceScopeService.scopeKey()`
(`libs/frontend/core/src/lib/services/workspace-scope.service.ts:83`); specs with jest-preset-angular zone env and
`@ptah-extension/core/testing` mocks (as `voice-config.component.spec.ts`).

## Behaviour (O2 §5.1, Decisions 18-25)

- **GET** `diagnostics:go-vet-consent-get` on init and on each `scopeKey()` change, through one `effect` (runs on first
  CD = init). A response is applied only if no newer GET started (sequence) **and** `scopeKey()` still equals the key
  captured at request start. A scope change also closes an open confirmation and clears messages.
- **Visibility.** Renders nothing until the first GET settles and whenever GET answers `supported:false`. Still inside
  `@if (isElectron)` (capability `goVetDiagnostics` off on VS Code, family not served there). A failed GET shows the
  card with one fixed error and a disabled toggle (a real failure on Electron, not hidden).
- **Shown:** workspace root (`workspace.root`, or "No workspace folder is open"), Go binary (`goBinary` or "none found on
  PATH"), state badge `On` / `Off` / `Out of date`, and the fixed "what this runs" text (O2 §4.3). No string contains
  `from "`.
- **Stale** (Decision 25): badge "Out of date", toggle unchecked (never shown as on), line
  "Consent is out of date: <reason>. go vet does not run until you turn it on again." Reasons:
  `root-moved` "the workspace folder now points to a different location"; `root-replaced` "the workspace folder was
  replaced (deleted and re-created, or re-cloned)"; `go-changed` "the Go toolchain changed since consent was given".
- **Enable flow.** Switching the toggle on does not call SET: it opens a confirmation group "Allow go vet to run in this
  folder?" showing the exact root (monospace), with Cancel (focused on open; Escape also cancels) and "Allow go vet".
  Allow sends `{ enabled:true, workspaceRoot:<displayed root>, source:'settings-ui' }`. Re-enabling a stale consent uses
  the same flow.
- **Revoke flow.** Switching off sends `{ enabled:false, workspaceRoot:<displayed root>, source:'settings-ui' }`
  immediately; the displayed state is then the SET read-back `state`.
- **In flight.** Toggle disabled while a GET or SET runs, and when no workspace is open or support is unknown.
  Optimistic toggle during SET; reverted on any failure.
- **Errors (fixed text per code, no host text shown):** `invalid-params`, `unsupported`, `no-workspace`,
  `workspace-changed` ("The active workspace changed before the change was saved. Nothing changed; the card now shows
  the current workspace."), `no-go-binary`, `persist-failed` ("The change could not be saved and verified. The card
  shows what is stored now."), transport ("Could not reach the app host. …"). Every SET failure reverts and re-reads GET
  (O2 requires it for `workspace-changed`; applied to all failures so the card always shows the stored state).
  A SET answer that arrives after a scope change is dropped (the effect already re-fetched).
- **Success message** "go vet is on/off for this workspace." for 3 s; timer cleared on the next action and on
  destroy via `DestroyRef`.
- **Accessibility:** `<section aria-labelledby>`, `<label for>` on the switch (`role="switch"`, `aria-checked`,
  `aria-describedby` → status region), `aria-live="polite"` status region (loading / stale / success), `role="alert"`
  for errors, confirmation `role="group"` with `aria-labelledby`/`aria-describedby`, focus moved to Cancel on open and
  back to the switch on close (`afterNextRender`). Keyboard: native checkbox and buttons; Escape cancels.

## FB evidence

- Base 9b2586e5b: the component does not exist; the spec cannot compile.
- Mutations against the finished component (each restored; `cmp` identical afterwards):

| Mutation | Result |
| --- | --- |
| stale-response guard removed | 1 failed (scope change during GET) |
| no confirm (toggle-on sends SET directly) | 5 failed |
| `DestroyRef` cleanup removed | 1 failed (timer) |
| no re-fetch after SET failure | 1 failed (`workspace-changed`) |
| `stale` rendered as on | 1 failed |

## Verification (tail only)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/chat --skip-nx-cache --parallel=2`
  → 1 project, 3 targets: "Successfully ran targets test, lint, typecheck". Test: 106 suites passed, 1636 passed,
  2 skipped. Lint: 0 errors, 22 warnings, none in the changed files (`eslint` on the 3 TS files: clean).
- `nx run-many -t=typecheck -p ptah-electron --skip-nx-cache` → "Successfully ran target typecheck".
- Prettier: both new files formatted. `settings.component.ts`/`.html` were already not Prettier-clean at HEAD; left
  as is (2-line additions only).

## How to reach the card (visual review)

Electron app → Settings (gear) → tab **"Search & Voice"** (the `tools` tab; label unchanged) → below "Voice Providers":
card "RUN go vet FOR THIS WORKSPACE". Needs an open workspace folder for the toggle to be enabled.
- **off:** fresh workspace. **on:** switch on → "Allow go vet" (requires a Go toolchain on PATH outside the workspace;
  otherwise the `no-go-binary` message shows — itself a state worth a screenshot).
- **stale:** grant, then change the Go binary (e.g. `touch`/replace `go.exe` so size or mtime changes), or move/re-clone
  the folder, then reopen Settings or switch workspace.
- Go is not installed on this machine; `on`/`stale` screenshots need a machine with Go, or `off`, confirmation,
  `no-go-binary` and no-workspace states can be captured here.

## Plan deviations

1. Re-fetch after **every** SET failure, not only `workspace-changed` (stricter; spec case "persist-failed reverts with
   no success message" still holds).
2. Card is hidden until the first GET settles (avoids flashing a card on an unsupported host); there is therefore no
   visible first-load spinner — later GETs show "Checking the go vet setting…".
3. No "remove stale consent" action: a stale record is not auto-deleted (O2 §1.2) and re-enabling overwrites it.

## Out-of-scope observations

- The settings tab for this card is labelled "Search & Voice", while O2/formatter text says "Settings → Tools". Either
  rename the tab or adjust the §5.4 formatter line; not changed here (not in 37b2's files).
- `settings.component.ts`/`.html` are not Prettier-clean at HEAD.

## Visual fix round

Input: `visual-review-37b2.md` (4 findings). Base HEAD 0fe312efd; the coordinator's load-`catch` change (no early
`return` in the catch) is kept. Only `FE/ptah-ai/go-vet-consent-config.component.ts` and its spec changed. No shared
theme token changed; no git command run.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Dark "On" badge 2.64:1 (`badge-success`: `success-content` #e8e6e1 on #16a34a) | Every badge state now uses `badge-outline` + `text-base-content` (the body-text pairing, AA in both themes); the state colour moved to a decorative dot (`bg-success` / `bg-warning` / `bg-info` / `bg-base-content-muted`, `aria-hidden`). The label text carries the meaning. |
| 2 | Error text 3.55:1 dark / 3.35:1 light (`text-error`) | Error is a chip: `border-error/50 bg-error/10` with `text-base-content` and an `AlertCircle` icon in `text-error` (`aria-hidden`). The same treatment was applied to the stale line (`text-warning` → base-content + `AlertTriangle`) and the success line (`text-success` → base-content + `CheckCircle`). Light `text-success`/`text-warning` on cream has the same weakness as `text-error`, so they were fixed too. |
| 3 | Switch target 24×16 px | The `toggle-xs` input (visual size unchanged, the same as the neighbouring cards) is wrapped in a `<label>` with `min-w-6 min-h-6 px-1` (at least 24×24 px, click activates the switch). `cursor-pointer` is only set when the switch is enabled. The visible text label `for=` is unchanged, so the accessible name is unchanged. |
| 4 | During confirm, the badge said "Off" while the switch was on | New `badgeView`: while the confirmation is open the badge reads "Confirm to enable"; while a SET is in flight it reads "Saving…" (the switch shows the optimistic position then). Otherwise the committed state is shown. `stateView`/`stateLabel` were replaced by `badgeView`/`badgeLabel`. |

Specs (16 cases, +2 new, 2 extended): a new "badge and switch show the same pending state during the confirm step"
case; a new "the enlarged hit area around the switch toggles it" case; cancel → badge back to "Off"; revoke in flight →
badge "Saving…". FB: a mutation where `badgeView` ignores confirm/saving gives **3 failed** (restored, `cmp` identical).
The hit-area case fails on the previous version (no `go-vet-consent-toggle-target`). jsdom cannot measure pixel sizes
or contrast, so items 1-3 need the visual re-review.

Verification:
- `nx run-many -t=test,lint,typecheck -p @ptah-extension/chat --skip-nx-cache --parallel=2` → "Successfully ran targets
  test, lint, typecheck". 106 suites, 1638 passed, 2 skipped. Lint: 0 errors, 22 warnings, none in the card files
  (`eslint` on the card files: clean).
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`; `libs/frontend/chat: 9 ok (baseline 11)`.
- Prettier: both card files formatted.

Still open for the visual re-review: contrast of the dot colours (decorative, the text carries the meaning); keyboard
Tab focus ring (not verifiable in the reviewer's harness). The `toggle-xs` target size in other settings cards is a
system-wide follow-up and is not touched here.

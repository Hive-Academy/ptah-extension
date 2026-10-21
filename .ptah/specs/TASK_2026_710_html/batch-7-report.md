# Batch 7 report — UI and bridge (TASK_2026_710)

Executor: frontend-developer. Host target: Electron (webview surface of `chat-ui`).

## Files changed (7 of max 8)

| Status | Path |
| --- | --- |
| N | `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-card.component.ts` |
| N | `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts` |
| N | `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-theme-bridge.service.ts` |
| N | `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.spec.ts` |
| N | `libs/frontend/chat-ui/src/lib/organisms/artifacts/index.ts` |
| M | `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts` |
| M | `libs/frontend/chat-ui/src/index.ts` |

## Components — inputs and outputs

### `ArtifactCardComponent` (selector `ptah-artifact-card`)
Metadata-only card for the chat transcript. No frame is ever embedded here
(fixed decision: only one live iframe, and it lives in the viewer).

- `artifact: input.required<ArtifactRecord>()`
- `open: output<string>()` — emits the artifact id; the "Open" button asks the
  host to select the artifact's tab in the display panel.
- `fullscreen: output<string>()` — emits the artifact id; the "Full screen"
  button asks the host for the full-screen viewer.

### `ArtifactViewerComponent` (selector `ptah-artifact-viewer`)
The single sandboxed frame, rendered as a new item type in the display panel.

- `artifact: input.required<ArtifactRecord>()`
- `fullscreen: input<boolean>` — external drive (the chat card route, wired by
  a later batch); an internal toggle button covers the in-viewer route.
- `fullscreenChange: output<boolean>()` — emitted on every internal toggle and
  on Escape close.
- `openExternal: output<string>()` — a schema-validated `open-link` request;
  the host (later batch) routes the HTTP(S) URL through the main-process
  allowlist. `window.open` is never called.

### `ArtifactThemeBridgeService` (component-provided, one instance per viewer)
Outgoing half of the bridge: nonce minting and theme posting.

- `mode: computed<'light' | 'dark'>`
- `attach(contentWindow: Window): void` — fresh nonce (`crypto.getRandomValues`,
  24 chars ≥ the schema floor of 16) plus an immediate theme post on `load`.
- `detach(): void` — clears target and nonce; stale frames no longer match.
- `sendTheme(): void` — vars read live via
  `getComputedStyle(document.documentElement)`, restricted to
  `ARTIFACT_THEME_VAR_ALLOWLIST`, validated with `ArtifactThemeMessageSchema`
  before posting.
- `nonce(): string | null` — the nonce an incoming message must echo.

### Display panel (modified, additive only)
- New input `artifacts: input<readonly ArtifactRecord[]>([])` (default empty,
  so every existing spec and host keeps its current behaviour).
- New output `openExternal: output<string>()`, a passthrough of the viewer's
  `open-link` emission.
- `DisplayPanelItem` gains an `artifact` kind; items are appended after the
  surfaces with the key `artifact:<id>`, which cannot collide with the summary
  key or the `id:` / `anon:` surface keys.
- The tabpanel renders `ptah-artifact-viewer` for artifact items. Strip
  keyboard semantics (roving tabindex, arrows/Home/End), focus behaviour,
  summary and surface paths, `updatedSeq` selection and the new-dot logic are
  untouched; `isNew` returns false for artifact items.

## Security decisions implemented (fixed, unchanged)

- iframe markup (artifact-viewer.component.ts:110-119): `sandbox="allow-scripts"`
  EXACTLY (no `allow-same-origin`, no forms, no popups),
  `referrerpolicy="no-referrer"`, `[title]`, `[src]`.
- `src` is only the record's `viewerUrl` after it passes
  `^ptah-artifact://[a-z0-9][a-z0-9-]{0,127}/index\.html$`
  (artifact-viewer.component.ts:38, used in `sanitizedSrc`, line ~140). The
  sanitizer bypass is applied to that validated string only, with a comment
  explaining the validation. Never `[innerHTML]`, never `srcdoc`; a failed
  check renders an accessible `role="alert"` error naming the title and no
  iframe at all.
- Bridge post uses `targetOrigin '*'` with a comment explaining that the
  sandbox origin is opaque and the per-frame nonce is the authentication
  (artifact-theme-bridge.service.ts:147-152).
- Incoming gates (artifact-viewer.component.ts:344-351):
  `event.source === iframe.contentWindow`, then
  `ArtifactPageToHostMessageSchema.safeParse`, then nonce equality with the
  current bridge nonce. `height` is clamped to
  [ARTIFACT_HEIGHT_MIN, ARTIFACT_HEIGHT_MAX] (`clampArtifactHeight`) and
  throttled at 100 ms with a trailing edge; `open-link` is emitted for the
  host. Everything else is ignored.
- Listener removed on destroy, on src change and on load timeout; the bridge
  detaches with it, so a stale frame has no channel (lines 260, 289, 302,
  `resetFrame`).
- 10 s load timeout without `load` → accessible error with the title; no HTML
  rendered.
- Full screen reuses the SAME iframe element (container classes switch, the
  frame is never re-created): fixed overlay with `role="dialog"` +
  `aria-modal`, closed by Escape or the header button, focus restored to the
  element that had focus when it opened (constructor effect, lines 243-255).

## Theme change observation (file:line)

`ArtifactThemeBridgeService` injects the existing webview theme service
(`ThemeService` from `@ptah-extension/core`,
`libs/frontend/core/src/lib/services/theme.service.ts`, `isDarkMode`
computed at line 164) and derives `mode` at
artifact-theme-bridge.service.ts:73-75. The effect at
artifact-theme-bridge.service.ts:86-90 re-reads `mode()` on every theme flip
and re-posts the theme tokens while a frame is attached (`attach` sends them
immediately on load). Spec evidence: "sends the theme tokens on load and
re-sends on a theme change" flips the mocked `isDarkMode` signal and asserts
the second postMessage carries `mode: 'dark'`.

## Verification results (memory-safe, `NX_NO_CLOUD=true`)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts <artifacts dir> <display-panel dir> --coverage=false --maxWorkers=2`
  → `Test Suites: 5 passed, 5 total / Tests: 105 passed, 105 total`
  (17 tests in the new artifacts suite; 88 existing display-panel tests still
  green). The artifacts suite alone also exits cleanly
  (`1 passed, 17 passed`); the "worker failed to exit gracefully" notice in
  the combined run reproduces from the display-panel suites (pre-existing,
  not introduced by this batch).
- `npx nx typecheck chat-ui --parallel=1` — first two runs failed on two
  missing imports and one private template member; after the fixes
  `npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json`
  (the exact command the target runs) reports **0 errors** and exits 0
  (`NGC_EXIT_OK`). Only pre-existing NG8107 warnings in an unrelated file
  remain.

## Decisions

1. **Only the card is value-exported from the main `chat-ui` barrel**
   (src/index.ts, after the display-panel type export). Options: value-export
   the whole artifacts barrel vs card only. Evidence: the main barrel comment
   (src/index.ts) forbids value exports of the lazy `organisms/display-panel`
   folder, and the viewer/bridge carry the iframe and zod-bearing schemas that
   belong to the lazy display-panel chunk; the card is metadata-only and
   transcript-safe. Reversible: a later batch can move the viewer to a
   secondary entry point like `chat-ui/display-panel` if a non-panel host
   needs it.
2. **The display panel imports the viewer from the folder barrel**
   (`../artifacts`), matching how it consumes its own folder modules, so the
   new folder has one public seam (artifacts/index.ts) with the laziness rule
   documented in it. Alternative (direct relative file imports) loses the
   single documented seam.
3. **Full-screen state is two-sourced**: `fullscreen` input + an internal
   signal, merged into `fullscreenActive`. Options: input-only (parent-driven)
   vs internal + input. Evidence: the card's "Full screen" button needs the
   external input route (later batch), while the viewer header button must
   work without any parent wiring; the input-`false` effect reconciles the
   two. Reversible.
4. **Viewer URL check uses the task's exact strict regex** (lowercase id host)
   rather than the looser record-level schema (which also admits uppercase
   and `_`). Evidence: the task states the check exactly, and the Electron
   protocol handler already enforces the same lowercase id pattern
   (`apps/ptah-electron/src/artifacts/artifact-protocol.ts:18`), so records the
   host can actually serve always pass.
5. **Height throttle has a trailing edge** (pending value applied when the
   100 ms window reopens) rather than dropping late messages. Evidence: a
   leading-edge-only drop could clip the frame if the page's final height
   report lands inside the window and no further message follows.

## Not done

- Wiring of card outputs (`open`, `fullscreen`) and the panel's
  `openExternal` into the store/handler and the main-process allowlist —
  batch 8 (`libs/frontend/chat`) and the host wiring, per the file-disjoint
  split. The outputs exist and are tested at the component level.
- The `ptah-ui-message-text.component.ts` modification named as conditional
  in the plan (transcript card insertion point) was NOT needed: the card is
  exported for the transcript from the main barrel, so no parser/converter
  change was required. Nothing outside `chat-ui` was touched.
- Manual Electron full-screen / reduced-motion visual review — requires a
  packaged run of the host, outside this lane's scope and file set.
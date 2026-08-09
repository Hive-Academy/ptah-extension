# Context — TASK_2026_187

## How this surfaced

`nx run ptah-extension-webview:build:production` started failing hard on
2026-08-09:

```
X [ERROR] bundle initial exceeded maximum budget.
  Budget 3.50 MB was not met by 128.63 kB with a total of 3.63 MB.
```

This is not a regression from any single change. The source delta over the
preceding commits was roughly 280 lines of component logic — a few kB. The
bundle had been drifting toward the ceiling for a long time and simply crossed
it, and nobody had run a production webview build recently enough to notice.
The `maximumWarning` at 2.5 MB had been firing (and being ignored) the whole
time.

**The error ceiling was raised from `3.5mb` to `4mb` in
`apps/ptah-extension-webview/project.json` to unblock the build.** The warning
was deliberately left at 2.5 MB so the drift stays loud. That change is an
unblock, not a fix, and this task is the fix.

## The actual shape of the problem

```
main.js            1.90 MB
chunk-HAMQW4KR.js  685.72 kB
chunk-GZKAFEM7.js  677.31 kB
styles.css         276.07 kB
scripts.js          48.20 kB
polyfills.js        35.73 kB
                 ─────────
Initial total       3.63 MB   (694 kB transfer)

Lazy chunks:      6.60 kB + 1.13 kB + 292 B   ← under 8 kB total
```

Under 8 kB of a 3.63 MB application is deferred. That is the finding. Monaco,
xterm, the editor lib, the canvas, the marketplace, the tribunal panel, the
setup wizard and the tasks board are all in the initial chunk.

## Why the usual fix does not apply

`apps/ptah-extension-webview/CLAUDE.md` is explicit: **"The webview has no
`pushState`/`replaceState` — never use Angular Router here"**. `WebviewErrorHandler`
exists specifically to swallow the `SecurityError` that proves the constraint.
Routing inside the app is done with signals.

So there is no route table to hang `loadComponent` off. Route-based code
splitting — the normal answer to this problem — is structurally unavailable.

Compounding it, `app.config.ts` is the cycle-breaking hub. It eagerly imports
every feature component to register the inversion tokens
(`WIZARD_VIEW_COMPONENT`, `ORCHESTRA_CANVAS_COMPONENT`, `HARNESS_BUILDER_COMPONENT`,
`SETUP_HUB_COMPONENT`, `MARKETPLACE_COMPONENT`, `TRIBUNAL_COMPONENT`,
`TASKS_VIEW_COMPONENT`) that break the library dependency cycles. Every one of
those imports is a static edge into the initial graph.

## The approach that does apply

The inversion tokens are the lever. A token registered with a `useValue`
component reference is a static edge; a token registered with a factory that
returns a `Promise` of the component is not.

1. Convert the heavy inversion tokens from eager `useValue` to a lazy factory
   returning `() => import('...').then(m => m.TheComponent)`. The consuming
   surfaces already resolve these through the token, so the switch is contained
   if the token's declared type changes in one place.
2. Where a surface renders a component the user may never open in a session —
   marketplace, tribunal, tasks board, harness builder, setup wizard — an
   `@defer` block on the signal that reveals it is the cheaper move and does not
   touch DI at all. Prefer this where it fits.
3. Monaco and xterm are the two biggest single wins and the two most dangerous.
   Read the Monaco warnings in `apps/ptah-extension-webview/CLAUDE.md` before
   touching `provideMonacoEditor` — there is a documented failure mode where
   overriding the worker factory 404s the editor worker and silently kills diff
   highlighting while the editor still renders text. xterm is flagged non-ESM by
   the bundler (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`), which
   limits how well it tree-shakes and may need a dynamic import at the terminal
   component rather than a bundler-level fix.

## Acceptance

- Initial bundle back under the **2.5 MB warning** threshold, not merely under
  the raised 4 MB error ceiling.
- `maximumError` returned to `3.5mb` in
  `apps/ptah-extension-webview/project.json` as the final step. Leaving it at
  4 MB means this task did not finish.
- Chat — the surface that opens on launch — must not regress in
  time-to-interactive. A deferred surface that the user opens immediately is a
  loss, not a win.
- Monaco diff highlighting verified working by hand after any change to
  `provideMonacoEditor`. The documented failure is silent.
- `nx build ptah-extension-webview --configuration=production` green, and the
  before/after chunk table recorded in the report.

## Notes

- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css`
  is 10.98 kB against a 10 kB component-style warning. Not this task's target,
  but it is in the same build output and would be cheap to fold in.
- Verify with `npx nx reset` before any boundary or budget check.
  `--skip-nx-cache` does **not** refresh the Nx project graph — an edit to
  `project.json` was read as stale under that flag while diagnosing this very
  issue. Recorded as F-11 in `TASK_2026_177/batch-12-report.md`.

## Orchestration

- Strategy: REFACTORING / Partial — software-architect → team-leader (MODE 1/2/3)
  → frontend-developer batches → QA.
- `cli_delegation: disabled`. `ptah_agent_list` found one usable provider
  (`ollama cloud`, ptahCliId `pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9`); `cursor`
  is not installed. Bundle splitting here turns on precise Angular DI / `@defer`
  / bundler judgment and a silent Monaco failure mode — not grunt work worth
  farming out to a single low-context CLI lane.
- Checkpoint 1.5 (technical clarification) skipped: `context.md` already fixes the
  approach (prefer `@defer`, lazy inversion-token factories, treat Monaco/xterm as
  the dangerous pair).

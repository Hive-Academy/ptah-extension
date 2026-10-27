# Fix round 1 — chat layout declutter

Status: REVISE. Implementation and one correction pass are written. Both permitted verification runs finished; the final run still fails six tests and chat lint. This is not a completed or passing fix round.

## Findings

Path prefixes: `chat/.../session-inspector/` = `libs/frontend/chat/src/lib/components/organisms/session-inspector/`; `chat-ui/.../plan-limits/` = `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/`; `chat-ui/.../session/` = `libs/frontend/chat-ui/src/lib/molecules/session/`; canvas filenames below are in `libs/frontend/canvas/src/lib/canvas-rail/`.

| Finding | Files and lines changed | Regression coverage |
| --- | --- | --- |
| 1 | `chat/.../session-inspector/inspector-agents-section.component.ts:476` | `inspector-agents-section.component.spec.ts:226,240,255`: unknown dash and missing-field aria-label; known tokens/cost; partial tokens/cost |
| 2 | `chat/.../session-inspector/session-inspector.component.ts:84,108`; `.html:16,41`; `canvas-inspector-dock.component.ts:175` | `session-inspector.component.spec.ts:91,127`: near/at warnings on expand and Context, full accessible description, stats fallback; dock spec forwards both limit states |
| 3 | `chat-ui/.../plan-limits/lane-tiles.ts:388,455,466` | Status sentence map cases and unknown-status fallback in `stats-limit-view-model.spec.ts` |
| 4 | `canvas-focus-header.component.ts:169` | Header spec checks visible running and error text beside controls |
| 5 | `canvas-focus-header.component.ts:262` | Header spec checks hidden menu when expanded/single and retained menu when split |
| 6 | `canvas-inspector-dock.component.ts:149,231,277` | Dock spec checks exactly one selector in deferred placeholder and completed inspector; board retains integration coverage |
| 7 | `chat/.../session-inspector/session-inspector.component.html:26` | `session-inspector.component.spec.ts:80`: no-session rail has exactly one button, even with attention data |
| 8 | `chat-ui/.../plan-limits/lane-tiles.ts:601` | One warning among unknown runs, complete warning group, and mixed warning groups in `stats-limit-view-model.spec.ts` |
| 9 | `chat-ui/.../session/session-stats-view.ts:163,170` | Rounded cost and spoken minute/second/millisecond labels in `session-stats-view.spec.ts` |
| 10 | `chat-ui/.../plan-limits/plan-limit-tiles.ts:241` | Unavailable-owner face value in `stats-limit-view-model.spec.ts` |
| 11 | `canvas-inspector-dock.component.ts:92,312,324`; `canvas-rail-board.component.ts:375,518` | Dock spec checks 1096−56=1040 compact space, 1096−400=696 expanded space, absence of simultaneous rail, unchanged saved preference, and narrow-width clamping |

## Required items A–D

- A: Files edited with `apply_patch`, then independently checked using Node `readFileSync` and UTF-8 buffers:

```text
inspector-agents-section.component.ts: U+2014 bytes=e28094 present=true; U+00B7 bytes=c2b7 present=true; U+2265 bytes=e289a5 present=true; CR=false
inspector-agents-section.component.spec.ts: U+2014 bytes=e28094 present=true; U+00B7 bytes=c2b7 present=true; U+2265 bytes=e289a5 present=true; CR=false
```

- B: All 16 Batch C files normalized to UTF-8 LF. Independent byte audit: `Batch C files checked=16; files containing CR=0`. All five touched chat files and six touched/new canvas files also contain no CR bytes.
- C: Extracted the compact rail, expanded dock/sheet composition, resize policy, focus handling, limit binding and strip projection into standalone OnPush `CanvasInspectorDockComponent`. Final physical newline counts: board **1237**, new component **553**, new component spec **219**. All three contain no CR bytes. The board meets the **≤1241** requirement. Width persistence/reset tests moved to the new spec; board integration tests remain. Deferred selector behavior still has failing coverage and requires correction.
- D: `INSPECTOR_TAB_WIDTH` is live at new component line 312, rather than dead. Available dock space subtracts only the left rail. The single flex child uses either 56px compact width or saved expanded width; it never renders both. Regression coverage checks both cases and that collapsing never persists 56px. Retaining the live export avoids editing the unchanged barrel outside task scope.

## Verification

Required command: `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas`.

First run completed in the foreground with exit **1** after a 588-second lock wait and 286.6-second execution. Nx reported **9 tasks: 3 succeeded, 6 failed**. All three typecheck tasks succeeded; lint and test failed in each requested project. The compact Nx output did not print the requested three-project header, but the command and nine-task list confirm the three exact requested projects. Captured output: `%TEMP%/ptah-fix-round-1-verify.log`.

After corrections, the single permitted retry ran in the foreground with static output:

`npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`

The header explicitly confirmed **Running targets lint, test, typecheck for 3 projects**. It completed with exit **1** after a 447-second lock wait and 309.3-second execution. Six of nine tasks passed; three failed: chat-ui:test, chat:lint, canvas:test. All three typechecks passed. Captured output: `%TEMP%/ptah-fix-round-1-verify-retry.log`.

| Project | Suites | Tests | Lint | Typecheck |
| --- | --- | --- | --- | --- |
| chat-ui | 84 passed, 2 failed | 1588 passed, 2 failed | Passed | Passed |
| chat | 274 passed | 4706 passed, 2 skipped | Failed | Passed |
| canvas | 21 passed, 2 failed | 476 passed, 4 failed | Passed | Passed |

The correction pass repaired premature required-input access in the extracted dock state, adjusted chat formatting expectations, and addressed chat-ui template comparisons and canvas duplicate-class lint, including `canvas-detail/canvas-lane-tabs.component.ts`. The finding table records implemented changes and added coverage, not a claim that every listed regression passes.

Scoped `ptah_get_diagnostics` was requested after the chat/chat-ui edits. It returned **Unavailable**, with five requested files unchecked because the compiler did not finish within 45 seconds. This is not passing evidence.

Canvas scoped diagnostics reported no errors in the six touched/new files, with nine dependency errors in shared/core files. The combined command remains the acceptance gate.

## Decisions

- Retain `INSPECTOR_TAB_WIDTH` and use it as the compact-width source rather than deleting its public re-export from an unchanged file. Evidence: the spec explicitly establishes this constant as the 56px policy; `services/session-inspector/index.ts` still exports it and is not in Batch B's changed-file list. This is reversible and preserves scope.
- Keep running and error text beside chat controls in both inspector states. Evidence: the capability inventory explicitly retains urgent running/needs/error cues. This is reversible.
- Render the same lane-strip template in each deferred placeholder, replacing it with the inspector-projected strip when loading completes. This preserves exactly one selector immediately while retaining deferred inspector bodies. Alternative: eagerly render or maintain a loaded flag. Existing `@defer` branches and projection contract support the smaller placeholder fix. Reversible.
- Reuse cost/duration display formatters for accessible text, retaining small-cost precision and estimate/subtotal provenance. Alternative: independently round or expose raw values. Existing formatters define display precision; regression cases cover zero, tiny costs and singular/plural duration units. Reversible.

## Not done

Verification is not passing. Remaining failures from the final retry:

- `stats-limit-view-model.spec.ts`: the at-limit warning fixture expects `At limit · 1 of 3 runs (sonnet)` but receives `Near limit · 1 of 3 runs (sonnet)`.
- `plan-limit-tile.component.spec.ts:185`: a status-only tile expects a disabled trigger but receives an enabled trigger.
- `canvas-inspector-dock.component.spec.ts:144`: both dock and sheet deferred-placeholder tests cannot find the lane selector inside the skeleton.
- `canvas-rail-board.component.spec.ts`: the pane-entrance source assertion no longer matches the expected CSS declaration after extraction.
- `canvas-rail-board.component.spec.ts:1024`: expansion expects exactly one selector before deferred completion and receives zero.
- The chat lint task still fails; it must be resolved before acceptance.

No third verification run was started, respecting the explicit retry limit. Work stops near the tool-call ceiling with these failures unresolved. No verification process remains running. No build, serve, e2e, screenshots, cross-host runtime verification or git operations were run. The existing typechecks provide compile evidence only, not host behavior parity.

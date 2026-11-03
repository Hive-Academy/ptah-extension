# B1c Narrow Layout Fix Report

## Verdict

BLOCKED ON OUT-OF-SCOPE FILE. The 400px clipping does not start in onboarding code. It comes
from the Electron shell's chat/surface host, which has a hard `min-w-[400px]`. That host sits
beside a 32px "Workspaces" tab and a 32px "Git" tab. At a 400px viewport, the onboarding shell
therefore gets a 400px box that starts at x=32, and the body's `overflow-hidden` cuts it off.
The fix belongs in `libs/frontend/chat`, which this lane must not edit. No onboarding source
change is required or useful: nothing inside a 400px-wide parent can make that parent narrower.
No source files were edited.

Skill: `angular-frontend-patterns` loaded successfully in this lane (no denial).

## Root Cause (file:line)

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:445`:
  the `#configurationSurfaceHost` div wrapping `<ptah-app-shell>` has
  `class="flex-1 min-h-0 min-w-[400px] overflow-hidden ..."`. The onboarding route renders
  through `<ptah-app-shell>`'s outlet
  (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:84-86`), so it
  inherits this box whenever a workspace is open.
- Its flex siblings in `.electron-shell-body` (`electron-shell.component.ts:420`,
  `flex ... overflow-hidden`) are two `ptah-sidebar-tab`s at `w-8` = 32px each
  (`libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:63`) at lines 431 and 491.
  Minimum row width is 32 + 400 + 32 = 464px. At 400px the row overflows by 64px. The
  `overflow-hidden` on line 420 hides that overflow instead of shrinking the row.
- Screenshot evidence matches. Onboarding content starts at x≈46 (32px tab plus the shell's
  14px `max-[720px]:px-3.5`) and runs to x≈418, so about 18px of content plus padding falls
  past 400. The right-hand "Git" tab is missing from both narrow captures because it sits at
  x=432-464.
- The onboarding shell's `overflow-x-hidden`
  (`libs/frontend/onboarding/src/lib/shell/onboarding-shell.component.ts:30`) is not involved.
  The shell is exactly as wide as its 400px parent. Its content does not overflow the shell.
  The parent itself is wider than the viewport.
- The prototype (`prototype/screenshots/v2-get-ready-missing-narrow-glass-light.png`) has no
  side tabs and no 400px host minimum. That is why it wraps correctly.
- In the no-workspace branch (`electron-shell.component.ts:417`,
  `flex-1 min-h-0 overflow-hidden`, no min-width), onboarding would not clip.

Onboarding-owned candidates checked and cleared (none constrain width):
- `ready-claude-step.page.ts:129` / `ready-settings-step.page.ts:90`: the heading row is
  `flex`. The `h1` wraps by word, and the icon is `flex-none` at 38-44px.
- `ready-claude-step.page.ts:188`: the facts `dl` switches to Tailwind `grid-cols-1`
  (`minmax(0,1fr)`) at ≤480px. The path `dd` has `min-w-0 break-all`.
- `ready-claude-step.page.ts:299`: the OS tabpanel is `grid gap-2`. Its items are
  `ptah-command-copy-row` blocks, whose min-content is a single character.
- `command-copy-row.component.ts:33`: `<code>` is `min-w-0 flex-1 whitespace-pre-wrap
  break-all`, and the row turns into `flex-col` at ≤480px. Long commands wrap inside their own
  box.
- `ready-strip.component.ts:81`: the strip is `flex flex-wrap`, and non-current labels become
  `sr-only` at ≤720px.
- `claude-readiness-banner.component.ts:69`: the banner is `flex-wrap`, turns into `flex-col`
  at ≤480px, and its text is `min-w-0 flex-1`.
- The `ready-settings-step.page.ts:230,239` footers turn into `flex-col` / `grid-cols-1` at
  ≤480px.

## Edits

None. No file under `libs/frontend/onboarding/src/lib/` needed a change for this defect, and
the causal file is outside this lane's scope. The only write was this report.

## Verification

Command (from the worktree):
`npm run verify -- -p @ptah-extension/onboarding 2>&1 | tail -40`

Result: see the "Verification result" addendum at the end of this file. No source changed, so
this run only confirms the existing specs. It does not check a fix.

## Decisions

- **Make no compensating CSS change in onboarding.**
  - Options considered: (a) no onboarding change; (b) a negative margin or
    `calc(100vw - …)` width on the onboarding shell to escape the parent;
    (c) `flex-wrap` on the OS tablist as hardening.
  - Evidence: the parent box is 400px wide by `electron-shell.component.ts:445`. A child can
    only escape it with viewport-coupled hacks. Such hacks would break at 720px and 1280px,
    where the side tabs and the git dock change the parent's width (acceptance criterion 2).
    Option (c) does not address the clipping.
  - Reversible: yes. No code changed.
- **Report rather than edit `libs/frontend/chat`.**
  - Options considered: edit line 445, or report it.
  - Evidence: the brief forbids touching `libs/frontend/chat`, and a concurrent Codex lane is
    working in that library.
  - Reversible: yes.

## Clarifications Needed

1. **Change the surface host minimum at `electron-shell.component.ts:445` (owner of
   libs/frontend/chat).**
   - Options:
     - **(Recommended)** Replace `min-w-[400px]` with a minimum that can shrink, for example
       `min-w-[min(400px,calc(100vw-4rem))]` (4rem = the two 32px side tabs). At 720px and
       1280px it still resolves to 400px, so the chat and git-dock layout at those widths
       does not change. Below 464px it gives way, and the onboarding column wraps as in the
       prototype.
     - Use a breakpoint variant such as `max-[464px]:min-w-0`. The effect is the same, but
       the threshold is hard-coded.
     - Use `min-w-0` everywhere. This is simplest, but it drops the protection that stops the
       chat panel from being squeezed by an open git dock at all widths. Not recommended
       without a chat-layout review.
   - The change affects every routed surface in the 3-panel branch (chat, settings,
     marketplace and others), not only onboarding. It needs a spec check in the chat lib
     (look for an existing electron-shell spec that pins the class) and a recapture of the
     narrow onboarding screenshots.
2. **Is a 400px viewport a real Electron state?** `apps/ptah-electron/src/windows/main-window.ts:125`
   sets the BrowserWindow `minWidth: 800`. In Electron, the onboarding surface is narrower
   than 464px only when the git dock is open: 800 − 64 − ≥300 dock − resize handle ≈ ≤436px.
   In that case the dock's own `min-w-[300px]` competes with the 400px host. The harness
   400x800 viewport (`onboarding-ready-visual.e2e.spec.ts:45`) cannot occur in Electron
   without a dock. Decide whether the acceptance target is "400px window" or "narrow surface
   beside an open dock". The recommended fix covers the first. The second also needs a
   decision on how the dock and the surface share space.

## Limitations

- The clipping is unchanged until the chat-lib change lands.
- No browser or Electron run (forbidden). The root cause comes from source and screenshot
  geometry, not from a live DOM measurement.
- Once the parent is fixed, the inner width at 400px is 400 − 64 (tabs) − 28 (shell padding)
  − 34 (panel padding and border) ≈ 274px. The stage-1 OS tablist ("macOS / Linux | Windows |
  npm", about 278px in the capture) will be about 4px too wide. Its flex items will shrink,
  and "macOS / Linux" will wrap to two lines inside its pill. That is not clipping, but it may
  look tight. A follow-up could reduce the tab padding at ≤480px. It is not done here because
  it does not affect the defect.
- The stage-2 embedded `ptah-providers-settings` content comes from libs/frontend/chat. Its
  own min widths at about 274px are unverified until a recapture.

## Verification result (addendum)

`npm run verify -- -p @ptah-extension/onboarding 2>&1 | tail -40` (queue noise filtered):

```
[verify 2026-10-30T00:42:34.967Z] lock slot 1 acquired after 677s: verify lint,test,typecheck (@ptah-extension/onboarding)
 NX   3 tasks: 3 succeeded
  Run duration:      1m 9s
  Cache:             0/3 hit (0%)
[verify 2026-10-30T00:43:58.155Z] lock released after 83.2s, exit code 0
```

lint, test and typecheck all pass for `@ptah-extension/onboarding` on the current worktree.
Because no source changed, this shows only that nothing regressed. It does not confirm the
clipping is fixed, which needs the chat-lib change and a recapture.

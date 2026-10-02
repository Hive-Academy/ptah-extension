# Visual Review B7 - Round 1 re-check (TASK_2026_584)

## Verdict: APPROVED (score 8/10)

Findings 1-5 are FIXED. One new moderate defect and two minor leftovers remain; none block the commit.
Finding 6 is out of scope (TASK_2026_590) and was not re-checked.

## Environment

- Rebuilt only the webview bundle from the task-584 worktree: `NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx build ptah-extension-webview --configuration=development --output-path=D:/tmp/vr584/after --skip-nx-cache` (exit 0; no B6 code was built). No throwaway worktree was created this round (none left from round 0; `git worktree list` shows no `_vr` entry). No source or git state was changed.
- Same technique and host as round 0 (VS Code-style host, `activeWorkspacePath` = null, confirmed by probe: `late-active-path` = null), themes `anubis` / `anubis-light`, widths 360, 800, 1000, 1400. Round 0 "before" shots were reused, none retaken.
- Scripts: `visual-b7/r1/harness/` (`lib.mjs`, `r1.mjs`, `r1b.mjs`). New shots: `visual-b7/r1/` (all paths below are relative to it). The harness responder gained an `__error` option so a mocked RPC can fail once.

## Finding status

| #   | Finding (round 0)                                       | Status                        | Evidence                                                                            |
| --- | ------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Late tab empty on first activation, null workspace path | FIXED                         | `s4-late-dark-first-activation-1400.png`, `s4-late-light-first-activation-1400.png` |
| 2   | Light-theme badge contrast and focus ring               | FIXED (two leftovers, see N2) | `s5-focus-badge-{dark,light}-tab-key-1400.png`, contrast table below                |
| 3   | Badge read as the parent's, 14px target                 | FIXED                         | `s1-tabbar-{dark,light}-after-1400.png`                                             |
| 4   | Parent-gone badge indistinct, native tooltip only       | FIXED                         | `s2-tooltip-{hover,focus}-{parent,gone}-{dark,light}-1400.png`                      |
| 5   | Banner duplicated text, tall at 360, CLS                | FIXED                         | `s3-banner-*`, `s6-page-*`, CLS table below                                         |

### 1. Late-tab history (FIXED)

With `activeWorkspacePath` null, first activation of the late tab now sends `chat:resume`, `session:load`, `chat:resume`
(about 60-125ms after the click) and the tab holds 2 messages: "Write unit tests for the auth module." and the assistant reply, under the
banner (`late-msgs` = 2 in both themes; round 0 was 0 messages with the welcome screen). Re-activation sends no further load.
Retry: with `session:load` failing on its first call, activation 1 leaves 0 messages and sends 1 `session:load`; activation 2 sends a second
`session:load` and the tab has 2 messages; activation 3 sends none (`retry-activation1/2/3`, dark and light identical). Retry fires once and does not loop.
Shots: `s4-retry-{dark,light}-after-failed-first-load-1400.png` (empty) and `...-after-second-activation-1400.png` (loaded).
Still true from round 0 (not a visual issue): two `chat:resume` calls go out on first activation (the existing restored-session refresh and the new loader).

### 2. Contrast and focus (FIXED)

Measured the same way as round 0 (canvas-composited, alpha-aware), dark / light:

| Element                               | Round 0 dark / light            | Now dark / light                    |
| ------------------------------------- | ------------------------------- | ----------------------------------- |
| Badge text                            | 5.04 / 2.59                     | 13.74 / 15.15                       |
| Badge border                          | 5.04 / 1.24                     | 4.66 / 1.23                         |
| Badge icon                            | n/a                             | 4.66 / 2.47                         |
| Badge focus ring (real Tab key, gold) | dark info ring 5.04, light 2.59 | 8.57 / 3.88 (2px solid, 2px offset) |
| Banner heading                        | 5.07 / 14.46                    | 5.07 / 14.46                        |
| Banner paragraph                      | 5.07 / 4.56                     | 5.07 / 4.56                         |
| "Open parent"                         | 14.17 / 14.46                   | 14.17 / 14.46                       |
| Banner icon (muted)                   | 4.81 / 2.36                     | 5.07 / 4.56                         |
| Tooltip text                          | n/a                             | 13.89 (dark)                        |

Text, focus ring and banner icon now pass AA in both themes. Leftovers are in N2 (light-theme badge border and icon).

### 3. Badge placement (FIXED)

The badge is inside the child's `ptah-tab-item`, before the title (`badge-inside-tab-item` true; tab text reads "agent Agent: add auth tests"), so it is clearly the child's.
Size is still 46 x 14px (spacing exception applies; 44px guidance not met). Live push: layout-shift 0.0013 + 0.0010, parent stays active, no banner for the parent.

### 4. Parent-gone and tooltip (FIXED)

- Parent gone: `cursor: default`, `opacity: 0.6`, `aria-disabled="true"`, no native `title`. Click is a no-op (banner count unchanged). Visibly dimmer in `s2-tooltip-hover-gone-*`.
- Tooltip bubble captured (first time) on hover and on keyboard focus, both variants, both themes. Content: "Started by Parent: refactor auth / feat/agent-auth-tests / …\.worktrees\feat-agent-auth-tests"; gone variant: "Started by an agent session (parent tab closed) / ...". Path is the last two segments.
- `aria-describedby` = the tooltip id while shown; `role="tooltip"`; closes on mouse leave, on blur and on Escape (`tooltip-escape` count 0). Not clipped by the tab strip (fixed position, 242-264px wide, below the badge).
- Real Tab-key focus reaches the badge (7th stop) and shows the tooltip plus the gold ring (`s5-focus-badge-*-tab-key-1400.png`).

### 5. Banner (FIXED)

- Text no longer repeats "Started by": heading "Started by "Parent: refactor auth"" then "Via ptah_session_start on branch ... You can type here. Runs unattended: ..." (`s3-banner-*`).
- Below `sm` the policy text is in a closed `<details>` ("How this session runs"); banner heights: 360px = 113 closed, 193 open (was 165 always open); 800/1000 = 89; 1400 = 74. No document or banner overflow at any width (docScroll equals viewport). Shots: `s6-page-{dark,light}-360.png`, `s6-page-{dark,light}-360-details-open.png`.
- CLS on first display with the child tab active (round 0 in brackets):

| Width | CLS now dark / light | Round 0       |
| ----- | -------------------- | ------------- |
| 360   | 0.014 / 0.016        | 0.117 + 0.044 |
| 800   | 0.0068 / 0.0069      | 0.117         |
| 1000  | 0.022 / 0.022        | 0.004         |
| 1400  | 0.0031 / 0.0032      | below 0.004   |

All under 0.1. 1000px is higher than round 0 (0.022 against 0.004) but well inside the limit.

## New and remaining items

| #   | Severity       | Item                                                                                                                                                                                                                                                                                                                                                                                                                       | File:line                                                                                                                                                        |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Moderate (new) | The badge now takes about 54px of the 200px max tab width, so the child's title truncates to "Agent: add ..." (`s1-tabbar-*-after-1400`, `s4-late-*-first-activation-1400`), hiding the distinguishing part of the title. The full title is still in the `title` attribute at `tab-item.component.ts:58`. Consider showing only the icon (keep `aria-label`) or raising the tab max width when a leading badge is present. | `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts:39,55-58`, `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:108-135` |
| N2  | Minor          | Light theme: badge border 1.23:1 (the `border-info` is overridden to a faint tone by `badge-outline`) and badge icon 2.47:1 (`text-info`). Text and ring pass, the badge is identifiable by its text, so this is not a failure; an icon-only badge (N1 option) would need the icon at 3:1.                                                                                                                                 | `tab-bar.component.ts:110,131`                                                                                                                                   |
| N3  | Minor          | Badge is 46 x 14px (meets 2.5.8 only via the spacing exception; below 44px guidance).                                                                                                                                                                                                                                                                                                                                      | `tab-bar.component.ts:110`                                                                                                                                       |

Left as is from round 0 and out of scope: finding 6 (tab strip 8px wide at 360 and 800, filed as TASK_2026_590), banner border 1.78 / 1.49 (decorative container), the Thoth hint toast, and the double `chat:resume`.

## Re-check list

| Required check                                                           | Result                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| Late tab loads history with `activeWorkspacePath` null                   | Yes, 2 messages, both themes                  |
| Retry fires                                                              | Yes, once, on the next activation; no loop    |
| Badge/banner contrast, light and dark                                    | Re-measured; text and ring pass, N2 leftovers |
| Badge inside tab item                                                    | Yes                                           |
| Parent-gone styling                                                      | opacity 0.6, cursor default                   |
| Tooltip bubble, hover, focus, aria-describedby, Escape, two-segment path | All captured and verified                     |
| Banner dedupe, `<details>` below `sm`                                    | Yes                                           |
| CLS at 360/800/1000/1400                                                 | 0.016 max at 360, 0.022 max overall           |

Confidence: MEDIUM-HIGH (real built bundle, mocked RPC, VS Code-style host; no real host run, so batch 9 smoke S1b should still confirm under VS Code).

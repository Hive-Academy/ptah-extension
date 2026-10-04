# Visual baseline ("before") - canvas-render-followups

Base build: `D:\projects\ptah-extension\.claude-worktrees\canvas-tile-leaks` at HEAD 5c329bbea (PR #645). The tree was clean (`git status` showed only the untracked `.ptah/specs/canvas-tile-leaks/visual/`). The chat-view TS2554 patch was not needed and no source was edited. I rebuilt it first:
`NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true npx nx build-dev ptah-electron` followed by `npx nx copy-renderer-dev ptah-electron` (both exited 0).

Output: `.ptah/specs/canvas-render-followups/visual/before/` (296 files). Each name is `<scenario>-<dark|light>-<1440x900|900x800>.png`, with `.json` for data and `_notes-*.txt` for per-run notes.

## Harness
Same Playwright-Electron harness as the previous baseline, with RPC fully mocked (see `canvas-tile-leaks/visual-baseline.md`). The renderer is the real built Angular app. Themes are `anubis` and `anubis-light`, animations and transitions are frozen by injected CSS, and the window is set with `setContentSize`. Scripts live outside the source tree in `D:\projects\ptah-extension\tmp\visual-capture\`:
- `capture.spec.ts` + `playwright.config.ts`: the existing scenarios, unchanged from the earlier "after" run (00 to 08, 99). Scenario names are unprefixed.
- `followups.spec.ts` + `playwright.followups.config.ts`: the new scenarios, with files prefixed `fa-` to `ff-` so they never collide.

Run both against a build with:
```
cd D:\projects\ptah-extension\tmp\visual-capture
PTAH_BASE='D:\projects\ptah-extension\.claude-worktrees\canvas-render-followups' PTAH_OUT='...\canvas-render-followups\.ptah\specs\canvas-render-followups\visual\after' npx playwright test --config=playwright.config.ts
(same env) npx playwright test --config=playwright.followups.config.ts
# optional: PTAH_ONLY=dark-1440x900
```
Before running on the after build, build `canvas-render-followups` the same way. The first Electron launch is occasionally flaky, which is why `retries: 1` is set; one dark-900 run did retry and then passed. Make sure the window really reports 1440x900 (the `VIEWPORT` log line); the earlier harness sometimes produced a 1184x735 window on light-1440.

## New scenarios
The follow-up spec uses two seeded sessions, "Followup long" (36 Q/A turns, about 12k px tall) and "Followup agents", both opened as tiles. The long tile is focused first; the agents tile stays unfocused.

| Prefix | Scenario | Files / data |
|---|---|---|
| (a) `fa-` | Two tiles. Live-pushed running rows: a Bash tool in the long tile (focused, blue ring); a Grep tool plus a running `researcher-expert` Task agent bubble in the agents tile (unfocused). Spinners are visible, though animation is frozen. | `fa-two-tiles-window`, `fa-tile-long`, `fa-tile-agents`, `fa-running-counts-*.json` (spinner counts, focus state) |
| (b) `fb-` | Long-transcript scroll: top, middle, bottom, a fast scroll (6 `scrollTop` jumps 30ms apart, immediate and after 800ms), and a jump top-to-bottom. | `fb-scroll-{top,middle,bottom,fast-immediate,fast-settled,jump-bottom}`, `fb-scroll-*.json` (scrollTop, scrollHeight and clientHeight at each stop) |
| (c) `fc-` | Hover on an assistant message (copy button) and on a user message (branch/rewind). Keyboard focus: Shift+Tab 16 stops from the chat input, then Tab 16 stops forward from there. | `fc-hover-assistant`, `fc-hover-user`, `fc-focus-back{1,2,3,+Branch/Rewind stops}`, `fc-focus-fwd{...}`, `fc-taborder-*.json` (each stop's tag, aria-label, host component, outline, box-shadow and opacity) |
| (d) `fd-` | A turn with 7 collapsed tool rows (4 Read, Grep, Bash, Edit), in both themes. | `fd-toolrows-tile`, `fd-toolrows-window`, `fd-rowcounts-*.json` (per row `querySelectorAll('*').length` and row height, plus the tile total) |
| (e) `fe-` | Inline agent bubble reply textarea after toggling "Message agent": empty, 1 line, 3 lines, 8 lines (capped) and the 8-line scrolled state. | `fe-reply-{empty,1line,3lines,8lines-capped,8lines-scrolled}`, `fe-reply-geometry-*.json` (clientHeight, scrollHeight) |
| (f) `ff-` | Focus switch: before (long focused), after clicking the long tile's composer, then after clicking the agents tile's composer, with a shot of each tile. | `ff-before-switch-*`, `ff-after-focus-long-*`, `ff-after-focus-agents-*`, `ff-focus-*.json` (data-focused and ring state) |

## Baseline measurements (to compare on the after build)
- **Tool rows (d):** the elementCount per row is 28 for Read, 29 for Edit, and 21 for Grep and Bash. Every row is 43px tall. The tile has about 858 elements in total (dark 1440).
- **Reply textarea (e), dark 1440 and 900:** empty clientHeight is 34. One line is 32 (scrollHeight 34). Three lines is 68 (scrollHeight 70). Eight lines is capped at 70 (scrollHeight 159). The pre-change cap is 72px, so after the change check that the cap and resting height are unchanged.
- **Scroll (b):** `scrollHeight` is not stable. For example, in dark 1440 it grows from 11032 at the top to 12027 after the first scroll to the middle, and 12082 after the fast scroll. This comes from lazy or estimated row heights. It is the number to watch for scroll stability. After the fast scroll, `scrollTop` settled exactly where the last jump put it (4057 in dark 1440).
- **Tab order (c):** from the chat input, Shift+Tab visits the assistant "Copy message" button, then the 7 tool-row buttons (in reverse), then the message "Collapse message", user "Branch conversation from this message" and "Copy message". The user "Rewind" button is a disabled button and is skipped. Forward Tab is the exact reverse. The toolbars sit at `opacity-0 group-hover:opacity-100`, so a keyboard-focused button may have a visible ring while its container stays invisible. The `fc-focus-*` shots and the JSON `parentOpacity` field show this.
- **Focus (a, f):** the long tile has `data-focused="true"` and the `ring-primary` ring, and the agents tile has `false`. After clicking the agents tile's composer, they swap.

## Caveats
- The running rows are produced by live-pushed `chat:chunk` events (message_start, tool_start without a result, Task tool_start plus agent_start). The agent bubble reads "Streaming", and its elapsed or "Starting agent execution" text may vary. Mask the bubble header and body when diffing.
- The usual noise applies (see the earlier review): the sidebar timestamp region and hover-dependent regions can differ between identical runs. The earlier "after" results for scenarios 00 to 08 are the reference for what is stable.
- The VS Code single-chat layout is not reachable, and neither are native tooltips (same as before).

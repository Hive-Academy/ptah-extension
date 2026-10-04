# MONITOR_BG_ONLY AFTER evidence

Source: worktree `.claude-worktrees/monitor-panel-background-only`, branch fix/monitor-panel-background-agents-only,
HEAD c179f3eb5 + uncommitted working-tree change (agent-monitor.store.ts, plus specs).
Same Electron dev build + Playwright harness and SAME injected events as BEFORE (harness copied unchanged from
../before/harness, no mock changes). Window 1600x950, Orchestra Canvas, AGENTS rail open, dark (`anubis`) and light (`anubis-light`).

## Method
1. `NX_DAEMON=false npx nx build-dev ptah-electron --skip-nx-cache` then `copy-renderer-dev` (fresh bundle of the working tree).
   Note: the first build-dev attempt failed with an Nx js-plugin worker load timeout (environment, not code);
   re-run with `NX_PLUGIN_NO_TIMEOUTS=true` succeeded.
2. Copied harness into apps/ptah-electron-e2e, ran `playwright test -c evidence-monitor-bg.config.ts`
   with EVIDENCE_OUT=.../evidence/after, EVIDENCE_COMMIT=c179f3eb5+working-tree. 1 passed (22s).
3. Removed the copied harness files (src/evidence-monitor-bg/, evidence-monitor-bg.config.ts). dist/ left in place.

## Before/after comparison
| Item | BEFORE (c179f3eb5) | AFTER (working tree) |
|---|---|---|
| Panel header total badge | 3 | 2 |
| Chips listed in panel | Codex, fg-reviewer, bg-watcher | Codex, bg-watcher |
| fg-reviewer in panel | listed | not listed |
| fg-reviewer inline in chat tile | yes (Streaming card) | yes (Streaming card, unchanged) |
| bg-watcher in panel | listed | listed |
| bg-watcher inline in chat tile | yes, "Background" badge | yes, "Background" badge |
| Codex CLI lane | listed, running | listed, running |
| facts.json chatTextHasFgDesc / BgDesc | true / true | true / true |
| canvasTiles | 1 | 1 |

File pairs (before/ vs after/): monitor-panel-dark.png, monitor-panel-light.png (panel element),
monitor-panel-window-dark.png, monitor-panel-window-light.png (full window), facts.json.

Result matches expectation: total 2; fg-reviewer removed from panel only; inline rendering of both subagents intact.

## Not captured / caveats
- The fg-reviewer/bg-watcher detail panes were not opened (not in BEFORE either).
- Window screenshots were visually inspected for dark window and light panel; light window not eyeballed
  individually but its facts.json matches dark.
- Mocked data; light theme via data-theme attribute, not ThemeService. Banner text in chat tile ("1 background · 1 foreground · 2 running")
  is inline-chat UI, unchanged by design.

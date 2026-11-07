# Findings — lane restore and Electron main-process errors

Branch `fix/lane-restore-and-main-exceptions`. Detailed lane notes:
`issue1-notes.md`, `issue2-notes.md`; review: `code-logic-review.md`.

## Issue 1 — an interrupted CLI lane looked like a plain stop

### Root cause

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  `restoreAgents` (~1627-1661) mapped a persisted `running` reference to
  `stopped` with no `exitCode`, no `completedAt` and no reason.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:468-483` does
  not persist output while a lane runs, so the restored record had 0 lines.
- The manager gave the resume gate `completedAt ?? startedAt` (~650). Without
  `completedAt` the gate measured idle time from the start, and
  `lane-resume-gate.ts` (~263) chose `fresh` at more than 600 s
  ("idle 3619s exceeds 600s").
- The inactivity watchdog stamps `timeout` (~2729-2763), and an explicit
  `stop()` stamps `completedAt`. Neither matches the observed record.
- Host logs: no Electron lifecycle log for the incident was found under
  `C:\Users\abdal\.ptah`. The host restart is inferred from code and the
  observed state, not proven by a log.

### Changes

- `libs/shared/src/lib/types/agent-process.types.ts`: `LaneStopReason` adds
  `'host-restart'`. `CliSessionReference` can persist `stopReason`.
- `agent-process-manager.service.ts`: a restored `running` reference becomes
  `stopped` with `stopReason: 'host-restart'` and `completedAt` = restore time.
  Other references keep their persisted `completedAt` and `stopReason`. The
  resume gate gets `interruptedByHostRestart` only when the latest lane record
  has the marker and the same CLI session id as `resume_session_id`.
- `lane-resume-gate.ts`: a marked interruption skips only the 600 s idle rule.
  The context-size rule still applies. Lanes that went idle or completed keep
  the 600 s rule.
- `agent-events.ts`: the session reference writes `stopReason`.
- `libs/frontend/chat/.../agent-card-header.component.ts`: label
  "Interrupted by host restart".
- Specs: `agent-process-manager.restore.spec.ts`,
  `agent-process-manager.service.spec.ts`, `lane-resume-gate.spec.ts`,
  `agent-card-header.component.spec.ts`.

### Decision — periodic output persistence

Not implemented. A throttled tail snapshot would keep some live text after a
restart. It adds disk writes for every active lane, needs a size cap,
throttling and cleanup, and can show stale text after a crash. The resume
path now keeps the context in the CLI session, which removes most of the need.
Follow-up item.

## Issue 2 — native "A JavaScript error occurred in the main process" dialog

### Root cause

- The stack frame `eval at evaluate (:311:30)` matches Playwright's injected
  utility script (`electronApp.evaluate`). No Ptah frame is in the stack.
- Strongest in-repository candidate:
  `apps/ptah-electron-e2e/src/support/rpc-bridge.ts` (main ~142-182).
  `waitForRendererMessage` runs in the main process through `app.evaluate`. Its
  `setTimeout` callback wrote `patchable.send = originalSend` on the window's
  `webContents` with no destroyed check and no cleanup on window close.
  `sendRpc` (~61-100) patched `webContents.send` the same way.
- Other `evaluate` callers with timers were checked:
  `electron-browser-capabilities.spec.ts:195` (Notification, guarded by
  try/catch), `measure-boot-rpcs.mjs:179` (does not touch a window).
- Ptah main-process timers: `boot-progress-publisher.ts` checks
  `liveContents`. `electron-platform-commands.ts` reloaded the focused window
  after a delay with no destroyed check (fixed).
- `apps/ptah-electron/src/activation/boot-trace.ts` removes its handlers at
  renderer load. After that, any stray exception gets Electron's default
  handler, which is the native modal.

### Changes

- New `apps/ptah-electron/src/activation/main-process-error-guard.ts` (+ spec):
  after boot, `uncaughtException` and `unhandledRejection` are logged through
  the injected `Logger` and sent to `SentryService.captureException`. No modal,
  no exit. `installMainProcessErrorGuardFrom` never throws. It reports through
  `reportBootFailure` when the container or a service is missing.
- `boot-trace.ts` (+ spec): new `onGoal` hand-off, called after the boot
  handlers are removed. Boot behaviour is unchanged: an exception during boot
  is logged and still exits.
- `apps/ptah-electron/src/main.ts`: installs the guard from `onGoal`.
- `electron-platform-commands.ts` (+ reload spec): `isDestroyed()` guards on
  the window and `webContents` before the delayed reload.
- `apps/ptah-electron-e2e/src/support/rpc-bridge.ts`: both evaluate helpers
  clear their timer, remove the `closed` listener and restore `send` only while
  the window is alive. They reject at once when the window closes.

### Decision — which errors stay fatal

During boot: fatal (unchanged boot-trace policy). After renderer load: not
fatal, logged and reported. Reason: a late error after boot is almost always a
stale callback, such as this one. A blocking modal gives the user no recovery
and loses the session. Reversible: add an allowlist of fatal error types to
the guard if a real corrupt-state case appears.

## Verify results

`node_modules` was missing in the worktree. A junction to the main checkout's
`node_modules` was added (git-ignored) so that Jest can resolve `marked` and
`electron`.

- `npm run verify -- -p cli-agent-runtime,shared,chat,ptah-electron,ptah-electron-e2e`:
  lint and typecheck passed for all. Tests passed for `shared` and `chat`.
  Tests for `cli-agent-runtime` had 7 failed of 2915, and `ptah-electron` had
  1 failed of 1663. All failures are in specs that this diff does not touch:
  - `mcp-directory/mcp-install.service.spec.ts` (6 cases, scoped intent).
  - The ptah-cli "pinned SDK version" spec: expected 0.3.318, got 0.3.278. The
    main checkout's `node_modules` is older than the lockfile.
  - The phase-2 plugin-config harness-root spec: the worktree is inside the
    main checkout, so the harness root is found from a sub-folder.
  These come from the shared `node_modules` and the worktree path. CI runs
  them on a clean install.
- After the review fix: `npm run verify -- -p ptah-electron -t lint,typecheck`
  passed, and `npm run verify -- -p ptah-electron -- --testPathPatterns=...`
  (guard, boot-trace, platform-commands specs): the first run had 1 failed
  of 23 (a wrong stderr assertion in the new spec). After that fix, all
  passed.
- `npm run verify -- -p ptah-electron,ptah-electron-e2e -t lint,typecheck`:
  4 of 4 passed.

## Review

The Codex lanes implemented both issues. Independent vendor lanes were not
available (OpenCode, Grok, Antigravity, Kimi and GLM were at their limits or
failed to start). The orchestrator (Claude) did the logic review. This is
weaker evidence. One major defect was found and fixed (see
`code-logic-review.md`).

## Open questions

1. Confirm the host restart from a real log the next time it happens. The
   restore path now logs the marker on the record.
2. Should the `host-restart` resume bypass have an age cap (for example 24 h)?
   It currently has none and is gated by the marker and the session id.
3. The exact external injector of the dialog in the incident is not proven.
   Another automation tool (for example a Playwright MCP that drives Ptah) can
   produce the same frame. The post-boot guard removes the modal in all cases.
4. Possible duplicate Sentry events when `@sentry/electron` also captures
   uncaught exceptions.

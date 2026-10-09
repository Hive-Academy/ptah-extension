# Phase 6 — Zoneless change detection

## Summary

The webview now selects `provideZonelessChangeDetection()` by default. The
temporary, bootstrap-only Zone fallback preserves the exact previous provider
options and uses the existing host-injected `window.ptahConfig` seam; no RPC or
post-bootstrap configuration path was added. The audit found that the listed
asynchronous UI paths already either write signals (which schedule zoneless
views) or perform DOM-only layout/scroll work. No behavioural rewrite was
needed.

## Changed files

- `apps/ptah-extension-webview/src/app/app.config.ts`
- `apps/ptah-extension-webview/src/app/zone-change-detection.ts` (new)
- `apps/ptah-extension-webview/src/app/zone-change-detection.spec.ts` (new)
- `apps/ptah-extension-webview/src/main.ts`
- `libs/frontend/core/src/lib/services/vscode.service.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/overview-tab.component.spec.ts`
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts`
- `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts`
- `apps/ptah-extension-vscode/package.json`
- `apps/ptah-electron/src/activation/startup-config-ipc.ts`
- `apps/ptah-electron/src/activation/startup-config-ipc.spec.ts`
- `apps/ptah-electron/src/preload.ts`
- `.ptah/specs/TASK_2026_STREAMING_ARCH/phase-6-report.md`

## Fallback flag

Name: `window.ptahConfig.zoneChangeDetectionFallback`.

It is read by `zone-change-detection.ts` while `app.config.ts` is evaluated,
before Angular bootstraps. Any absent or non-boolean value selects zoneless
mode.

- VS Code: set `ptah.zoneChangeDetectionFallback` to `true` in Settings, then
  reload the Ptah webview. `WebviewHtmlGenerator` reads the `ptah` setting and
  emits a literal boolean in its existing `window.ptahConfig` script.
- Electron: launch with `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1`. The synchronous
  `get-startup-config` responder has no synchronous settings-store seam at
  preload time, so it reads this exact environment value and preload forwards
  only strict boolean `true`.

Every host injection site is marked with
`// TODO(streaming-p6): remove zone fallback flag after one stable release`.

## Audit

| Site (file:line)                                | Mechanism                                                                         | Verdict                                                                                                      | Fix                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `message-router.service.ts:155-245`             | outside-zone message listener/macrotask drain; `run` only for non-signal messages | Safe: FIFO/RPC synchronous-flush order is independent of Zone; signal stream handlers publish reactive state | Existing zoneless ordering and destroy tests retained and run |
| `rpc-call.util.ts:128`                          | RPC timeout                                                                       | Safe: resolves a promise; consumers already publish through their own state boundary                         | None                                                          |
| `chat-transcript.component.ts:787,906-1000`     | finalization timers, rAF scroll and `ResizeObserver`                              | Safe: template-affecting pin/finalization state is signal-backed; frame/observer path is DOM scrolling       | None; existing cleanup cancels frames, timers and observer    |
| `execution-node.component.ts:115-119`           | rAF/fallback timer markdown throttle                                              | Safe: callback writes `_streamingHtml` signal                                                                | Focused spec now supplies zoneless provider                   |
| `inline-agent-bubble.component.ts:755,764,1120` | rAF/observer scroll and toast timer                                               | Safe: scrolling is DOM-only; visible toast state is signal-backed                                            | None                                                          |
| `chat-input.component.ts:772,1151`              | attachment-error and suggestion projection timeouts                               | Safe: both callbacks write component signals                                                                 | Focused spec now supplies zoneless provider                   |
| `overview-tab.component.ts:307-311`             | outside-zone 30-second interval                                                   | Safe: interval writes `now` signal; effect cleans interval                                                   | Focused spec now supplies zoneless provider                   |
| `chat-view.component.ts:425-633`                | drag/resize callbacks using `NgZone.run` and `runOutsideAngular`                  | Safe: downstream panel state is signal/service state; calls are no-ops under zoneless                        | None                                                          |
| `tab-bar.component.ts:395-416`                  | rAF/scroll measurement across `NgZone`                                            | Safe: measurement updates reactive scroll affordance state                                                   | None                                                          |
| `agent-monitor-panel.component.ts:960`          | outside-zone native listener                                                      | Safe: listener schedules existing reactive panel state                                                       | None                                                          |
| `agent-lane-scroll.directive.ts:25`             | outside-zone native scroll listener                                               | Safe: DOM scroll coordination only                                                                           | None                                                          |
| `streaming-quotes.component.ts:103`             | outside-zone animation/listener work                                              | Safe: reactive quote state is signal-backed                                                                  | None                                                          |
| `electron-resize-handle.component.ts:75-94`     | outside-zone pointer events with `run` output                                     | Safe: output reaches Angular listener/signal state; `run` is harmless zoneless                               | None                                                          |
| `compact-session-activity.component.ts`         | `NgZone` async activity handling                                                  | Safe: published activity state is reactive                                                                   | None                                                          |
| `tab-manager.service.ts:2618-2629`              | outside-zone persistence/deferred work                                            | Safe: no plain template field is mutated                                                                     | None                                                          |
| `task-worktree-view.component.ts:747`           | outside-zone PR timer                                                             | Safe: visible state is signal-backed                                                                         | None                                                          |
| `git-dock-header.component.ts:356`              | outside-zone action-clear timer                                                   | Safe: visible action state is reactive                                                                       | None                                                          |
| `editor-launcher.service.ts:229`                | outside-zone clear timer                                                          | Safe: exposed error/status state is signal-backed                                                            | None                                                          |
| `pierre-worker-pool.ts:83-94`                   | outside-zone worker initialization                                                | Safe: worker status is signal-backed                                                                         | None                                                          |
| `marketplace-layout.ts`                         | `NgZone` layout callbacks                                                         | Safe: writes use layout signals                                                                              | None                                                          |

Targeted grep found no `NgZone` use in the webview app itself. Spec-only
matches were excluded from runtime verdicts.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts src/lib/components/molecules/chat-input/chat-input.component.spec.ts src/lib/settings/providers/connection-drawer/overview-tab.component.spec.ts --coverage=false --maxWorkers=2` — passed, 3 suites / 131 tests.
- `npx jest -c apps/ptah-extension-webview/jest.config.ts src/app/zone-change-detection.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 1 test.
- `npx jest -c libs/frontend/core/jest.config.ts src/lib/services/message-router.service.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 28 tests; Angular emitted the expected test-environment warning that Zone.js remains loaded while exercising zoneless TestBed.
- `npx nx typecheck ptah-extension-webview --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/core --parallel=1` — passed (Nx Cloud reported the workspace's disabled organization after the successful target).
- `git diff --check` — passed.

- `npx jest -c apps/ptah-extension-vscode/jest.config.ts src/services/webview-html-generator.initial-view.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 33 tests; proves literal `true` and `false` host emission.
- `npx jest -c apps/ptah-electron/jest.config.ts src/activation/startup-config-ipc.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 10 tests; proves strict `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` handling.
- `npx nx typecheck ptah-extension-vscode --parallel=1` — passed.
- `npx nx typecheck ptah-electron --parallel=1` — passed.

## Decisions

| Decision                                                      | Options                                                           | Evidence                                                                                                                                                                 | Reversible                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Default to zoneless, retain a one-release host flag           | zoneless default; permanently Zone-based; remove Zone immediately | D6 requires a migration/rollback; Angular signal writes schedule zoneless templates                                                                                      | Yes: host sets the boolean flag; delete it after one stable release                      |
| Keep `zone.js` in `project.json` polyfills for this release   | retain polyfill; conditionally load it; remove now                | The Angular build polyfills execute before bootstrap, so retaining it is the safe guarantee that the legacy provider has Zone available. `main.ts` no longer imports it. | Yes: remove the polyfill together with the flag next release after runtime smoke/metrics |
| Do not add `provideCheckNoChangesConfig` to shipped providers | production provider; test-only provider                           | D6 explicitly prohibits shipping exhaustive checking                                                                                                                     | Yes: add only to an isolated migration test configuration if later needed                |
| Electron fallback source                                      | synchronous Electron settings read; environment switch            | The startup IPC handler runs before a container/settings service is guaranteed to exist; `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` is synchronously available and strict   | Yes: replace with a settings-store read if one becomes safe before bootstrap             |

## Not done

- Did not remove the retained `zone.js` build polyfill; it is intentionally deferred until the fallback flag is removed after one stable release.
- Did not add exhaustive no-changes configuration: no shipped provider may include it, and the focused zoneless provider suites cover the audited callback seams.

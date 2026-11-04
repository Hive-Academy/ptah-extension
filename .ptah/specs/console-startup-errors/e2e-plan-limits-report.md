## Root cause

The fixture's two restored CLI runs are completed (`plan-limits.fixtures.ts:418-445`). The chat view requests that the embedded Agents panel open when a session agent is running (`chat-view.component.ts:1571-1588`), so the live `agent-monitor:spawned` pushes supply the condition the click expects.

`apps/ptah-extension-webview/src/main.ts:14-43` moved Angular startup behind dynamic imports and buffered only `boot:readinessChanged`/`boot:progress`. The plan-limits scenario dispatches `LIVE_LANE_MESSAGES` immediately after `page.goto` (`plan-limits-visual.e2e.spec.ts:108-125`); these are `agent-monitor:spawned`, `agent-monitor:output`, and `agent-monitor:exited` (`plan-limits.fixtures.ts:522-558`). `installPostMessageBridge` injects each as a synchronous window `message` event. With asynchronous bootstrap, those pushes can precede construction of `MessageRouterService` (`message-router.service.ts:105-145`) and disappear. The click targets `ptah-canvas-focus-area ptah-agent-monitor-panel button[title="Close panel"]`; that component's `onClose()` emits `closed` for the embedded panel (`agent-monitor-panel.component.ts:275-281,1207-1212`), and its `aside` gets `w-0` when `effectiveOpen()` becomes false (`:214-222,752-754`). Confidence: medium-high based on the deterministic CI failure and direct timing path; no e2e trace or rerun was available.

## Caused by branch / main drift / flake

Branch-caused regression is the strongest explanation. The failure appeared on this branch, affects every theme/width/retry, and main CI is green per supplied evidence. The local object for supplied main `a72fc04bb` exists. `git log 90a634721..a72fc04bb --` the failing spec, its fixture, agent panel and chat view returned no commits; these commits are divergent, so this is a path comparison rather than an ancestry claim. Cached `origin/main` is older (`40b6f0192`); its only related later commit, `5b8a300e2`, changes question-card routing, unrelated to the close button. `git fetch origin main` was attempted but could not write shared worktree `FETCH_HEAD` (permission denied). No evidence points to random flakiness or a Zone-only failure.

## Fix (or why none)

Changed `apps/ptah-extension-webview/src/main.ts` to capture every typed host push during async bootstrap, stop its early delivery, then replay in arrival order after Angular has installed message handlers. `rpc:response` passes through so bootstrap RPC calls can resolve. The default renderer stays zoneless. No host-specific code was added to shared libs.

## CodeRabbit comment

The public PR conversation exposed an earlier CodeRabbit review on commit `05e2949` with three inline comments about usage-analytics paging/ledger limits. It did not expose the requested newest inline comment on `865dfdcbe`; the Files changed page reported failed comment loading, and `gh api` required authentication. Therefore its validity could not be confirmed and no review-only change was made. Public page: https://github.com/Hive-Academy/PtahCode/pull/936

## Verification

Inspected spec, bridge, fixture, panel, router, RPC client, and main comparison. `git diff --check` passed. `ptah_get_diagnostics` could not finish its TypeScript check within 45 seconds on either attempt. Ran `npm run verify -- -p ptah-extension-webview,usage-analytics` once with `NX_DAEMON=false`; it remained queued behind other workspace verification jobs at report time. No e2e, build, serve, package, or install target was run.

## Open risks

The replay timing is inferred without a browser trace; an e2e rerun in CI is needed to confirm the plan-limits variants. Typed `BATCH` envelopes containing RPC responses are currently buffered, although the router documents those as a producer regression. The latest CodeRabbit inline comment remains unassessed until it is accessible.

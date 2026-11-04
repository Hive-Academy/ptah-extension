# Code Logic Review, Phase B (batches 12-16) - TASK_2026_864_1376

Score: 6/10. Verdict: REVISE.

Scope: commits 167f08f3a, 5e7dcd641, f351d3b46, 8453e5162, 58f83c685, read statically. No tests were run (CI verifies, per user decision). The batch 14 sign-in block was read in full except about 36 lines of its template (the `waiting` case head, and the lines before `phase`) that the tool output omitted. The `connection-choice.store.ts` caller was read only for its use of the activate result.

## Findings

1. SERIOUS - `providers-connection-setup.service.ts:278-310` and `:262-265`. The Codex external-auth state is never settled from the sign-in's final state.
   - `codexSignIn.start()` returns once the host has launched the sign-in, because the RPC returns at launch.
   - The code then reads `auth:getAuthStatus` immediately and maps the in-progress status to `signInState: 'in-flight'`.
   - Nothing afterwards turns that into `signed-in`, `failed` or `idle` when the final push arrives. The plan (lines 681-682, Components 8) requires settling from the final state, followed by the existing reread.
   - `externalAuthStore` therefore stays `in-flight` indefinitely for any consumer of `externalAuth`.
   - `sign-in-cancel` returns at `:262-265` without touching the store at all. A cancelled sign-in leaves the store `in-flight`.
   - The `Promise.all([refreshConnections, refreshRoute])` at `:316` also runs right after launch, not after the sign-in ends.
   - Fix: after `start()`, await the service's final state, or add an effect or subscription that writes the store on a final status and then rereads. `sign-in-cancel` must also write the store.

2. SERIOUS - `codex-sign-in.service.ts:113-115`, and the `checking` phase in the block (`codex-sign-in-block.component.ts`). The result of the post-success refresh is dropped.
   - `succeeded` fires `void this.authState.refreshAuthStatus()` and ignores the boolean.
   - The block maps `succeeded` to the `checking` phase ("Ptah is checking your sign-in now...") with a spinner.
   - If the refresh resolves false, the spinner never ends and no retry is offered.
   - The same happens in the credentials tab, where nothing else re-reads.
   - Fix: on `false`, expose a `refreshFailed` signal so the block can show "Signed in, but Ptah could not confirm it. Check again."

3. MODERATE - `chat-view.component.ts:290-294` (`completeCodexReauth`) and the effect at `:1361-1367`. The banner is cleared after a successful read, which is not a confirmed sign-in.
   - `refreshAuthStatus()` resolves true when `auth:getAuthStatus` succeeded, not when Codex is authenticated. It does not check `codexAuthenticated` or `codexTokenStale`.
   - `codexReauthStarted` is set to false before the refresh runs. If the refresh resolves false, the banner stays with no block and no message. If it resolves true but Codex is still stale, the banner is wrongly cleared.
   - Fix: keep `codexReauthStarted` true until the refresh resolves. Clear the banner only when the refreshed Codex state is authenticated and not stale. Show a failure line otherwise.

4. MODERATE - `codex-sign-in.service.ts:50-58` and `:93-97`. There is a gap between a click and the first accepted state.
   - `launch()` resets the state to null on a restart or after a final state, and only a push or the RPC reply moves it forward (up to the 15 s RPC timeout).
   - In that window the block's phase is `ready`. In the `panel` layout the "Sign in with Codex" button is shown again, so a double-click can call `start()` twice.
   - In the `compact` layout the `ready` phase renders an empty bordered box. This is what a banner "Try again" produces.
   - The service should expose a `launching` signal (or set a local `starting` state) so the UI shows the "Starting Codex sign-in..." text immediately.
   - A late response from the first of two overlapping launches is correctly dropped by the generation check at `:61`.

5. MODERATE - `codex-sign-in.service.ts:54`. `previousAttemptId` is overwritten with null when `restart()` is called while the state is already null.
   - A late final push from the attempt before that (for example `cancelled`, or `succeeded` for attempt A) is then accepted as the new attempt's first state.
   - The window is narrow, because the "Try again" button is not visible while the state is null. Programmatic or double restarts can still hit it.
   - Fix: only assign `previousAttemptId` when the current state is non-null, or keep a small set of recently retired ids.

6. MODERATE - `chat-view.component.ts:356-362` and `:368-371`.
   - On a non-Electron host `CodexSignInService` is inert. `onAuthReauth` sets `codexReauthStarted` and returns, so the compact block is empty and the banner button silently does nothing. The old path went to Settings. Fall back to Settings when `!vscode.isElectron`.
   - `onAuthBannerDismiss` resets the started flag but does not cancel a running sign-in. The Codex process keeps running with no visible UI. Call `cancel()` when `codexReauthRunning()` is true.

7. MINOR - `codex-sign-in.service.ts:107-112`. Every accepted push of an equal-rank `running` state without a URL or code clears and restarts the 20 s `nothingSeen` timer. Repeated no-op pushes can keep "waiting-late" from ever appearing. Restart the timer only on a status or content change.

8. MINOR - `main-agent-reassign-popover.component.ts:346-351` still keeps its own `targets` computation. `defaultMainConnectionTarget` duplicates that rule, so the two can drift. Derive both from one helper.

9. NOTE - registration (Component 15). `CodexSignInService` is not yet in the `MESSAGE_HANDLERS` list in `app.config.ts`. `grep` over that file finds no Codex entry. Until Component 15 lands, no `auth:codexLoginStatus` push reaches the service. Only the RPC reply feeds it, and the block never sees `awaiting-user`, a URL or a code from pushes. The batch plan lists this as a later batch. This must not ship without it.

## Required-check results

- **Stale and final states.** A late `succeeded`, or any push for an older attempt, cannot overwrite a newer banner or state.
  - The cases are: a different `attemptId` at `codex-login.ts:20`, a sticky final at `:21`, and the null-state guard against the immediately previous attempt at `codex-sign-in.service.ts:100`.
  - `previousAttemptId` is cleared on the first accepted state, so a later late push is rejected by the `attemptId` mismatch instead. The one hole is finding 5.
- **Timer.** There is a single timer. It is cleared on every `accept`, on a launch reset and on `DestroyRef`.
- **Subscriptions.** The service holds none. The router owns delivery. Finding 9 covers the missing registration.
- **`refreshAuthStatus()`.** It resolves true or false, and a superseded read returns `latestAuthRead` (`auth-state.service.ts:662-664`, `:1265-1305`).
  - Every non-banner caller ignores the boolean or uses it intentionally: `providers-connection-setup.service.ts:652,431`, `workspace-coordinator.service.ts:289`, `provider-readiness.store.ts:72`, `connection-choice.store.ts:51`.
  - The throw-versus-false divergence at `connection-choice.store.ts:51` is harmless.
- **Chat banner.**
  - Cancel and the compact block are gated on `codexReauthStarted`, so only a banner-started `openai-codex` sign-in shows them (`chat-view.component.html:155-163`). That part is correct.
  - Clearing after a confirmed refresh is only partly met (finding 3).
- **Sign-in block.**
  - Links are https only: the parser drops other schemes at `codex-login.ts:48`, and the anchor has `rel="noopener noreferrer"`.
  - The browser-opened message uses `browserOpened === false` explicitly.
  - No raw output or host error text is rendered. Copy is fixed per `errorCode`. The only interpolation is `executablePath`, which comes from the host snapshot via `executableSource` (verify it is not a user path leak; this is acceptable for spawn-failed).
  - `role="alert"` is set only when `failure && role === 'chosen'`.
  - The code has an `aria-label` from `spelledCode()`.
  - I did not find a defect in these.
- **`activateConnection`.**
  - The 310 s `auth:codexLogin` call is gone: Codex now goes through `CodexSignInService`, and only Copilot keeps `auth:copilotLogin`.
  - The result `{started, selectionReread}` is consumed correctly by the popover (`.then((result) => result.started)`) and by `connection-choice.store.ts`.
  - The `providers-settings-state` wrapper passes it through.
  - Two paths ignore `selectionReread: 'failed'`: the popover and the Providers drawer. This matches AC 3.20.
- **`defaultMainConnectionTarget` against the old inline rule.** The two behave the same.
  - Both compute targets as the model write scopes filtered by the effort write scopes, and both return empty or null when sources are not ready.
  - The ordering is the same in both: chosen, then `workspace`, then the model source scope, then `targets[0] ?? null`.
- **Removed `codexLogin()`.** Grep finds no non-spec caller in `libs` or `apps`.
- **Exports.** `index.ts` exports codex-readiness, codex-login, codex-commands, codex-sign-in.service and main-connection-target. I did not verify the chat `index.ts` export of the block beyond the one-line diff in batch 14.

## Five logic questions (short)

1. Silent failure: findings 2 and 3 (refresh failure ignored; banner not cleared) and finding 1 (the store stays `in-flight`).
2. Unexpected user action: double-click on sign-in or Try again (finding 4); dismissing the banner mid sign-in (finding 6).
3. Wrong answer from input data: a successful but stale-token `getAuthStatus` clears the re-auth banner (finding 3).
4. Dependency failure: a start RPC timeout produces a local `failed` with `local-N`. A later real push with another `attemptId` is dropped. That is acceptable, since the next start resets.
5. Missing: `MESSAGE_HANDLERS` registration (finding 9); non-Electron fallback (finding 6).

## Verdict

REVISE. Findings 1-3 should be fixed, and finding 9 must be confirmed in the Component 15 batch before release.

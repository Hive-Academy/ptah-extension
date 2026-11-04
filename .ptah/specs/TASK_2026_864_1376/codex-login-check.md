# Codex in-app sign-in check - TASK_2026_864_1376 (PR #916, HEAD 8c81cfb46)

## Environment
- Electron DEV app built from the worktree under the verify lock (`build-dev,copy-renderer-dev`, 2 tasks succeeded, 0/2 cache hit).
- Launched with `CODEX_HOME=/tmp/codex-check-home` (empty), `--user-data-dir=/tmp/ptah-codex-check`, `--remote-debugging-port=9334`. Driven over CDP (playwright-core); route set with `ng.ɵgetRouterInstance(ng.getInjector(...))`. 1280x900. Themes switched via `data-theme` ptah-glass / ptah-glass-light.
- Browser launches were counted with a 50 ms process sampler (new processes matching xdg-open / browser / codex login), not app logs.
- Real `~/.codex` was never read or written. `stat -c '%Y %s' ~/.codex/auth.json` before `1793021473 4164`, after `1793021473 4164`.
- Nothing was entered or clicked in the browser. The login URL is redacted.

## Results

| Check | Verdict | Evidence |
| --- | --- | --- |
| A. Stage 1, Codex tab, not signed in | PASS | Codex card shows "Not signed in", "Signed in: No. Sign in to use Codex.", a "Sign in with Codex" button and the `codex login` fallback with Copy command. Stepper shows "1 Codex - Needs sign-in". Screenshots `codex-login-check/A-not-signed-in-dark.png`, `A-not-signed-in-light.png`. |
| B. Click Sign in | PASS | The panel read "Waiting for you to sign in" with "Open sign-in page", "Copy link" and "Cancel sign-in", and held that state for 9 s of polling. The text "Ptah opened the sign-in page in your browser." was shown. Exactly ONE `codex login` process (child of the Electron main). Exactly ONE `xdg-open` (ppid = Electron main) and ONE `google-chrome-stable <url>` launch, so one tab. Screenshots `B-signin-running-dark.png`, `B-signin-running-light.png`. |
| C. Cancel sign-in | PASS | The panel shows "Sign-in cancelled. You are still not signed in. Nothing was changed." plus a "Sign in again" button. The `codex login` process was gone at the first 1 s poll. `/tmp/codex-check-home` held only `config.toml` and `log`, with no `auth.json`. Screenshots `C-cancelled-dark.png`, `C-cancelled-light.png`. |
| D. Quit while running | PASS | `codex login` was running (child of main) before quit. Ctrl+Q through CDP did NOT quit the app, and I did not find a menu Quit path to drive. I then sent SIGTERM to the Electron main PID. Main exited and `codex login` was gone within 1.5 s, and the app log showed normal disposal (AgentProcessManager, PtahCliRegistry). No Electron or `codex login` process was left. Screenshot `D-running-before-quit-dark.png`. |
| E. `~/.codex/auth.json` unchanged | PASS | Identical stat before and after (see Environment). |

## Observations and caveats
- Quit was by SIGTERM, not the app menu or window close. This proves cleanup on the SIGTERM path only, and the UI quit path was not exercised.
- CORRECTED (see "Browser windows"): the second and third runs did open the browser. The earlier note that they did not was wrong. The sampler missed those short-lived `xdg-open` calls, and the app log shows them.
- One early `pgrep -f "bin/codex login"` in check C printed an extra long-lived PID (433361) for about 6 s. It was not logged by the sampler as a codex login and it was gone afterwards. It is most likely the pgrep/sh wrapper of my own polling command. I re-ran C (second cancel) with an exact awk match on the `codex login` executable and saw none after 1 s. Residual uncertainty is low.
- Chrome was cold-started by `xdg-open` as a consequence of this run (parent PID 1). I killed that tree (PID 432115) at the end, and no Chrome processes remain.
- Not covered: a real sign-in completion, the time-out after 10 minutes, and the "starting" state, which was too short to catch.

## Browser windows
Question: three system browser windows opened, where two clicks (B and D) were expected. Answer: (a), not (b).

- I made THREE Sign in clicks, not two. B was "Sign in with Codex". An extra click on "Sign in again" came from my re-run of check C (`c2.cjs`), to get an exact process match after cancel. D was a third "Sign in again" click. This was my mistake: the brief implied two sign-ins and I ran three.
- Evidence of three attempts: three `auth:codexLogin` RPCs in the app log (`/tmp/codex-check.log`, correlation ids 1a579e4f, 844a7286 and 57276339), two `auth:codexLoginCancel` RPCs, and three distinct `codex login` PIDs (432070, 434249, 434726), each with ppid = the Electron main.
- Per-attempt browser launches, each ONE:
  - Attempt 1 (432070): one `xdg-open <url>` (ppid = Electron main), which cold-started Chrome once. No second launch followed.
  - Attempt 2 (434249): the app log has one line `Opening in existing browser session.`, which Chrome prints when it forwards a URL to a running instance. This is one new window or tab.
  - Attempt 3 (434726): one more `Opening in existing browser session.` line, so one more window or tab.
- Source (`codex-login.service.ts:158-162`): on non-darwin and non-win32 the service sets `BROWSER` to the first existing of `/usr/bin/true` or `/bin/true`. The app therefore suppresses codex's own browser launch, and the only launcher seen was `xdg-open` with the Electron main as parent. No codex-originated `xdg-open` was seen. The earlier sampler missed the attempt 2 and 3 launches because they are short-lived, so I take the log lines as the evidence for them.
- Conclusion: 3 clicks gave 3 windows, one launch per attempt. This is not the "one tab on Linux" defect, so there is no severity to assign. One caveat: the sampler's attempt 1 count was a single `xdg-open`, and I did not see two launches for any one click. A 50 ms sampler can miss a very short process, but the app log shows only one browser line per later attempt, which is consistent.

## Cleanup
Electron main (PID 431176) exited. The sampler (PID 431727) was killed. Chrome (PID 432115 tree) was killed. `/tmp/codex-check-home` and `/tmp/ptah-codex-check` were removed. Nothing is listening on 9334. No code was edited.

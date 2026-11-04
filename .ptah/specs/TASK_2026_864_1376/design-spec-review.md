Verdict: APPROVED
# Gate 1.7 design re-review — round 2

## Earlier findings

| Earlier finding | Status | Reason and evidence |
| --- | --- | --- |
| 1. Bundled-only Codex sign-in and manual fallback (Serious) | **Resolved** | The runner contract takes the selected executable path, keeps installed-first/bundled-fallback selection, and fails visibly if that path cannot start; it does not silently switch binaries (`design-spec.md:193-207`). This matches `selectCodexExecutable`, which returns the installed selection when supported and the bundled selection otherwise (`libs/backend/codex-runtime/src/lib/select-codex-executable.ts:67-118`). The terminal row uses the quoted bundled path or a no-command fallback if terminal execution is impossible (`design-spec.md:169,203-207,235-236`; `prototype/stage1-signin.html:16`). The current Electron gap is correctly identified: the handler reports success after `openTerminal` without a runner, while Electron's `openTerminal` only logs a warning (`libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts:207-215`; `apps/ptah-electron/src/services/platform/electron-platform-commands.ts:63-68`). |
| 2. Unobserved browser-open claim and unbounded waiting (Serious) | **Resolved** | The spec uses neutral starting copy until a URL, device code or explicit browser-open result is observed, and conditions the affirmative browser-open sentence on the open result (`design-spec.md:218-224,237-241`). State 4b appears after 20 seconds with Try again, Use a device code and Cancel; the existing 10-minute process timeout remains (`design-spec.md:239-247`). The existing handler invokes `codex login --device-auth`, supporting the device-flow handoff (`libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts:207-223`). |

## New findings

None. Revision 2's listed changes are confined to the two earlier findings: the executable/manual fallback and observed-browser/recovery flow (`design-spec.md:519-534`; `decisions.md:12-14`). No new Blocking or Serious defect was found. The retained button hint “Opens your browser” describes the intended action, while progress and waiting copy avoid asserting that a browser already opened (`design-spec.md:169,218-240`).

Visual check: opened `prototype/stage1-signin.html` through `ptah_browser_navigate` at an 800px viewport with the dark theme, then `?theme=light`; used `ptah_browser_screenshot` for states 1b and 4b in each theme. Checked the bundled path and quoted copy command, neutral 4b message, recovery controls, contrast and two-column wrapping. Both themes rendered legibly with no horizontal overflow at that viewport. This is a prototype review, not an Electron runtime verification.

## New lane-introduced constraints

**Justified.** Revision 2 adds no new item to the lane-introduced constraints list (`design-spec.md:489-498`). Its selected-executable, honest manual fallback, evidence-gated browser copy and bounded recovery rules follow directly from the two Serious findings and the cited implementation (`design-spec.md:519-534`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Approve Gate 1.7 round 2 | APPROVED; REVISE | Both earlier Serious findings are resolved in the specification and inspected prototype; no Blocking or Serious finding remains (`design-spec.md:193-247,519-536`). | Yes, if implementation evidence exposes a defect. |
| Keep the 20-second transition as a design bound the architect may tune | Fixed 20 seconds; tunable bound | The spec explicitly allows tuning and retains a recoverable state plus the 10-minute process timeout (`design-spec.md:221-224,239-247`). | Yes. |

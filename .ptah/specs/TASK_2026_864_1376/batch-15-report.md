# Batch 15 report

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/auth-state.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/auth-state.service.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
- This report.

## Removed API and callers

- Removed `AuthStateService.codexLogin()` and its RPC-only spec.
- Searched `libs` and `apps` for `codexLogin(`. The only caller was `chat-view.component.ts`, now changed to `CodexSignInService.start()`. No other caller remains.
- `refreshAuthStatus()` returns the underlying read's `Promise<boolean>`. Specs cover success, failure, and superseded reads resolving to the newer read's true or false result.

## Banner wiring

- The existing banner action starts `CodexSignInService` for `openai-codex`.
- After a start from this banner, the chat template renders `CodexSignInBlockComponent` with `layout="compact"` and `role="chosen"` directly below the existing auth-required banner.
- While that sign-in is starting, running, or awaiting the user, a theme-styled, accessible “Cancel sign-in” button calls `CodexSignInService.cancel()`. The block and button are gated by both the banner's provider and the per-banner-start signal.
- On `succeeded`, chat awaits `refreshAuthStatus()` and clears the auth-required banner only when the refresh returns true. Specs cover the start, block/button rendering, Cancel click, absence for another provider, ordered refresh and clear, and retained banner on refresh failure.

## Decisions

- Decision: retain the auth-required banner when the post-success auth read fails. Options: clear on every `succeeded` push, or clear only after confirmed auth refresh. Evidence: the new boolean result distinguishes an applied read from a failed read; clearing on failure would hide the recovery path. Reversible: yes.
- Decision: use a per-banner-start signal before handling a `succeeded` state or showing the compact block. Options: react to any sticky success state, or only an attempt started by this banner. Evidence: `CodexSignInService.state` keeps final states, so an old success could clear a later banner. Reversible: yes.
- Decision: show Cancel only for `starting`, `running`, and `awaiting-user`. Options: show throughout the block's lifetime, or only during a cancellable sign-in. Evidence: these are the active states used by `CodexSignInBlockComponent`. Reversible: yes.

## Risks and verification

- No real `codex login` was run. No npm, Nx, Jest, TypeScript, build, serve, e2e, or git command was run.
- `ptah_get_diagnostics` was called on edited files. The TypeScript worker timed out or was still running after 45 seconds; Ptah does not recognize the HTML file for diagnostics. It provided no pass/fail result. The orchestrator must run the scoped verification.
- No Electron visual review was run, as launching application targets is disallowed for this lane.

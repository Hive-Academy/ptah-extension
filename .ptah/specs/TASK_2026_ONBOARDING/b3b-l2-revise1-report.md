# B3b Phase 2, revision 1

## Findings addressed

1. **Authoritative lookup failure:** `libs/frontend/onboarding/src/lib/analyze/project-guidance.page.ts:32` shows `guidance-lookup-error` with Retry and suppresses Start; `:205` retries the complete binding sequence. Spec: `shows rejected authoritative lookup as an error and retries binding`.
2. **Handoff in flight and late adoption:** `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:21` exposes revision-safe `inFlight` and the opened guidance tab. `libs/frontend/onboarding/src/lib/analyze/project-guidance.page.ts:44` hides Start while a handoff is in flight or pending, `:130` adopts a matching late run, and `:227` guards the action itself. Specs: `does not double-start while manualContinue has cleared started`, `adopts a late matching handoff run without starting again`, `ignores a late handoff run for another tab`, and `ignores a late failure from a superseded guidance handoff`.
3. **A3 manual continuation:** `libs/frontend/onboarding/src/lib/analyze/generate-agents.page.ts:177` routes a landed manual recovery to guidance without `run`; an exception or a missing guidance tab shows an inline alert. The existing started run is accepted only for the current workspace (`:130`). Specs: `routes manual recovery to guidance without a run`, `shows an inline alert when manualContinue throws`, and `ignores a pre-existing started run from another workspace`.
4. **Done chat action:** `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:40` labels the action “Ask the panel in chat”; `:90` switches to chat through the Open chat action. Spec: `offers Command center, Tribunal and Run again links`.
5. **Saved guidance fact:** `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:34` uses saved guidance enabled status when available, loaded at `:72`. Spec: `shows disabled saved guidance as off after a completed run`.

## Verification

Ran only `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard` from the worktree root. It remained at queue position 1 for more than 45 minutes (17:24:41–18:10:00 UTC), behind two unrelated verify holders. I sent SIGINT; the command exited 130 and logged `SIGINT while waiting. Leaving the queue.` No Nx task started, so there is no Nx summary line or test result for this revision. No verify process from this lane remains running. Scoped `ptah_get_diagnostics` also returned unavailable after its 45-second internal timeout, twice.

## Decisions

- A landed guidance tab without an accepted run is safe to pass to A4 with `tab` and `gen`; A4 then checks authoritative state and offers Start. When no guidance tab exists, A3 gives an inline error because there is no valid A4 tab identity. This is reversible.
- Saved guidance status takes priority over a completed run when the status call succeeds; the terminal run remains the fallback if status cannot be read. This is reversible.

## Limitations

- The lane has no callable skill-loading mechanism for `angular-frontend-patterns` or `impeccable`; repository conventions and the approved plan were used.

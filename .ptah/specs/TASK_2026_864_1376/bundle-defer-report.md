# Bundle defer report

## Files changed

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:157`: defer the Codex reauth block.
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:192`: defer the credentials tab's Codex block.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:30,798-799`: render the deferred block before asserting its DOM.
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.spec.ts:2,361-367`: render the deferred block before asserting its DOM.
- `.ptah/specs/TASK_2026_864_1376/bundle-defer-report.md`: this report.

## Deferred blocks

- Chat view: `@defer (on immediate)` is nested inside the existing Codex auth-banner and `codexReauthStarted()` guards. Inputs remain `layout="compact" role="chosen"`; the adjacent failure and Cancel controls retain their existing guards. No parent TypeScript code references the component class beyond its import and Angular `imports` array, and no parent focus code targets the block. There is a brief asynchronous mount after the guard becomes true.
- Credentials tab: `@defer (on immediate)` is inside the existing `@case ('codex')`. Inputs and adjacent sign-in/Cancel controls are unchanged. The class is referenced only by the import and Angular `imports` array. No placeholder is needed: neither block reserves space before this change.
- Both component imports remain in the Angular `imports` arrays so the compiler can split the standalone component when used only inside the defer block in each template.

## Other initial-bundle additions found

- `git diff --stat origin/main...HEAD -- libs/frontend apps/ptah-extension-webview` shows the new `CodexSignInBlockComponent` and the two eager uses above. The new onboarding provider panel, connection choice and readiness UI sit under `loadChildren` for `/onboarding` in `app.routes.ts:103`; they do not justify edits here.
- The existing main-agent reassign popover receives small logic changes in the diff, but is not a new large Task 2 UI component. No additional safe, large conditional Task 2 UI was identified in the eager root.
- `CodexSignInService` remains eager because `app.config.ts:478` registers it as a `MESSAGE_HANDLERS` entry. Other new core services and derived state are application logic, not UI to defer.

## Size estimate

`codex-sign-in-block.component.ts` is 10,507 source bytes. Its only runtime imports are Angular core and the already eager `CodexSignInService`; `CodexLoginState` is type-only. A rough uncompressed emitted saving is **5–10 kB**, likely **under the 11.99 kB CI overage**, and far below the roughly **32 kB** saving needed for a 20 kB margin. This estimate is not a build measurement. The two defer sites share the same component, so savings must not be counted twice. CI must measure the actual result. If it remains over budget, a separate review of larger existing conditionally mounted settings UI (for example the provider settings subtree) is needed; that is beyond the identified Task 2 additions and would require its own behavior and test review.

## Spec changes

- Angular is `~22.2.0` in `package.json`; installed TestBed defaults to `DeferBlockBehavior.Playthrough`. Both existing positive DOM assertions now call `fixture.getDeferBlocks()` and `render(DeferBlockState.Complete)` to avoid depending on the immediate trigger's scheduling. Negative assertions remain unchanged.
- No tests, builds, Nx, npm verify, Jest, or TypeScript commands were run, per task instruction. Scoped `ptah_get_diagnostics` was called after edits; its TypeScript check timed out as unavailable, and it does not recognize HTML. CI remains the verification gate.
- No visual render was run: the task prohibits serve/build/application targets, which this Angular route needs for a meaningful Electron screenshot.

## Decisions

- Use `on immediate` within the existing conditionals, with no placeholder. Evidence: the request specifies this trigger; both controls already mount only when their guards permit. Reversible: yes.
- Keep the sign-in service eager. Evidence: `MESSAGE_HANDLERS` registration in app config. Reversible: only after a different handler registration design.
- Leave onboarding and existing settings popover untouched. Evidence: onboarding is a lazy route; the popover diff is small logic only. Reversible: yes.
- Skill: the repository's `angular-frontend-patterns` guidance was read from `.claude/skills/angular-frontend-patterns/SKILL.md`; no host skill-loading tool was listed.

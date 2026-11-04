# Batch 19 report

## Files written

- `libs/frontend/onboarding/src/lib/ready/connection-choice.store.ts`
- `libs/frontend/onboarding/src/lib/ready/connection-choice.store.spec.ts`
- `libs/frontend/onboarding/src/lib/ready/connection-choice.component.ts`
- `libs/frontend/onboarding/src/lib/ready/connection-choice.component.spec.ts`
- `libs/frontend/onboarding/src/lib/ready/provider-panel.component.ts`
- `libs/frontend/onboarding/src/lib/ready/provider-panel.component.spec.ts`
- This report.

## Save outcomes

| Result | Notice | Follow-up |
| --- | --- | --- |
| `started:false` | 8 | No selection change |
| `blocked`, `failed`, `partial`, thrown write | 9 | Previous persisted choice shown |
| `unconfirmed` | 10 | Refresh persisted auth state |
| `saved`, reread `ok` | 6 or 7 | 7 when settings refresh failed |
| `saved`, reread `failed` | 11 | Mark selection unconfirmed; retry reads only |

## Design states 1–13

`connection-choice.component.spec.ts` has independent `it.each` cases named `state $number: $label`:

| # | Case name | Render and focus assertion |
| --- | --- | --- |
| 1 | loading | Loading skeleton; no radios |
| 2 | loaded unchanged | Saved radio; no confirm |
| 3 | other card selected | Confirm group; radio retains focus |
| 4 | write target missing | Status and unavailable confirm |
| 5 | saving | Status and disabled radios |
| 6 | saved reread ok | Success notice; focus returns to saved radio |
| 7 | saved refresh failed | Refresh notice; focus returns to saved radio |
| 8 | save returned false | Busy notice; focus returns to saved radio |
| 9 | blocked failed or partial | Alert; focus returns to previous radio |
| 10 | unconfirmed | Alert; focus returns to persisted radio |
| 11 | saved status not confirmed | Alert; no checked radio; first radio focused |
| 12 | cannot read saved connection | Alert and read-only retry; retry returns focus to radio |
| 13 | other connection saved | Providers guidance; no checked radio |

The table drives 6–11 through the component's confirm button. State 12 drives retry. State 3 checks focus on the selected native radio. No state was omitted.

## Panel visibility

| State | Claude help | Codex help |
| --- | --- | --- |
| Missing | Install | Install, unless bundled |
| Signed out | Sign-in | In-app sign-in block |
| Stale | None (not a Claude state) | In-app sign-in block |
| Error | Manual help | Error/help, no sign-in button |
| Ready, checking, slow | None | None |
| Information role | Help in closed details | Help in closed details |

## Claude help copied

`ready-claude-step.page.ts:259-404` was copied into the Claude branch of `ProviderPanelComponent` without editing or deleting the source page. The block retains its existing install tablist and copy rows (260-336), sign-in row and named-account link (337-365), and error/manual-help details (366-403).

## Decisions

- Use the shared `defaultMainConnectionTarget` and `mainConnectionTargetWritable`; this matches the popover's default target. Alternatives were a local target rule or a fixed scope. Evidence: plan and `main-connection-target.ts`. Reversible.
- Keep pending choice local until Confirm; panels derive roles from persisted readiness. Alternatives were optimistic panel roles. Evidence: design section 6. Reversible.
- For an unconfirmed save, request a persisted auth refresh and retain notice 10 even if that refresh rejects. Evidence: plan's unconfirmed outcome. Reversible.

## Round 1 fixes and verification

- AC 3.11: `connection-choice.store.spec.ts` drives stage 1 through `ConnectionChoiceStore.confirm` and the popover call shape through the real `ProvidersConnectionSetupService.activateConnection`, using one fake `ClaudeRpcService` recorder. It deep-compares captured `auth:saveSettings` params for Claude Code and Codex. The popover component itself is not instantiated: its source calls `state.activateConnection(pending.id, target, context)`, which delegates to this shared core service. The payload builder remains real.
- Corrected Claude selection ID to `claude-cli`; passing `anthropic` would select the API key path.
- `ConnectionChoiceComponent` now returns focus to the checked radio, or first radio, after confirm disappears and after Cancel or retry.
- `ptah_get_diagnostics` was called after edits; it again reported TypeScript compiler unavailable after a 45-second timeout. Jest, Nx, `npm run verify`, build, serve, and git remained prohibited and were not run. These new assertions have not been executed in this lane.

## Risks and limitations

- Static inspection and diagnostics timeout cannot establish that the specs pass. CI must execute the scoped onboarding test and typecheck.
- The host exposed no skill-loading tool, so `angular-frontend-patterns` could not be loaded in this lane.
- No Electron visual review was performed; Batch 20 has not integrated these components.

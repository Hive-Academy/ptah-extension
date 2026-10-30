# Review 8r-3 correction 2

Verdict: APPROVE

Score: 9/10

Review family: kimi-code (implementer: claude coordinator)

## Orderings checked

1. **The pre-auth read resolves after the fresh read starts.** The fresh call takes a newer generation at `libs/frontend/core/src/lib/services/model-state.service.ts:278`. The generation check at `model-state.service.ts:302` drops the pre-auth reply. This holds whether the fresh reply resolves before or after the pre-auth reply.
2. **The pre-auth read resolves before the fresh read starts.** It can publish a transient answer for the new scope. A successful fresh reply then replaces the full model list and selection at `model-state.service.ts:317-335`. The stale answer is therefore overwritten. If the fresh RPC fails, the previous list remains, as it does for other failed refreshes.
3. **A second workspace switch occurs during auth.** The auth sequence guard at `libs/frontend/core/src/lib/services/auth-state.service.ts:1284-1322` prevents an old auth reply from starting a dependent refresh. The coordinator generation check at `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:280` stops the old switch continuation. The scope check at `model-state.service.ts:306` also drops replies from a scope that the user left.
4. **A new tab opens after auth.** Its non-fresh call at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1127` joins the post-auth fresh read through `model-state.service.ts:274-275`. This is correct because that read started after the workspace auth refresh. If no read is in flight, the tab starts a new read with the resolved auth env.
5. **Other frontend callers.** The non-fresh callers in `auth-state.service.ts:791,1162`, `wizard-landing.component.ts:227`, and `welcome.component.ts:413` cannot make an older request publish after a newer generation starts. The fresh callers in `auth-state.service.ts:1409` and `providers-commit.service.ts:109` also use the same generation guard. The detached auth-dependent fresh read starts before the coordinator continuation, so the coordinator fresh read supersedes it when both run.

## Defects

None.

## Notes

- The regression spec at `libs/frontend/core/src/lib/services/model-state.service.spec.ts:341-375` is meaningful. The fresh call must start a separate RPC because the stale RPC remains gated. The final assertions prove that the late stale reply cannot replace the fresh model or list. The coordinator assertion at `workspace-coordinator.service.spec.ts:380` pins the required `{ fresh: true }` option.
- The reviewed additions contain no `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`.
- The option does not change the effort refresh. Pricing hydration retains its existing retry behavior. The coordinator still calls `refreshModels` once, so its request-count specs remain valid. The direct coalescing specs continue to exercise non-fresh callers.
- The batch cost note at `.ptah/specs/TASK_2026_714_c8a2/batch-8r-3-correction.md:38` is incomplete. A provider-changing switch can start one fresh read in `auth-state.service.ts:1409` and another in `workspace-coordinator.service.ts:286`, even without a new tab. This is a documentation note, not a correctness defect.
- The backend comment at `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:509-515` now matches the frontend correction.
- Read-only review only. I did not run tests, lint, typecheck, build, verify, or diagnostics.

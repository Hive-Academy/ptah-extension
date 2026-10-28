# Final fixes: independent code-logic review

Verdict: **APPROVED**

Score: **9/10**

Review family: **reviewer codex, implementer Claude**

Scope: only the `libs` changes introduced by `7bd38efa8` and `b8031e3fd`. Reviewed their individual diffs and relevant surrounding producers/consumers. HEAD was `7bd38efa8`, whose parent is `b8031e3fd`; both changes were present. Consulted release-held-fix-report.md, visual-fix-report.md, visual-review.md D1/D3, decisions.md D23/D28/D35, and implementation-plan.md lines 135–136 and 428–438. No source or Git-state changes were made.

## Findings

No actionable defects found. Numbered review conclusions follow; severity is informational, with no required fix.

1. **Informational — refusal mappings are consistent with the plan.** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:595`, `:689`, `:827`; `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:313`, `:660`, `:698`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:288`. Scenario: unclassified errors, cancellation/deadlines, absent identity/init evidence and closed gates now refuse `identity-unproved`; registry binding refusal, resume/init session-ID mismatch and unsuccessful attachment refuse `conflict`; missing admission or unavailable persistence refuse `unavailable-storage`. The executor checks reservation/baseline before attempting the registry bind. Binding supplied without an admission request still uses the D35 default. Fix: none.

2. **Informational — settlement and error trust remain intact.** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:879`; `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:764`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts:875`. Scenario: failures before or after owning a child continue through unchanged disposal/settlement logic. Release versus retain depends on termination/boundary proof, not the refusal code. Main-chat WeakSet branding and lane refusal-class checks still reject foreign error fields. The fixture explicitly throwing an ordinary Error with `code: 'release-held'` remains and now expects `identity-unproved`; it passed. A typed admission-port result retaining its own code is a separate, intentional pass-through. Fix: none.

3. **Informational — no affected consumer depends on the removed catch-all.** `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:169`; `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts:414`. Scenario: a changed producer now reports one of the existing refusal codes. Searches of production `libs`/`apps` code found no release-held-specific retry branch for these runs. Remaining literal consumers are the shared code list, neutral copy entries and the account-operation drawer fallback. The replacement codes already have RPC copy; the drawer concerns account-operation results, not named-run admission errors. Fix: none.

4. **Informational — the bootstrap deadline test exercises a real timeout path.** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:372`. Scenario: the fixture pauses either before an SDK child or during bootstrap identity with unproved termination. The test waits for the pause, verifies no caller abort, advances timers, awaits rejection and verifies the production deadline caused abort. It checks no final query, prompt yield, binding commit or metadata save, and exactly one appropriate release/retain after late completion and repeated disposal. Fake timers accelerate the real production timeout; the refusal is not mocked. Both cases passed. Fix: none.

5. **Informational — flat and card labels share the correct reactive path.** `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts:48`, `:233`; `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:79`, `:340`; `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts:54`; `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts:244`. Scenario: the store normalizes non-Claude/corrupt bindings to `undefined` (`agent-monitor.store.ts:106`), yielding no badge; ambient Claude yields Default. Named profiles resolve only their label, with Removed account after a loaded snapshot omits them. Neither ID, email nor path fields are interpolated. Only injector resolution is untracked; the account-state signal read stays inside the computed dependency graph, so list load/removal invalidates it and updates the OnPush input/template. The card helper extraction preserves its prior logic and markup. The session row adds only the 10rem cap and retains its title. Fix: none.

## Verification

- `npx --no-install jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts --maxWorkers=2`: **92 passed**.
- `npx --no-install jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts --maxWorkers=2`: **61 passed**.

## Not checked

- No Electron visual run, pixel/overflow measurement, accessibility audit or real Claude login/SDK process execution.
- No frontend spec execution or new live load/remove transition test; frontend reactivity was checked statically. The added flat-header tests cover initial states, not a transition within an existing fixture.
- The new process-environment spec and modified lane-runner/DI-smoke specs were read but not executed; the two permitted spec runs were used above.
- No builds, installs, full suites, verify command or e2e. Earlier commits and pre-existing Accounts-page ID rendering are outside this review.

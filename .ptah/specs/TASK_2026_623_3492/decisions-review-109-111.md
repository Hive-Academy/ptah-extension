# Decisions review: rulings #109 and #111

**Verdict: APPROVED** — #109 **AGREE**; #111 **AGREE**. No blocking, serious, or moderate logic defect remains in the current implementation of either ruling.

| Ruling | Verdict | Evidence (file:line) | Required change |
| --- | --- | --- | --- |
| #109 — preserve the Electron agent monitor when the deferred dock chunk fails | **AGREE** | The dock imports `DisplayPanelComponent` as a static dependency, so its monitor mount is necessarily in the same deferred chunk: `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:19-32,69,176-205`. The current `@error` branch retains the alert and mounts one non-docked monitor with the former VS Code bindings, only while the panel is open: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:303-333`. The Electron-only gate is `dockEnabled`, whose provider returns an instance only for Electron without `HIDE_AGENT_SIDEBAR`: `chat-view.component.ts:246-251,431`; the VS Code mount remains the `@else` branch: `chat-view.component.html:334-370`. | None. The required fallback and its focused coverage are present. |
| #111 — retain the agent status dot on the replacement Display toggle | **AGREE** | The Display toggle keeps the same `agentBadgeType()` input: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:263-275`; the former Agents toggle used that same binding in HEAD: `HEAD:chat-view.component.html:266-273`. The badge type still derives permission/running/settled state from the session agents: `chat-view.component.ts:539-557`. The sidebar control's accessible name contains only its label and `newCount`, not the dot: `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:85-96,139-149`. | None now. Keep the explicitly deferred colour-only-status accessibility assessment in Batch 33. |

## Logic checks

1. **Silent failure:** Before #109, a rejected dock chunk left an alert that looked handled while removing the only Electron route to agents and their permission queues. The `@error` branch now keeps the monitor reachable (`chat-view.component.html:313-331`).
2. **Unexpected user action:** Closing the fallback via its own close output or the toggle reaches `closeAgentPanel()` (`chat-view.component.html:330`, `chat-view.component.ts:573-575`). The focused spec covers both the toggle and monitor output (`chat-view.dock.spec.ts:711-766`). Overlay Escape remains host-scoped and uses that same close method (`chat-view.component.ts:514-518`); post-close overlay focus returns to the sidebar toggle (`chat-view.component.ts:1214-1225`).
3. **Wrong input data:** Monitor state is passed directly from `sessionAgents()` and retains the resolved session id in the fallback (`chat-view.component.html:325-330`; `chat-view.component.ts:539-547`), so a running agent is neither replaced with a default nor lost. The error-state spec asserts the running agent and session id (`chat-view.dock.spec.ts:714,731-741`).
4. **Dependency failure or wrong shape:** A lazy dock failure selects the mutually exclusive `@error` branch; it cannot render `ptah-display-dock` or its nested monitor at the same time. The test renders `DeferBlockState.Error` and asserts no dock plus exactly one monitor (`chat-view.dock.spec.ts:718-731`). The diagnostic check reports no diagnostics in the scoped TypeScript files; it cannot analyse the HTML file and reports unrelated pre-existing sibling errors, so it is not behavioural verification.
5. **Requirement gap:** The exact requested error-state test is present. It also checks the non-docked bindings and has a separate close-output case (`chat-view.dock.spec.ts:732-766`). A later successful load does not coexist with the error branch; Angular's deferred states are exclusive. Existing normal-path coverage asserts the dock contains exactly one monitor (`chat-view.dock.spec.ts:567-591`). No additional test is required for a double mount.

## Decisions

- #109's regression ruling is correct and the delivered fallback is complete for reachability, close, Escape, Electron gating, and monitor input continuity. No monitor data is copied into fallback state; the existing session signal is bound directly.
- #111 is valid parity: the status dot was already colour-only on the old Electron Agents toggle. Moving that same indicator to Display is not a new accessibility regression. Its lack of text/accessible status remains an open Batch 33 accessibility-review item, not a Batch 25 change.

## Review notes

Read in full: the current ChatView template, display dock component, dock integration spec, sidebar-tab component, and the relevant task/ruling/plan records. No tests or Nx targets were run, per the task's memory-safety instruction. Scoped diagnostics found no diagnostics in the requested TypeScript files; the template was unrecognised by that diagnostic source.

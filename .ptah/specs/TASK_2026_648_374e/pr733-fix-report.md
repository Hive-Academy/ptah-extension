# PR #733 fix report

## Objective 1

- Changed `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:128`: the organization-only session filter bar now loads through Angular `@defer (on immediate; prefetch on idle)`. Its controls remain available when the organization sidebar renders. The component has no other production import, so the defer can form a separate chunk. The earlier TASK_2026_629 report ruled out deferring a component that still has an eager import elsewhere.
- One permitted `npx nx build ptah-extension-webview --skip-nx-cache` run: **passed**, including the 3.50 MiB initial budget. CI before: 3.50 MiB, 1.78 kB over. After: about **3.38 MiB** (3,544,398 bytes) from the generated index asset and static-import graph, about **126 kB below** 3.50 MiB. This is an artifact-derived estimate; the build's last 40 lines did not include Angular's initial-total table. The required 3 kB margin is met.
- No workflow badge, embed, or launcher capability was removed.

## Objective 2

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:944`: capture the row's active workspace before confirmation and deletion awaits; use it at `:961` for badge-index cleanup.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1683`: capture the originating tab's workspace before rewind awaits, use it through `:1860` and `:1942` after closing tabs and deleting the session. A background tab's own workspace is used when available.
- Regression specs: `libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts:345` changes workspace during confirmation; `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:944` changes it during tab close. Both assert the original workspace reaches `forgetWorkflowSession`.
- Checks: chat typecheck and lint **2/2 passed**; chat test target **1/1 passed**; degradation audit lint **1/1 passed**. Nx Cloud emitted an account-plan warning after the local targets succeeded.

## Objective 3

- `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:83`: the injected start guard delegates to the current input on each call. At `:101`, card actions delegate to the current input when actions were present at injection time. Initial null remains null because compact cards use that state to hide optional actions.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:88`: rail retention remains a creation-time boolean; its injection token is `InjectionToken<boolean>` and ChatView captures it once (`chat-view.component.ts:850`). A live value would require a token and consumer contract change.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.spec.ts:103` changes card actions after injection, and `:134` changes the guard; both verify the existing injected value follows the new input.
- After the final edit, chat typecheck and lint **2/2 passed**; focused embed spec **5/5 tests passed**. The earlier full chat test run passed before this final embed change. The single webview build ran before this final small delegation edit; it was not repeated under the exact-one-build rule.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Defer the organization-only filter bar | Defer filter bar; defer workflow badge; remove UI | The filter bar has one production import and only renders on organization hosts; the prior bundle report shows a deferred symbol must lack another eager path. | Yes |
| Snapshot workspace before awaits | Read active workspace after awaits; capture the originating workspace | Workspace switches during awaits can change the index key; both regression specs exercise this. | Yes |
| Delegate callable tokens, retain null and boolean semantics | Change token contracts; capture all inputs once; delegate callable values | Guard and action methods can delegate without casts; null controls action visibility and rail retention is injected as a boolean. | Yes |

## Not done

- No second webview build was run after the final embed delegation edit because the task permits exactly one build. The measured initial size therefore belongs to the preceding source state; that edit adds a small closure to initial code and the measured margin is about 126 kB.

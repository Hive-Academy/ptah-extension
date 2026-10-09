# Session Handoff Fix Round 3

## Tests added

- 1. Terminal auto-arm and cancellation suppression: `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` — `auto-arms at handoff without confirmation but never at normal terminal turns`; `does not re-arm a cancelled automatic handoff until the blocking limit`; `does not re-arm a failed automatic handoff until the blocking limit`.
- 2. Owned handoff and fallback path: `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` — `uses the completed owned handoff text in the successor seed and never transfers its prompt`; `captures every assistant text after the owned handoff request`.
- 3–4. FIFO and lifecycle race: `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` — `writes an agent handoff, delivers the detached FIFO once, and closes after host confirmation`; `restores once and never delivers when the source ends during successor startup`; `restores held input when the source ends and allows a new operation`; `publishes bounded source text when held inputs cannot be restored`.
- 5. Successor cleanup: `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts` — `stops a bound successor when its source ends during coordinator completion`.
- 6. Latest revision state: `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts` — `returns the latest coordinator handover state to a late webview`; `does not broadcast an older revision after a newer handover state arrives`.
- 7. Queue flush race: `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts` — `typing during a successful flush leaves only the new draft`; `a failed flush with no new draft restores the original once`; `a failed flush with a new draft restores original and new exactly once`.
- 8. Banner coverage and recovery action: `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts` — the nine restored review cases plus `returns bounded lost source text to the composer on request`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — `puts lost handover text back into this source view composer`.

## Defects found

- `complete()` continued after `sourceEnded()` restored the FIFO, so an in-flight successor start could still deliver those same inputs and overwrite `failed`. Completion now validates that its operation is still active after each asynchronous boundary and stops a started successor if the source is gone.
- Failed `budget-auto` operations were not included in handoff-stage re-arm suppression. Both cancelled and failed automatic operations now remain suppressed until the hard-limit turn creates a `budget-limit` confirmation operation.
- Inputs that could not be restored had only a count and a generic message, leaving no safe way to recover their text. `SessionHandoverState` now carries bounded `lostInputTexts`; the failed banner restores them to the source composer.
- Owned-handoff capture read only the last assistant message, so a trailing empty tool-oriented message could discard valid handoff prose. It now joins all non-empty assistant text after the pre-request assistant id.

## Batch C fixes

- `sendQueuedMessage` snapshots content/options and clears queued content before awaiting the handover flush. On success or `SESSION_HANDOVER_HELD`, newly typed draft text remains untouched; on another refusal/error the original is restored once before the new draft.
- The nine dropped banner cases were restored under the approved one-message handoff/limit model. The two existing queue-flush expectations changed only for that approved clear-before-await behavior.
- Failed handover UI now offers **Put back in composer** only when bounded recovery text is present, and writes it into the source view's composer.

## Tests

- Before/after project test counts: agent-sdk **689 → 698**; rpc-handlers **371 → 374**; chat **245 → 259**.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff libs/backend/agent-sdk/src/lib/helpers/session-lifecycle libs/backend/agent-sdk/src/lib/helpers/session-budget libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/di --coverage=false --maxWorkers=2` — invoked once; its command collector did not return a completion summary. Focused coordinator evidence: **1 suite, 18 passed, 0 failed**.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts libs/backend/rpc-handlers/src/lib/chat --coverage=false --maxWorkers=2` — invoked once; its command collector did not return a completion summary. Focused successor-adapter evidence: **1 suite, 12 passed, 0 failed**.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/notifications libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/services --coverage=false --maxWorkers=2` — invoked once; its command collector did not return a completion summary. Focused evidence: banner **1 suite, 21 passed, 0 failed**; chat view **1 suite, 73 passed, 0 failed**. The chat-view run emitted an unrelated session-loader warning while still passing.
- `npx nx typecheck agent-sdk --parallel=1 ; npx nx typecheck rpc-handlers --parallel=1 ; npx nx typecheck @ptah-extension/chat --parallel=1 ; npx nx lint @ptah-extension/chat --parallel=1` — invoked once. The collector confirmed `typecheck agent-sdk` passed; it returned before reporting the remaining serial steps, so those results are not asserted as green.
- Scoped TypeScript diagnostics were requested twice after edits. The diagnostic service remained unavailable after 45 seconds on each request, so it produced no compiler result.

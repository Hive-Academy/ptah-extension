# Code Logic Review - TASK_2026_595_1c01

> Reconstructed by the orchestrator. The correction-review lane overwrote the original file; its
> output now lives in `correction-review.md`. The initial review below is restored from the
> orchestrator's read of the original. The round 1 re-review is summarised from the reviewer's
> hand-back, because its full appendix was lost.

## Initial review - REVISE (7/10), reviewer: code-logic-reviewer subagent

The design was verified as correct for the URL grammar, body forging, AsyncLocalStorage propagation, cache stability and enum validation.

| # | Severity | Finding | Outcome |
|---|----------|---------|---------|
| 1 | Serious | The profile is lost when an Apps session resumes through `chat:resume` activate (chat-session.service.ts:904) or rewind (:1107). | No change. See `review-response.md`: the Apps page never calls these paths. |
| 2 | Serious | `execute_code` can still call `ptah.surface` / `ptah.dashboard` under coding (ptah-api-builder.service.ts:874-881). | Fixed by an invocation-time profile proxy (`withAppsNamespaceProfile`). |
| 3 | Moderate | The coding help overview still said "22 Namespaces". | Fixed: the count was removed. |
| 4 | Moderate | Plain-URL trust-boundary cases were rewritten to `/profile/apps` (protocol-dispatcher.surface.spec.ts). | Fixed: the plain-URL cases were restored and the apps variants added. |
| 5 | Moderate | The sweep driver-coverage check ran only on the apps listing. | Fixed: it now runs on both listings. |
| 6 | Minor | A malformed escape in `/profile/` makes `decodeURIComponent` throw. | Pinned: the request gets HTTP 400 / JSON-RPC -32700 with no dispatch. A spec was added. |
| 7 | Minor | `chat:continue` sends the profile even for a live session. | No change. See `review-response.md`. |

## Round 1 re-review - APPROVED, reviewer: code-logic-reviewer subagent

Items #2-#6 are fixed. The decisions on #1 and #7 hold. Two items were still open:

- Moderate: the proxy had only a `get` trap, so `Object.getOwnPropertyDescriptor(ns, 'update').value(...)` bypassed the gate.
- Minor: the refusal was thrown synchronously instead of as a rejected promise.

The orchestrator made one bounded correction: it added a `getOwnPropertyDescriptor` trap and changed the refusal to `Promise.reject`. A Codex lane then reviewed that correction (`correction-review.md`).

## Correction review - REVISE, reviewer: Codex CLI lane

Two moderate items remain, and both need a frozen or non-configurable target. The real targets cannot be frozen or non-configurable: they are object literals from `buildSurfaceNamespace` / `buildDashboardNamespace`, or the empty fallback proxy from `buildNamespaceSafe` (ptah-api-builder.service.ts:908-934). The reviewer also confirmed that neither item is a current sandbox escape. The revise cap is used up, so these items are reported as open and not fixed.

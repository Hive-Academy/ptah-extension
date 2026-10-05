# PR 3 (N7/N8) Phase-End Code Style Review — TASK_2026_597_ab22

Scope: `git diff ecc953410..HEAD -- ':!.ptah'` (72 files). Style and structure only; runtime behaviour is covered by the parallel logic review.

**Verdict: APPROVED** (0 Blocking, 0 Serious, 2 Moderate, 4 Minor). The two Moderate items are follow-up tasks, not merge blockers.

## Checks that passed

| Convention                                                                                                                                                                                                                                                | Evidence                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| DI token style: `Symbol.for`, grouped in `SDK_TOKENS`, doc comment like neighbours                                                                                                                                                                        | `libs/backend/agent-sdk/src/lib/di/tokens.ts` (SDK_SESSION_BUDGET beside SDK_SESSION_STATS_OWNER)                                       |
| Registration in `register.ts`, before the adapter that injects it; plain-class writer built via `instanceCachingFactory` with the reason stated                                                                                                           | `libs/backend/agent-sdk/src/lib/di/register.ts:638-654`; DI smoke spec added in `register.compaction-boundary-registry.smoke.spec.ts`   |
| Public barrels: agent-sdk `index.ts`, rpc-handlers `index.ts` and `handlers/index.ts`, shared `index.ts` all updated; RPC method added to registry, `RPC_METHOD_ENTRIES` and `manifest.ts`; handler owns `METHODS ... satisfies readonly RpcMethodName[]` | `rpc.types.ts` (registry plus entries), `manifest.ts`, `session-budget-rpc.handlers.ts`                                                 |
| Handler shape follows siblings: `@injectable`, `register()`, params validated at the boundary by a zod schema in a sibling `*-rpc.schema.ts`, `{ success: false }` result instead of throwing, optional DI documented                                     | `session-budget-rpc.handlers.ts`, `session-budget-rpc.schema.ts`                                                                        |
| Layer boundaries: presentational `chat-ui` chip imports only `@ptah-extension/shared`; orchestrator and RPC code stays in `libs/frontend/chat` and backend libs; `platform-core` imports shared only                                                      | `session-stats-summary.component.ts` (diff imports), `file-settings-keys.ts`                                                            |
| File naming: kebab-case with role suffix (`.service`, `.provider`, `.component`, `.handlers`, `.schema`, `.types`) and co-located specs                                                                                                                   | whole diff                                                                                                                              |
| Type precision: no `any`, no `@ts-ignore`, no `eslint-disable` added. Added `as` casts are DOM `event.target` casts in the settings card, `Object.keys` key narrowing, and `sessionId as SessionId` brands                                                | grep over non-spec diff                                                                                                                 |
| Angular: standalone (default), OnPush, `input()`/`output()`/`signal()`/`computed()`/`inject()`; banner is dumb and emits events; the settings card is `@defer (on viewport)`                                                                              | `session-budget-banner.component.ts:145-171`, `session-budget-settings.component.ts:143-145,318`, `orchestration-settings.component.ts` |
| Settings keys derive from one shared table (`SESSION_BUDGET_SETTINGS`) used by key set, defaults, backend reader and the card; deliberately kept out of `KNOWN_CONFIG_KEYS` with the reason documented                                                    | `file-settings-keys.ts:148-165,458,718`                                                                                                 |
| Naming is consistent across layers: `SessionBudget*` (shared types, service, handlers, banner, settings), `session:budgetAction`, `SESSION_BUDGET_REACHED`, `sessionBudget` tab field                                                                     | shared, backend, `chat-types.ts`                                                                                                        |

## Findings

### Moderate

**M1. `chat-view.component.ts` and `session-stats-summary.component.ts` cross the 700-line ceiling further.**

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` grew from 1014 to 1105 code lines (`max-lines` skipBlankLines/skipComments, `eslint.config.mjs:514`).
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` grew from 758 to 859.
- Both were already over; the rule is `warn`, so this does not fail CI and PR 3 added about 90 lines to the first and about 100 to the second. Do not split in this PR: moving large pre-existing code alongside a feature makes the diff unreviewable and risks regression.
- Record it as a follow-up task. Cheapest cuts when it is picked up:
  - Extract the budget action block (`chat-view.component.ts` ~L799-833 state signals and ~L1130-1200 `onBudget*`/`runBudgetAction`) into a `SessionBudgetActionsService` or facade in `libs/frontend/chat`. It is self-contained: one RPC call, preview state, new-tab continue.
  - Extract the chip's budget formatting (`tokensBudgetSuffix`, `costBudgetText`, `costBudgetSuffix`, `costTooltip`) into a pure helper next to the component.
- Without that task the next feature on either file makes the warning count permanent noise.

**M2. Business flow ("Continue in new session") lives in the view component.**

- `chat-view.component.ts:~1145-1170` `onBudgetContinue` does tab creation, canvas routing and message dispatch. Sibling flows put this in `chatStore`/`TabManager` services. It works, but it is the reason chat-view keeps growing. Fold into the extraction in M1.

### Minor

1. `libs/backend/agent-sdk/src/index.ts` re-exports `type SessionBudgetState` from `@ptah-extension/shared`. Consumers already import it from shared (the handler does). A second path for the same type invites drift; drop the re-export unless a consumer needs it.
2. `session-budget-rpc.handlers.ts` and `chat-session.service.ts` each declare their own `Pick<SessionBudgetService, ...>` structural type, and both import a concrete class from agent-sdk. Siblings are mixed on this, so it is acceptable, but the repo's `I`-prefixed-port convention would suggest one `ISessionBudget` port in shared or agent-sdk used by both. Optional.
3. `rpc-error-codes.types.ts`: `SESSION_BUDGET_REACHED` is correctly appended, but confirm the frontend maps it where the other `RpcUserErrorCode`s are mapped. That check belongs to the logic review; noted only because the union is a public contract.
4. `session-budget-banner.component.ts` sits in `molecules/notifications/` while the settings card is in `settings/ptah-ai/`. Both match nearest siblings (auth-required and resume banners). No action; recorded as an audited placement.

## Five style questions

1. **Six months out**: more budget stages or units mean edits in the shared types, the stage machine and the chip formatting; the shared settings table already centralises the settings side. The pressure point is chat-view (M1).
2. **Misread**: `canSend` fails open (no state means ok) and `/compact` and `/clear` bypass the gate by exact match (`chat-session.service.ts` `BUDGET_EXEMPT_PROMPTS`); both are documented in comments, so low risk.
3. **Maintenance cost**: about 7,000 lines including specs; the production service plus builder plus writer (~1,400 code lines) is split by responsibility, not size.
4. **Inconsistency**: none against nearest siblings beyond Minor 1 and 2.
5. **Differently**: move the banner action orchestration out of chat-view into a service now rather than later.

## Verdict

APPROVED. 0 Blocking, 0 Serious, 2 Moderate (record M1/M2 as one follow-up task), 4 Minor. Confidence: HIGH on boundaries, DI, barrels and naming; MEDIUM on component internals (read the diff, not every line of the new components).

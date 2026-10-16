# Batch C-2 report: session agent roster + lane status delegation (`@ptah-extension/chat`)

Task C-2.1 is implemented. The scoped nx checks are left to the team-leader, as decisions.md row 59 says.

## Files

- CREATED `libs/frontend/chat/src/lib/services/session-agents/owned-by-session.ts`: `ownedBySession`, copied unchanged from `canvas-detail/lane-owner.ts`. The canvas copy and its 3 importers stay as they are; C-3 removes them.
- CREATED `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts`:
  - `SessionAgent` and `SessionAgentRosterInput`.
  - The pure `buildSessionAgentRoster`.
  - `orchestratorAgent(status, ids)`, a file-local helper the service reuses. It is not in the barrel.
- CREATED `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.service.ts`: `SessionAgentRosterService` (`providedIn: 'root'`, `inject()`). It has the methods `requestsForTab(tabId)` and `roster(tabId)`, plus the exported type `TabRequests`.
- MODIFIED `libs/frontend/chat/src/lib/services/index.ts`: an append-only block that exports `buildSessionAgentRoster`, `SessionAgent`, `SessionAgentRosterInput`, `SessionAgentRosterService`, `TabRequests` and `ownedBySession`.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`: `laneStatus` is replaced by `toCompactLaneStatus(word, status)`. It is applied to `cliLaneStatusWord(status, permissionQueue.length)` and to `subagentStatusWord(status, false)`. `buildLaneSummary` is otherwise unchanged.
- NOT MODIFIED `libs/frontend/chat/src/index.ts`: see Deviations.

## Behaviour (plan C §2 / §4)

**Roster order** is Orchestrator, then sub-agents (`status !== 'background'`), then CLI lanes, then background. The background group lists background-status sub-agents first and then background-store entries. Store entries are de-duplicated against **all** owned sub-agents' `parentToolUseId`, using a `Set` (same result as today's `some`).

**Membership and keys** match `canvas-lane-tabs.component.ts:98-162`, with strict `ownedBySession`. CLI lanes are now named `displayName || cli` (decision C7).

**Orchestrator:**
- `status` is `orchestratorStatusWord(tabStatus, ids.length > 0)`.
- `openRequestIds` holds the permissions without `agentToolCallId`, plus all questions.
- `startedAt`, `endedAt` and `activity` are `null`.

**Sub-agents:**
- `pending` and `paused` read `queued` through the C-1 `subagentStatusWord` (decision C4).
- `activity` is `lastToolName ?? null`.
- There is no timing.

**CLI lanes:**
- `openRequestIds` is `permissionQueue[].requestId`.
- `endedAt` is `completedAt ?? null`.
- `activity` is the last non-empty trimmed line of the last segment's `content`.

**Background-store entries:**
- `status` comes from `backgroundAgentStatusWord`.
- `activity` is `agentDescription ?? null`.
- `startedAt` and `endedAt` come from the entry.

**`roster(tabId)`** resolves the tab with `findTabByIdAcrossWorkspaces`. An unknown or null tab gives `[Orchestrator]` with status `null` and no requests. A known tab without `claudeSessionId` gives the Orchestrator only, with its status taken from the tab (E-3). `roster` is a plain method that reads signals; there is no cache and nothing to release.

**`requestsForTab(tabId)`** reads `routingTargetRevision()` first. It then applies the compact card's `targetsTab` rule: the routed target tabs first, otherwise `request.sessionId` resolved with `findTabBySessionIdAcrossWorkspaces`. A request whose tab cannot be resolved is not counted. Requests are not filtered by `surfaceMode`, the same as the compact card. A null tab gives empty lists.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Background-status sub-agents also get `openRequestIds` (permissions where `agentToolCallId === parentToolUseId`), and their status uses `subagentStatusWord(status, ids.length > 0)` | (a) same matching as foreground sub-agents; (b) always `[]` | Plan §2 says the background sub-agent's status is `subagentStatusWord`, whose second argument is the open-request flag. A background sub-agent's permission carries its Task tool call id (`permission.types.ts:58`), so nothing is invented. (a) keeps one rule for one record type. | yes |
| `agentType` of a background-store entry is `a.agentType \|\| null` | `\|\| null` / raw string | `BackgroundAgentEntry.agentType` is a required string. An empty string should not become a role-icon key. | yes |
| The request result type is named `TabRequests` and exported | inline type / named type | Contract C2 gives only the shape. B-3 needs to type the result. | yes |

## Deviations

1. **`libs/frontend/chat/src/index.ts` is not modified.**
   - Why: it already has `export * from './lib/services'` (line 15), so every new symbol is importable from `@ptah-extension/chat`. That meets the batch acceptance criterion.
   - Plan §2 also lists only `services/index.ts`. Re-exporting the same names again from `src/index.ts` would be redundant.
   - Effect on later batches: B-3 and others can append to `src/index.ts` with no ordering dependency on C-2.

2. **The `toCompactLaneStatus` adapter takes a second argument: the raw status.**
   - Why: plan §4 requires compact output identical "for every input", but the C-1 mappers' runtime `default` reads an out-of-type status as `stopped`. The old `laneStatus` read such a status as `running`, read `pending`/`paused` as `waiting`, read `timeout` as `error` and read `killed` as `stopped`.
   - Spec impact: `compact-lane-rows.spec.ts:99-110` ("keeps unknown statuses as running", which casts `'new-status'`) would have failed with a word-only adapter.
   - What the adapter does: for the word `stopped` it re-checks the raw status, so all inputs keep their old output, typed or not. I traced every mapping:
     - CLI: `killed`, `pending` and `paused` are outside `AgentStatus`.
     - Sub-agent: `timeout` is outside `SubagentRecord['status']`.
     - Unknown strings give `running`.
   - The spec file is unchanged.

## Out-of-scope observations (not fixed)

- **Runtime fallback mismatch.** The C-1 shared mappers (`chat-ui/.../agent-status.ts`) read a runtime-unknown CLI or sub-agent status as `stopped`, while the compact card shows it as `running`. The adapter above keeps the compact card's behaviour. The dock and inspector, which read the roster, will show such a status as `stopped`. That matches C-1's documented intent, but the code-logic reviewer should confirm it.
- **`compact-lane-rows.spec.ts:116` passes `'pending'` where `AgentStatus` is expected.** `ptah_get_diagnostics` reports TS2345 for it. The error existed before this batch: the spec helper's parameter type is `MonitoredAgent['status']`, and I did not change the spec. If `nx typecheck @ptah-extension/chat` covers spec files, this error already fails on the base tree.
- **Other pre-existing spec-file type errors appear as sibling diagnostics,** none in files this batch touches:
  - `tab-bar.component.spec.ts` (branded `TabId`)
  - `compact-session-card.component.spec.ts:286`, `:847`
  - `send-message-chip.component.spec.ts`, `workflow-card.component.spec.ts`, `execution-node.send-message.spec.ts`
  - `agent-card-truncation.spec.ts`, `chat-input.component.spec.ts`
- **Duplicated targeting rule.** The compact card keeps its private `targetsTab` copy (`compact-session-card.component.ts:622-642`). Replacing it with `SessionAgentRosterService.requestsForTab` is the follow-up the plan records; it is outside this batch.

## Verification

- `ptah_get_diagnostics` (TypeScript compiler), scoped to the 5 changed files: **no diagnostics in the requested files**, coverage `clean`.
- `nx test`, `nx typecheck` and `nx lint` for `@ptah-extension/chat`: **not run** (decisions.md row 59, wave 2 runs no nx checks). The team-leader runs them on the combined tree.
  - Expected: `compact-lane-rows.spec.ts` passes unchanged.
  - Expected: no spec imports the new files (none were added, as the batch requires).

Review family: Claude (implementer: codex)

# Code Logic Review R9e — Strict scoped Agents groups, tolerant main panel (TASK_2026_629_c0b3)

Score: 6/10
Verdict: APPROVE-WITH-FIXES

Scope read in full: `agent-monitor-panel.component.ts` (all `effective*`, `sessionSubagents`, `onClearCompleted`, inputs), the four batch diffs, `session-scope.ts`, `AgentMonitorStore` (`agentsForSession`, `agentsOwnedBySession`, `workflowSubagentsForSession`, `sessionSubagentsForSession`), `chat-view.component.ts` (`sessionAgents`, `resolvedSessionId`, auto-open effect, `dockEnabled`), `chat-view.component.html` (dock and panel mounts), `display-dock.component.ts` (`agents`, `sessionId` wiring), `canvas-detail-transcript.component.ts` (providers), `vendor-card.component.ts`, the batch and plan text.

Specs run from the worktree through the lock runner, one at a time:
- `agent-monitor-panel.scope.spec.ts`: 14 passed
- `display-dock.state.spec.ts`: 26 passed
- `display-dock.component.spec.ts`: 22 passed

I ran no typecheck, lint or other checks. The spec results confirm the happy paths only. Finding 1 is not covered by any spec, because every spec feeds `''` where the real host feeds `null`.

## What holds

- Owner equality matches the R9d rule. The panel filters with `agent.parentSessionId === sid`, the same predicate as `AgentMonitorStore.agentsOwnedBySession` (`agent-monitor.store.ts:891-894`). An unowned record (`undefined`) is excluded and a foreign owner is excluded. `''` yields an empty list through `!!sid`.
- Strictness is gated on `SESSION_CONTEXT` only (`:636`). The main panel (no `SESSION_CONTEXT`) takes the unchanged tolerant selectors, including with a resolved `sessionId` (spec `keeps unresolved agents in the main-panel host even with a resolved session id`).
- The retained terminal selection in `sessionSubagents` (`:813-826`) uses the strict check in a scoped host, so an unowned selected record cannot be re-injected.
- Counts, tiles and `_selectableKeys` all derive from the filtered `effective*` computeds, so they are consistent inside the panel. Permissions are filtered to the strict agent set.
- The pin/close/per-tab specs are real. The state spec checks isolation of pin, section and width between tabs. The component spec checks that pin and section are restored on a `tabId` switch.

## Findings

### 1. SERIOUS — A scoped host with an unresolved session reaches the panel as `null`, not `''`, so the "strict" panel falls into the global branches

- File: `agent-monitor-panel.component.ts:738-741` (effectiveAgents), `:767-768`, `:781-782`, `:815-819`, `:1271-1273`
- Evidence:
  - `ChatView.resolvedSessionId()` returns `null` when the tab has no `claudeSessionId` (`chat-view.component.ts:767-776`).
  - The template and the dock pass that value straight through: `chat-view.component.html:315,355`, `display-dock.component.ts:208`.
  - The panel's own contract says `null` means the GLOBAL panel and `''` means a scoped, unresolved surface (`:667-673`). No real host produces `''`.
- Scenario: a Rail ChatView (`SESSION_CONTEXT` present) on a new or unresolved tab mounts the panel with `sessionId = null`. Then:
  - `effectiveWorkflowSubagents` and `effectiveSessionSubagents` return `store.activeWorkflowSubagents()` and `activeSessionSubagents()`. These are the global active tab's records, including unowned ones. That is the cross-session leak the strict scope is meant to prevent.
  - `effectiveAgents` takes the tolerant branch (`sid === null`).
  - `onClearCompleted` calls `store.clearCompleted()` (global) and wipes every session's completed agents. This is a destructive action from a scoped surface.
  - The retained selected terminal subagent uses the active-tab path (`:815-819`).
- Impact: the new `strictSessionScope` gate is bypassed in exactly the state where scoping matters most. All the added specs use `''` or a resolved id for the scoped cases, so they pass while the real host input is untested. The existing spec `still falls back to the active-tab selector for the GLOBAL panel` runs under a `beforeEach` that provides `SESSION_CONTEXT`. It therefore encodes `scoped + null = global`, which is wrong for a Rail host.
- Reachability: latent today. `canvas-detail-transcript.component.ts:56` and `canvas-tile.component.ts:618` set `HIDE_AGENT_SIDEBAR: true`. That makes `DisplayDockState` null (`chat-view.component.ts:240-246`), so neither the dock nor the panel mounts. It becomes live when R9f removes `HIDE_AGENT_SIDEBAR` (batches-rail-r9.md R9f contract). Fix before R9f, and inside R9e's file list.
- Fix: in the panel, define `scopedUnresolved = strictSessionScope && !sid`.
  - `effectiveAgents`, `effectiveWorkflowSubagents` and `effectiveSessionSubagents` return `[]` when `scopedUnresolved`.
  - `onClearCompleted` does nothing when `scopedUnresolved`. Only a no-`SESSION_CONTEXT` panel with `sid === null` may call the global `clearCompleted()`.
  - The `sessionSubagents` selection branch follows the same rule.
  - Add specs under `SESSION_CONTEXT` with `sessionId = null`: no run groups, no active-tab selector call, no `clearCompleted`.
  - Move the "GLOBAL panel" specs to `TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null })`.
  - Tribunal `vendor-card` has no `SESSION_CONTEXT` ancestor, so it keeps its null-as-global behaviour.

### 2. SERIOUS — Dock badge, running count and auto-open stay tolerant (the writer's risk is a real defect, owned by R9h)

- File: `chat-view.component.ts:542-549` (`sessionAgents`), consumed at `chat-view.component.html:296` (`[agents]` to the dock) and `:314,353` (`embeddedAgents`), `agentBadgeType` (`:551-560`), and the auto-open effect (`:1338-1355`); dock side `display-dock.component.ts:133,259`.
- Evidence: `sessionAgents` uses `agentsForSession(sid)`, which uses the tolerant `agentVisibleInSession`. The dock tab label `Agents ({{ agents().length }})` and `runningCount` come only from that input. The panel is strict after R9e.
- Scenario: in a Rail ChatView with a resolved session, an unresolved running CLI lane (`parentSessionId` undefined):
  - shows in the dock tab count and the running count of every Rail session;
  - sets the badge to "info";
  - makes `requestAgentsOpen` auto-open the dock;
  - leaves the panel body showing "No agents in this session".
  - The count and the body disagree, and a foreign lane's activity opens or flags the wrong session's dock. This also breaks parity row 74 ("per-session count"), which is only PARTIAL after R9e.
- Judgement:
  - The dock cannot be made strict within R9e's list. The dock component is out of scope, `sessionAgents` lives in `chat-view.component.ts`, and the dock has no scope signal of its own.
  - It is latent for the same reason as finding 1 (`HIDE_AGENT_SIDEBAR: true` today, so the dock does not mount in Rail).
  - It has to land before R9f exposes the dock again.
  - Defect not fixed by R9e: yes. Defect in the final product if left: yes.
- Owner: R9h. It depends on R9e, owns `chat-view.component.ts`, `.html` and `chat-view.dock.spec.ts`, and its contract says "strict owners only in Rail; dock keyed by tab id". R9f depends on R9h, so ordering already puts the fix before the exposure. R9u-R9x (split-focus addendum, board/canvas files) and R9n (transcript files) do not touch `sessionAgents` and must not be given this.
- Recommendation: amend the R9h contract to name `ChatView.sessionAgents` explicitly:
  - With `_sessionContext`: `agentsOwnedBySession(sid)`.
  - Without it: `agentsForSession(sid)`, unchanged.
  - The unresolved scoped branch already returns `[]` (`:545`).
  - Gate on `SESSION_CONTEXT` only, never on `SESSION_CARD_ACTIONS` (see "Scoped host definition" below).
  - Required specs in `chat-view.dock.spec.ts`: Rail host with an unresolved running lane gives dock count 0, no badge and no auto-open. Main host with the same lane gives count 1 and auto-open.
  - Add a note to R9f's review checklist: do not remove `HIDE_AGENT_SIDEBAR` unless that R9h spec is green.

### 3. MODERATE — Spec set encodes the wrong "unscoped" model and never exercises the real host input

- File: `agent-monitor-panel.scope.spec.ts:75` (`beforeEach` provides `SESSION_CONTEXT`), `:158` (`keeps unresolved agents visible in the unscoped main panel`), `:182`.
- Detail: the test named "unscoped main panel" runs with `SESSION_CONTEXT` provided and only passes through the `sid === null` tolerance escape. The only genuine main-panel case is the one that overrides the provider. All scoped cases use `''` or a resolved id. See finding 1 for the missing `scoped + null` coverage.
- The store is a plain mock. The new filter is the only thing under test. That is acceptable, but no integration spec ties the panel to real store output.
- Fix: add the scoped-null specs from finding 1, and rename or reparent the "unscoped" cases.

### 4. MINOR — The owner rule is duplicated inline three times

- File: `agent-monitor-panel.component.ts:741,771,785,816` (`!!sid && x.parentSessionId === sid`).
- A fourth copy exists in the store (`agentsOwnedBySession`). `agentsOwnedBySession` is a store method over `agents()` and is not reusable on the record types here, so a drift risk exists.
- Fix: add one pure `ownedBySession(parentSessionId, sessionId)` next to `agentVisibleInSession` in `chat-streaming/src/lib/session-scope.ts`. Use it here and in the store. The inline `!!sid &&` after the `sid === null` early return is partly redundant, so a shared helper also removes that.

### 5. MINOR — Dock component spec covers pin and section but not width on tab switch

- File: `display-dock.component.spec.ts:438-455`. Width isolation is asserted only at the state level (`display-dock.state.spec.ts:117-141`). The width restore on tab switch is a ChatView concern (`syncDockWidthPerTab`) and is owned by R9h; note it for that batch.

## Answers to the requested checks

Owner equality consistent with R9d: yes. The same strict `===` on a resolved id; `''` or `undefined` owns nothing.

Main panel tolerant: yes, for the no-`SESSION_CONTEXT` host with a null or resolved `sessionId`. It still shows unresolved agents (spec lines 158-199).

No cross-session leak in scoped hosts: not yet, because of finding 1. It holds for a resolved scoped session. It does not hold for an unresolved scoped session, which arrives as `null`. The dock count and auto-open leak is finding 2.

What defines "scoped": `SESSION_CONTEXT` only, which is correct and matches how ChatView, the chat input, the effort/model selectors and `workflow-card` decide scope.
- Rail detail (`canvas-detail-transcript.component.ts:48`) and canvas tiles provide it.
- `canvas-rail-card.component.ts:37` provides only `SESSION_CARD_ACTIONS`, because it hosts only the compact card.
- R9d's compact card uses `cardActions || sessionContext`. That is fine for the card but must not be copied to the panel or ChatView.

R9n risk: R9n's `SESSION_CARD_ACTIONS` provider in the single chat view cannot flip the panel strict, because the panel never reads `SESSION_CARD_ACTIONS`. The real exposure is in code that does key on the action token: the compact card, which R9n's own contract already covers, and any future R9h `sessionAgents` change. R9h must key on `SESSION_CONTEXT` alone and carry a spec for "single chat view with a `SESSION_CARD_ACTIONS` provider stays tolerant".

Silent failures: finding 1 (`clearCompleted()` global wipe and active-tab fallback look like normal results). Finding 2 (a count that disagrees with the body).

Stale state: none new. The `strictSessionScope` read is a construction-time snapshot, which is correct because a host never gains or loses `SESSION_CONTEXT`. `selectedAgentId` can still point at an agent that the strict filter removes. `_selectableKeys` is derived from the filtered set, so this is benign.

Missing cases: scoped host with `sessionId = null`; `onClearCompleted` in a scoped host; a real-store test; the ChatView `sessionAgents` strict path (R9h).

## Data flow (condensed)

1. Store agents and subagents: OK.
2. ChatView `sessionAgents` (tolerant) feeds the dock `[agents]` and the panel `embeddedAgents`: GAP (finding 2).
3. `resolvedSessionId()` null when unresolved, passed as the panel `sessionId`: GAP (finding 1).
4. Panel `effective*` filters: OK for string ids, GAP for `null` under `SESSION_CONTEXT`.
5. Group, tile and count derivations: OK.
6. Permissions filter: OK.
7. `onClearCompleted`: GAP (global wipe on `null`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Scoped workflow/session groups strict | PARTIAL | Resolved ids only; `null` under `SESSION_CONTEXT` leaks (1) |
| Main-panel host tolerant, shows unresolved agents | COMPLETE | None |
| Pin / close / per-tab dock state | COMPLETE | State and component specs pass; width switch is R9h |
| Parity row 70 | COMPLETE | |
| Parity row 74 (Agents tab and per-session count) | PARTIAL | Dock count tolerant (2) |

## Verdict

- Recommendation: APPROVE-WITH-FIXES
- Confidence: HIGH on the code reading; the specs pass but do not cover finding 1.
- Top risk: the strict gate is bypassed when a Rail host's session is unresolved, because the host passes `null` while the panel and specs assume `''`. This is latent until R9f removes `HIDE_AGENT_SIDEBAR`.
- Required before commit: fix finding 1 and its specs, which stays inside R9e's four files. Hand finding 2 to R9h as an explicit contract line with specs, and gate R9f's removal of `HIDE_AGENT_SIDEBAR` on it. Findings 3-5 can follow in R9h or R9e.

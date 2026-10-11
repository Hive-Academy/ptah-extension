# TASK_2026_524_1125 — Batch 3b at-risk follow-up

## Files changed

- CREATED `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.ts` — root `AgentFollowUpQueueService` plus the pure helper `followUpResumesInstead(agent)`.
- CREATED `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.spec.ts` — 10 tests, no component created.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts` — now a thin view over the service. The template is unchanged.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts` — the store stub now carries an `agents` signal. The flush tests publish agent states through a `publish()` helper (the store signal plus the input).
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — eager `_agentFollowUps = inject(AgentFollowUpQueueService)` next to `_notificationLedger`, with a comment.
- MODIFIED `app-shell.auth-redirect.spec.ts`, `app-shell.organization.spec.ts`, `app-shell.retained-chrome.spec.ts` — added `{ provide: ThemeService, useValue: {} }` and `{ provide: AgentFollowUpQueueService, useValue: {} }`, and the `ThemeService` import from `@ptah-extension/core`. retained-chrome also gets a source assertion for both `= inject(ThemeService)` and `= inject(AgentFollowUpQueueService)`.
- `app-shell.notification-center.spec.ts` and `app-shell.outlet-wrapper.spec.ts` do not build the shell, so they needed no change.

## Design

- **State.** The state is keyed by `agentId` in four signals: `_queued`, `_undelivered`, `_errors` (each a `ReadonlyMap<string,string>`) and `_sending` (a `ReadonlySet<string>`). Public reads are `queued(id)`, `undelivered(id)`, `error(id)` and `sending(id)`. They read signals, so they react inside a component `computed`.
- **Flush.** A root `effect` in the constructor tracks only `AgentMonitorStore.agents()`. Everything else runs `untracked`, so a `busy` re-queue cannot re-trigger the flush that produced it. For each queued agent:
  - A `lastSeen` map holds the agent object last considered. The flush retries only when that agent's card object changes, which is the same cadence as the old per-card `effect(agent())`. Updates to other agents do not cause a `busy` retry storm. A spec pins this.
  - When the agent is not `running`, the entry is dropped and `send(agent, pending)` runs.
- **send(agent, message).** The logic moved over unchanged:
  - The resume short-circuit when `followUpResumesInstead`.
  - `busy` re-queues the message.
  - `not_found`, `released` and `unsupported` go through `sendByResuming`.
  - Any other code, a thrown error, or a failed or impossible resume goes to `fail()`. `fail()` appends the text to `_undelivered` and sets the error message, so a background failure never drops the message.
- **Failure-restore into the draft.** The component has an effect over `followUps.undelivered(agentId)`. Each time the box is attached and the service holds undelivered text, the effect calls `takeUndelivered` (one-shot) and puts the text in front of the draft. A direct send also absorbs it synchronously right after `await send(...)`, so the box is never empty in between, which the existing specs expect.
- **Dismissed agents.** State for an agent that leaves `agents()` is pruned. In the store only `removeAgent` (a dismissed card) removes an agent, so this matches the old behaviour, where the component and its queue were destroyed together. The pruning keeps the maps bounded.
- **Component.** `draft` stays local. `queued`, `submitting` and `error` are computeds over the service. `submit` sends `enqueue` or `send`, and `unqueue` sends `followUps.unqueue` and then puts the text in front of the draft. Coalescing with `"\n"` is kept.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts <queue service spec> <agent-continue-input dir> <app-shell* specs> <agent-monitor-panel* specs> <agent-lane-panel.spec.ts> --coverage=false --maxWorkers=2`: **Test Suites: 10 passed, 10 total. Tests: 136 passed, 136 total.**
- `npx nx typecheck @ptah-extension/chat --parallel=1`: **Successfully ran target typecheck** (the printed template warnings are in files I did not touch).
- `npx nx lint @ptah-extension/chat --parallel=1`: **0 errors**, 35 warnings that were already there. ESLint on the touched files reports one warning, at `app-shell.component.ts:491` (no-empty-function), which predates this change.

## Residual risk

1. **Multiple boxes for one agent.** If two cards for the same `agentId` are attached at once, the first to run its effect takes the undelivered text. The text is still delivered to exactly one box, never duplicated or lost.
2. **Undelivered text while no box is ever shown.** It stays in the service until a box for that agent attaches, or until the card is dismissed, which drops it. A dismissed card dropped its queue before this change too.
3. **The busy cadence depends on stable object identity.** `AgentMonitorStore.agents` is `computed(() => [...this._agents()])`, which keeps the element references of unchanged agents. If the store ever started cloning every agent on every update, a `busy` re-queue would retry on any store change. That stays correct but is noisier.
4. **The ElectronShell does not inject the service itself.** It hosts `AppShellComponent`, which injects it, so the service still starts eagerly there.

## Assessment: ChatInputComponent queue-restore (chat-input.component.ts:1509-1517). Not changed.

- `ConversationService` sets `_queueRestoreSignal` in the abort path when the active tab had queued content. The signal is root state and persists. The effect in ChatInputComponent consumes it once: it restores the content if the active tab matches, then clears it either way.
- While the row is detached, the effect pauses. The signal is not lost: it is applied on the first change detection after the row reattaches.
- Aborts are user-initiated from the chat UI (the stop control lives in the retained row), so the "abort while detached" window is narrow.
- **Real but minor gaps:**
  - (a) Two aborts with queued content before reattach: the second overwrites the first. This is unlikely, because restore clears the tab's queue.
  - (b) If the active tab changes before reattach, the one-shot clears the content without restoring it. Both tab change and abort need the chat chrome, so this is unlikely while detached.
  - (c) On a standalone-first boot, ChatInput does not exist. Nothing can set the signal before chat is opened, so nothing is lost.
- **Verdict:** low risk. No trivial and safe change is warranted. Making it robust would mean a per-tab restore map in `ConversationService`, consumed by tab id. That is out of scope here.

## Round-2 fix (batch3b-review-r2.md, item B)

- **Defect.** `send` held the `MonitoredAgent` it was given across `await continueAgent(...)`. If the store merged a late `cliSessionId` into that card while the RPC was pending (`agent-monitor.store.ts:1147, 1387`) and the RPC then answered `not_found`, `released` or `unsupported`, the fallback reported "Agent expired and has no session to resume." while a session existed.
- **Fix** (`agent-follow-up-queue.service.ts`). A new private `latestCard(snapshot)` returns the store's current card for the `agentId`. When the card is gone, it returns the snapshot. `send` now uses it twice:
  - at entry, for the `followUpResumesInstead` short-circuit;
  - after the await, for the `sendByResuming` fallback, so the `cliSessionId` check and the resume request both see the latest card.
- **Coverage.** `send` is shared by the direct send and the background flush, so both paths are fixed.
- **Specs added:**
  - `agent-follow-up-queue.service.spec.ts`: "resumes with the latest card, not the snapshot taken before the await". This is the flush path, with a deferred `continueAgent` and `cliSessionId` merged mid-flight.
  - `agent-follow-up-queue.service.spec.ts`: "falls back to the snapshot when the card is gone by the time the RPC answers".
  - `agent-continue-input.component.spec.ts`: "resumes with a cliSessionId the store merged while continue was pending". This is the direct-send path.
- **Verification.** `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-continue-input --coverage=false --maxWorkers=1`: **Test Suites: 2 passed, 2 total. Tests: 37 passed, 37 total.**
- **Not run, as instructed:** nx typecheck and nx lint (left to the orchestrator).

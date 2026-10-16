# Batch 40a report: P4 fix round, decision-model config RPC

Executor: backend-developer subagent. Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`.
No git command was run. No Nx, Jest, tsc, eslint, build or diagnostics were run. Only `npx prettier --write` was run on the
7 changed files. Prettier rewrote the handler and the decision-model spec; the 5 sibling specs were already formatted.

## Changed files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.decision-model.spec.ts`
- MODIFIED (test mock only, two lines each, approved by the orchestrator as option A) in the same folder:
  `agent-rpc.handlers.spec.ts` (:168-169), `agent-rpc.handlers.list-rows.spec.ts` (:111-112),
  `agent-rpc.handlers.migration.spec.ts` (:114-115), `agent-rpc.handlers.resume-parent-session.spec.ts` (:189-190),
  `agent-rpc.handlers.set-config.spec.ts` (:114-115). Each mock now has
  `getSelection: () => ({ kind: 'unset' as const }), localityOf: () => null,`.

I did not touch `agent-outcome-rpc.handlers.ts` or its spec. Their diffs in this lib belong to the other writer.

## S-1: a `getStatus()` failure no longer fails `agent:getConfig`

- Before: `agent-rpc.handlers.ts:462` had `decisionModel: await this.decisionModelConfig.getStatus()` inside the single
  result literal. Any rejection reached the outer catch (`:470-477`), which rethrew, so the whole config read failed.
- After: `:479` calls `this.readDecisionModelStatus()`, defined at `:506-567`. It works in four steps:
  1. `getStatus()` runs inside its own try. If it rejects, the code calls
     `logger.error('RPC: agent:getConfig decision model status failed; returning the stored selection', <real Error>)`.
  2. Then it reads the stored selection without the probe through `getSelection()`. That method is synchronous and only
     reads config (`libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:128-145`).
     - If the read succeeds, the row is that selection with state `'unreachable'` and the fixed detail
       `DECISION_STATUS_UNREAD_DETAIL` (`:285`): "The status could not be read. The saved choice is unchanged."
     - `reportsConfidence` follows the service's own rule (`decision-model.config.ts:694-695`, ollama or jev).
     - `locality` comes from `localityOf()` (`decision-model.config.ts:229-243`). If that throws, the code calls
       `logger.warn(..., <real Error>)` and `locality` is `null`.
  3. If the stored selection is `unset`, the code returns the plain `unset` row. See Decisions, D2.
  4. If `getSelection()` also throws, the code calls `logger.error(..., <real Error>)` and returns
     `{ selection: unset, locality: null, reportsConfidence: false, state: 'unreachable', detail: DECISION_SELECTION_UNREAD_DETAIL }`
     (`:287`): "The saved decision model could not be read. It is unchanged." See Decisions, D1.
- The client never sees raw error text. Both detail strings are fixed module constants.
- The constructor type widens to `Pick<DecisionModelConfig, 'getStatus' | 'getSelection' | 'localityOf' | 'setSelection' | 'setJevApiKey'>`
  (`:338-345`). The DI token and the registration did not change, because the bound value is the full
  `DecisionModelConfig` class.
- The degradation audit should not count any of the three new catches. The first two each call `.error(...)`. The third
  has no `return`, so it is not the `catch-return-sentinel` shape (`tools/degradation-audit/check-degradation.ts:5-7`). No
  suppression comment was needed, and no baseline changed.
- The shared contract (`rpc-agents.types.ts`) is unchanged. Every row stays in the five states from decision #46.

## S-2: the Jev key is written before the selection

- Before: `:567-574` called `setSelection` first and `setJevApiKey` second.
- After: `:654-660` calls `setJevApiKey(params.decisionModelJevApiKey)` first and `setSelection(params.decisionModel)`
  second. Both still run before every other write. If either rejects, the error reaches the existing catch in
  `applySetConfig`, which returns `success: false`. That catch logs only `errorType`, and the client gets fixed text or
  the `SettingsPersistError` message.
- The key is still write-only. The handler never logs it or returns it. The debug log has field names only.

## Spec cases (`agent-rpc.handlers.decision-model.spec.ts`)

New `describe('agent:getConfig decision model status failure (P4 S-1)')`:
- `returns the other fields and an unreachable row for the stored selection when getStatus rejects` (:273). Checks that
  `detectedClis`, `maxConcurrentAgents`, `piModel` and `workflowsDisabled` are returned, the exact five-state DTO, that
  no raw text appears in the config, `logger.error` called with the same Error instance, and no write calls.
- `reports a structured selection without confidence when getStatus rejects` (:301)
- `keeps a stored unset selection unset when getStatus rejects` (:323)
- `returns an unset unreachable row with fixed detail when the selection cannot be read either` (:331). Checks that both
  Errors were logged, there is no raw text, and `setSelection` was not called.
- `returns the row without a locality when localityOf throws` (:362). Checks that `logger.warn` got the Error.

Added to `describe('agent:setConfig decision model')`:
- `writes the Jev key before the selection (P4 S-2)` (:471). Checks the order with `invocationCallOrder`.
- `does not write the selection when the Jev key write fails (P4 S-2)` (:485). Checks `success: false`, that
  `setSelection` was not called, that no other field was written, and that the secret appears in neither the result nor
  the error logs.
- `returns success false when the selection write fails after the key was stored (P4 S-2)` (:507)

The double (`DecisionModelDouble`) gained `getSelection` and `localityOf` mocks, which default to the harness status.
The spec adds no `as unknown as`, no `any` and no `@ts-ignore`. The existing harness casts were already there.

## Decisions

- **D1: the DTO when the selection itself cannot be read.**
  - Options: (a) fail the whole config, which is S-1 again. (b) Return a non-unset selection, which would invent one.
    (c) `unset` with `'unreachable'` and fixed detail.
  - Chose (c). The contract has no "unknown selection" kind (`rpc-agents.types.ts:110-118`), and decision #46 fixes the
    five states.
  - The UI cannot overwrite the stored selection just by loading. In
    `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`, `reload()` (:460-476) only calls
    `agent:getConfig`. The only writes are `save()` (:535), `removeJevKey()` (:555), and `onKind('unset')` (:513). All
    three need a user action. `onKind` fires only on a change event, and the draft is already `unset`.
  - `canSave` (:428-436) is false for an unchanged `unset` draft.
  - The row shows "Could not reach ..." and the fixed detail, so the user can see the read failed.
  - Residual risk, reported here and not edited (the row is out of scope): when the selection could not be read, the cell
    label still reads "Unset · code ranking" (`provider-consumer-rows.ts:527-529`). If the user then saves a new choice,
    the Undo offered for that save would write `{ kind: 'unset' }` (`decision-model-row.component.ts:546-549`, where
    `previous` is the status selection). Batch 40b could treat `state === 'unreachable' && selection.kind === 'unset'` as
    not read, which means no Undo and the "not reachable" cell.
  - Reversible: yes, handler-local.
- **D2: a stored `unset` stays `unset` in the fallback, not `'unreachable'`.**
  - `statusForCurrent` returns `unset` without any I/O beyond `getSelection` (`decision-model.config.ts:260-263`).
  - An unset selection sends no request, so "unreachable" would be false. The row would also say "Could not reach ...",
    naming no server (`provider-consumer-rows.ts:470-471`).
  - This departs from the literal brief, which said `'unreachable'` for every fallback, in favour of the accurate state.
  - Reversible: yes.
- **D3: key before selection.** A key write that fails leaves the selection unchanged, which matches the UI's
  `SAVE_FAILED` sentence.
  - If the selection write fails after the key was stored, the result is `success: false` and only the key has changed.
    That is harmless: the key changes no routing while the selection is not Jev. If the selection already is Jev, a
    replaced key is what the user typed.
  - A blank key (delete) is never sent together with a selection: `save()` sends the key only when it is non-blank
    (`decision-model-row.component.ts:538-542`). So there is no case where a delete succeeds and the selection write
    then fails.
  - The selection schema is not exported from the `@ptah-extension/lane-routing` barrel (`libs/backend/lane-routing/src/index.ts:15-26`),
    so the selection could not be validated before the key write without changing lane-routing. As a result, an invalid
    selection sent with a key now stores the key and returns `success: false`. That is the same harmless outcome.
  - Reversible: yes.
- **D4: widening the Pick type and adding the sibling spec mocks.** The orchestrator approved option A. Without
  `getSelection`, the fallback could not report the stored selection.

## Not done

- No verification run, per the batch rules. The orchestrator still needs to run
  `npx nx test rpc-handlers --parallel=1` and `npx nx typecheck rpc-handlers`.
- The D1 residual risk in the frontend row is reported for Batch 40b and not edited.

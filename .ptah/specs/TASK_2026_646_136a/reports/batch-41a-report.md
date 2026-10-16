# Batch 41a report — P4 final review Serious defect 1 (Jev key + selection write)

**Scope:** user-approved extra fix for `reviews/p4-final-code-logic-review.md` defect 1.
`agent:setConfig` stored the Jev key, then the selection. When the selection write failed, or the
selection payload was invalid, the new key stayed stored. If Jev was already selected, that key
was live. The RPC still returned `success: false`, and the row said "The saved choice is
unchanged".

## Changes

### `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`

- `:52` imports `DecisionModelSelectionSchema` from `@ptah-extension/lane-routing`.
- `:86-92` adds `DECISION_MODEL_KEY_MAY_HAVE_CHANGED`. This fixed client text is returned only
  when the rollback fails: "Could not save the decision model. The TypeSafe Jev API key may have
  changed."
- `:348-355` adds `readJevApiKey` to the injected `Pick<DecisionModelConfig, ...>`.
- `:620-631` (validation block, before any write) parses `params.decisionModel` with the same
  schema `setSelection` uses. An invalid selection returns
  `{ success: false, error: 'Unsupported decisionModel value' }` and writes nothing, including no
  key. The parsed selection, with the Jev model default applied, is what gets written.
- `:668-677` replaces the old comment and the two inline writes with one call to
  `writeDecisionModel`. The new comment says only what is true: these writes run first and the
  selection is already validated.
- `:813-863` adds the new `writeDecisionModel(jevApiKey, selection)`:
  - Key only: `setJevApiKey`. Selection only: `setSelection`. No key read in either case.
  - Both: `readJevApiKey()` runs first, then `setJevApiKey(new)`, then `setSelection`. A failed
    read or a failed key write rejects before anything else is written, so the S-2 order holds.
  - Selection write fails: `setJevApiKey(previousKey)` restores the old key; `null` deletes the
    new one. The original error is then rethrown. The outer catch returns fixed text
    (`SettingsPersistError.message` or "Could not save the orchestration settings.").
  - Restore fails as well: the handler logs
    `RPC: agent:setConfig could not restore the previous decision model key` with
    `{ selectionErrorType, restoreErrorType }` only, and returns
    `DECISION_MODEL_KEY_MAY_HAVE_CHANGED`. The log never contains the key or a raw message.
    Nothing is swallowed silently.

### `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`

- `:186-195` adds `readJevApiKey(): Promise<string | null>`. It returns the stored key trimmed,
  or `null` when no key is stored or the stored value is blank. Its doc comment limits it to
  rollback use and says the value must never be logged, echoed or sent across a boundary.

### `libs/backend/lane-routing/src/index.ts`

- `:19-27` exports the value `DecisionModelSelectionSchema`. The existing type-only exports are
  folded into the same statement as inline `type` specifiers.

### Specs

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.decision-model.spec.ts`
  - Double and harness gain `readJevApiKey` (default `null`).
  - `:442` invalid selection now returns `Unsupported decisionModel value`. Neither
    `setSelection` nor `setJevApiKey` runs.
  - `:457` **invalid selection + key: no key read and no key write**, and the key is not echoed.
  - `:476` the parsed selection (`{ kind: 'jev', model: 'jev-1.13.0' }`) reaches the service.
  - `:535` **selection write fails: the previous key is restored**. Calls are
    `[[new], [previous]]` and the read comes before the write. The result is `success: false` with
    `SettingsPersistError` text. Neither key appears in error or debug logs.
  - `:569` **previous key absent: rollback calls `setJevApiKey(null)`**, which deletes the key.
  - `:586` **rollback fails: fixed "may have changed" error**. The fixed log text carries error
    types only and neither key.
  - `:618` the previous key cannot be read: nothing is written, and the generic fixed error is
    returned.
  - `:635` a key sent alone reads no previous key.
  - The old test "returns success false when the selection write fails after the key was stored"
    is replaced by `:535`.
- `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.spec.ts:742` covers the
  new API. `readJevApiKey` returns `null` with no key, the trimmed value after `setJevApiKey`, and
  `null` for a blank stored value. `setJevApiKey(null)` removes the entry.
- `readJevApiKey: () => Promise.resolve(null)` is added to the decision-model stub in
  `agent-rpc.handlers.spec.ts`, `.set-config.spec.ts`, `.migration.spec.ts`, `.list-rows.spec.ts`
  and `.resume-parent-session.spec.ts`. The wider `Pick` needs it to type-check.

## Decisions

- **Where validation lives:** the handler parses with the exported lane-routing schema instead of
  calling a new service method. That is the same schema `setSelection` uses, so the two cannot
  drift. Reversible.
- **How the previous key is read:** through a new `DecisionModelConfig.readJevApiKey()`. The
  handler does not inject `ISecretStorage` and does not learn the secret's storage key. The
  rollback stays in the handler, where the brief places the specs. Reversible.
- **Invalid selection error text:** "Unsupported decisionModel value". This matches the other
  `Unsupported <field> value` validation errors in the same method.

## Verification

- No nx, jest or tsc run, per the brief. The orchestrator runs the checks.
- `ptah_get_diagnostics` (TypeScript compiler, errors only), scoped to the five changed
  lane-routing and decision-model files: 0 errors, coverage clean. Sibling files in the same
  projects are included in that check, so the five sibling spec stubs are covered too.

## Out-of-scope observations

- `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:628-643`
  (`write`) ignores the host `error` text. Any failure shows `SAVE_FAILED` ("... The saved choice
  is unchanged."), defined at `:56`. With this batch that sentence is true whenever the rollback
  succeeds. In the rare double failure (selection write and key restore both fail), the host
  returns "The TypeSafe Jev API key may have changed", but the row still shows "unchanged". A
  frontend follow-up should show a different sentence when the host error is
  `DECISION_MODEL_KEY_MAY_HAVE_CHANGED`. Not edited, because frontend files are outside this
  batch.

## Revise round 1 (41f)

Fixes `reviews/batch-41-code-logic-review.md` NEW defect 2 (concurrent saves) and hardens
NEW defect 1 (post-write rejection).

### `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`

- `:292-311` adds the module function `sameDecisionModelSelection(a, b)`. It compares two
  parsed selections by kind, model and provider id.
- `:313-316` adds `errorTypeOf(error)`. `writeDecisionModelNow` uses it in place of its local
  closure.
- `:831-893` `writeDecisionModel` keeps the 41a order: read the key, write the key, then write
  the selection. If the selection write rejects, `storedSelectionState(selection)` runs first
  (`:872`). When it answers `'stored'`, the handler logs a warn with the error type only,
  keeps the new key, and rethrows. The outer catch then returns the existing fixed text.
  Otherwise the rollback runs as before. The doc comment (`:850-851`) now says that
  overlapping saves cannot interleave because every call runs through `setConfigQueue`.
- `:895-919` adds `storedSelectionState(selection): 'stored' | 'not-stored' | 'unreadable'`.
  It compares `decisionModelConfig.getSelection()` with the requested selection. If the read
  throws, the catch logs a warn with the error type only and answers `'unreadable'`, so the
  previous key is restored as before. The catch carries the marker
  `// degradation-audit: reported — ...` as its first body line (`:911`, audit zone 2). On
  `} catch` style, the line above the catch is code, so zone 1 cannot hold it.

**No new queue (correction in round 1).** The first 41f draft added a decision-model write
queue. `agent:setConfig` has been serialized since batch 25 (`08e51a353`):
`registerSetConfig` (`:593-608`) runs every call through `setConfigQueue` (`:337`). That
already covers `writeDecisionModel`, because `applySetConfig` is its only caller, so review
defect 2 could not occur in the committed code. The redundant queue was removed. The brief's
rule "calls without decision-model fields are not delayed" conflicts with that queue, which
exists so validation and the lane-guard steer/stop write order see a settled store. That
rule is not implemented; see Decisions (41f).

### `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.decision-model.spec.ts`

- `:125-129` adds `flushAsync()`, a `setImmediate` flush.
- `:640` **the selection was stored before its write rejected: the new key is kept.**
  `setJevApiKey` calls are `[[new]]`, and the result is the generic fixed text. The warn log
  carries the error type only, and no log contains either key.
- `:676` **the stored selection cannot be read after a failed write: the previous key is
  restored.** Calls are `[[new], [previous]]`, the result is the `SettingsPersistError` text,
  and the read failure is logged as a warn.
- `:705` **overlapping saves.** A's selection write is held on a deferred promise. B is sent
  while A is pending and does not read or write the key until A settles. A's write then
  rejects: A rolls back to K0, then B writes K2 and succeeds. Key writes are
  `[[K1], [K0], [K2]]`, the stored key ends as K2, A returns `success: false` and B returns
  `success: true`. Without `setConfigQueue`, the stored key would end as K0. This spec is the
  regression pin for review defect 2.
- `:760` **a save without decision-model fields runs after a pending save settles.** C
  (`piModel` only) writes nothing while A's selection write is pending. A is rejected, both
  promises are awaited, C returns `success: true` and `piModel` is stored. Every deferred the
  spec creates is settled before it ends. The first draft awaited C before rejecting A, so it
  timed out at 5000 ms.
- The 41a rollback specs (`:540`, `:574`, `:591`, `:623`) are unchanged. Their default
  `getSelection` returns `{ kind: 'unset' }`, which differs from the requested Jev selection,
  so the rollback path still runs.

### Decisions (41f)

- **Result when the selection was stored:** the handler rethrows the original error, and the
  outer catch returns the existing fixed text (`SettingsPersistError.message` or "Could not
  save the orchestration settings."). No new client text was added. Reversible.
- **Overlapping saves stay serialized by the existing `setConfigQueue`, and no bypass was
  added.** Options:
  - (a) Keep the whole-call queue. Chosen.
  - (b) Let calls without decision-model fields skip it.

  Evidence: `registerSetConfig` documents that the queue stops two overlapping calls from
  leaving a stop <= steer lane-guard pair. Validation (`invalidLaneGuard`) and
  `laneGuardWriteOrder` read stored values. A bypass would reopen that race. It would also
  need a second queue for the decision-model section. Reversible: the orchestrator can ask
  for (b) with a split queue.
- **Degradation audit:** marker in catch-body zone 2, not on the line above the catch,
  because the catch opens on `} catch`.

### Verification (41f)

- No nx, jest or tsc run, per the brief.
- `ptah_get_diagnostics` (TypeScript compiler, errors only), scoped to the two changed files:
  0 errors, coverage clean.

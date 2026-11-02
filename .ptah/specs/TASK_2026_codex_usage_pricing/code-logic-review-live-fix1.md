# Code Logic Review — live-fix1 (PR #886)

Score: 6/10. Verdict: REVISE. Blocking 0, Serious 3, Moderate 4.
Scope: `git diff -- libs` in the worktree (9 files), read against `codex-context.ts`, `codex-chat-turn-stream.ts`, `provider-owner.resolver.ts`. Nothing executed, as instructed. The new specs are unexecuted and I did not run them.

## Serious

### S1. Model switch mid-session is attributed to the old model
- `codex-context.ts:257` seeds `threadModels` once from `thread/start` or `thread/resume`. `codex-event-translator.ts:332-333` keeps that value for every later model-less `tokenUsage/updated`, which is the live shape.
- A model change goes through the settings patch (`codex-context.ts:816,842`) and reaches `turn/start` via `settings.model` (`:515`). Nothing calls `setThreadModel` there.
- Scenario: a thread starts on model A and the user switches to B. B's usage notifications carry no model, so they are stamped as A. The turn is priced at A's rate (`codex-chat-turn-stream.ts:231`). The snapshot shows model A (`usage-owner.ts` snapshot, root `modelId`), and `covered-by-subscription` or `estimated` is asserted over the wrong rate card.
- This is a silent wrong answer, not an error. Before the fix it was "Cost unavailable", which was honest.
- Fix: call `translator.setThreadModel(threadId, settings.model)` when a `turn/start` is accepted. Also update from a validated `turn/start` response if it carries a model. Add a spec for A then B with model-less notifications.

### S2. Billing basis is session-wide and relabels history
- `codex-chat-adapter.ts:327` calls `setBillingMode(prepared.billingMode)` on every adapter start or resume. `serialize` then writes that mode (`usage-owner.ts:304`) and `snapshot` and `lifetimePrice` apply it to the whole lifetime cost (`:200-205,316`).
- If a session started under an API key is resumed under a ChatGPT login, or the reverse, all earlier turns flip between `estimated` and `covered-by-subscription`.
- A cost that was real spend becomes "covered", or the reverse. Per-turn `costBasis` is already computed by `calculateExactMessageCost`.
- Fix: record the basis per priced turn. Downgrade the lifetime basis to `unknown` or `mixed` when the mode changes (a `billingModeChanged` flag in the checkpoint).

### S3. The specs do not assert the real chain
- `codex-session-usage-owner.spec.ts` computes the price itself with `calculateExactMessageCost` and feeds it to `recordTurnPrice`. It never exercises the translator, then the owner, then the turn-stream pricing path that failed live.
- The translator spec checks only `setThreadModel`, then a model-less notification.
- Missing cases:
  - model switch mid-session (S1);
  - `thread/resume` seeding the model (`codex-context.ts:257` has no spec);
  - child thread with a different or no model;
  - restore of a pre-fix checkpoint without `billingMode`, `modelId` or context fields;
  - billing mode change (S2).
- The plan-limits spec uses a discovered owner for `/home/codex`. It does not cover the actual ambient-only case: `ownerForCodexHome` returning an unread or unknown key, or a `normalizedHome` alias of the default home that `provider-owner.resolver.ts:600-615` normalises.

## Moderate

- M1. `usage-owner.ts` `accept()` returns early at the `!changed && same turn && same terminal` check. A model or context-window update that arrives with unchanged counters is dropped. Persisted model and context can therefore stay blank for a turn whose first event carried the model.
- M2. `plan-limits-snapshot.service.ts:~275` catches the metadata lookup error and logs at debug. The user then sees the same "Account not resolved" as for an unlinked session. Log at warn, or expose a distinct reason.
- M3. The native session is mapped to the home's current account (`ownerForCodexHome` returns the last-read key). If the login in that home changed after the session was created, the session is shown against the new account. Acceptable, but document it. It does not leak another home's limits: the `codexOwners.has(owner.key)` gate and the unknown-key fallback keep the mapping home-bound.
- M4. Context tokens use `root.lastRequestTotalTokens` unclamped. A stale value against a changed model window can give a context % above 100 or one tied to the wrong window. `modelContextWindow` is persisted per thread, not per model. After a model switch the old window is kept until a new notification supplies one.

## Checked and fine

- Zod: new checkpoint fields are optional, so old checkpoints parse. `.strict()` still holds, and `modelContextWindow` is positive. `setThreadModel` trims and ignores a blank model. The thread/start response model is already schema-validated.
- Claude and other providers: the plan-limits changes only touch sessions with `codexExecution.runtime === 'codex-app-server'`. Metadata and resolver are optional injects. Ledger owners win (`!result[sessionId]?.ownerKey`).
- No double counting: model and context are carried on the existing thread record without changing the accrual math.
- Child threads: with no entry in `threadModels` they stay model-less, so they are not mis-priced with the root model. They remain unpriced and the price stays incomplete, which was already the behaviour.

## Five questions (short)
1. Silent failure: S1 (wrong rate presented as exact) and M2.
2. User action: switching model mid-session (S1); resuming under a different auth (S2).
3. Wrong-answer data: model-less usage after a model override; context window stale after a switch (M4).
4. Dependency failure: metadata read failure is swallowed (M2); old checkpoints stay unpriced, as the report admits.
5. Missing: per-turn basis, spec coverage for resume, ambient-home alias.

## Verdict
REVISE. The three live defects are plausibly addressed for the single-model, single-auth path. S1 and S2 can produce confidently wrong cost labels in realistic flows, and the specs would not catch either.

# Code Logic Review - Batch 2 (Durable owner)

Review family: claude (in-process subagent); implementer: codex

Scope: `codex-session-usage-owner.ts` (+spec), `session-metadata-store.ts` (+spec), `session-history-reader.service.ts` (+spec). Static read only; nothing executed (as instructed). Specs were not type-checked.

Score: 6/10. Verdict: REVISE.

## Defects

1. SERIOUS - `codex-session-usage-owner.ts:144` and `:159`. The owner treats `sessionId` (a Ptah session id) as the root native thread id. A root thread is identified as `threadId === this.sessionId`. In production the Codex thread id differs from the Ptah session id, so every root-thread evidence lacking `parentThreadId` marks coverage `partial` with `missing-parent`. `snapshot()` also looks up `threads.get(this.sessionId)` for the model and falls through to alphabetical order. The spec hides this because it uses `new CodexSessionUsageOwner('root')` with `threadId 'root'`. Fix: pass the root thread id (from `codexExecution`) to the owner/checkpoint, or mark root by absence of `parentThreadId`, and test with distinct ids.

2. SERIOUS - `codex-session-usage-owner.ts` (whole `accept`), checkpoint schema `:19-28`. The owner sums parent and child threads as disjoint, but whether the native parent `total` already folds child usage is UNCONFIRMED (research doc and the report's open risks). It is not carried as a flag, coverage marker or diagnostic, so a double count is undetectable after persistence. Fix: add a persisted `childAttribution: 'unverified' | 'disjoint'` field (or force `coverage: 'partial'` while child threads are present and unverified) so the UI/pricing batch can label it. Batch 4 should resolve it by an authorized live observation.

3. SERIOUS - `session-metadata-store.ts` `updateCodexUsageCheckpoint` (about 1198-1228). The write is a snapshot overwrite with no monotonic guard. Two writers (a resumed owner restored from older state, or a lane and a parent process) are last-write-wins and can lower the lifetime total. Fix: inside the queued write, compare against the stored checkpoint (via `restore`) and reject or merge when any class total, or the per-thread epoch/accrued, decreases.

4. MODERATE - `session-metadata-store.ts` direct-write guard (about 1277-1280). Any ordinary `save()` carrying a stale `codexUsageCheckpoint` (read before a checkpoint update, `JSON.stringify` differs) throws `direct-runtime-write`. A routine sidebar/lastActive save racing a checkpoint write fails for an unrelated reason. This matches the existing pattern for `codexThread` and `codexMessageCount`, but it is a new failure path on a hot write; consider silently carrying the stored value forward instead of throwing.

5. MODERATE - `codex-session-usage-owner.ts:131`/`:137-143`. A late event for the same turn with equal counters and a differing terminal state is accepted and overwrites `terminalState`, including a downgrade from `completed`/`failed` back to `none`. Late-after-terminal supersede (N2) works for counters, but terminal states should not regress. Fix: keep the stronger terminal state, or reject `none` after a terminal state for the same turn.

6. MODERATE - `codex-session-usage-owner.ts:109-110`. Same `totalTokens` with differing classes returns false silently with no diagnostic and no `partial`; `:111` and `:126-128` set partial without a diagnostic or with the misleading `counter-decrease` reason. The class mismatch loses information the way a decrease does. Fix: add dedicated diagnostics (`class-conflict`, `classes-inconsistent`, `reasoning-exceeds-output`).

7. MODERATE - unbounded growth. The `threads` array (`:27`) has no `.max()` in the schema and no pruning; every child thread persists forever in metadata JSON that is rewritten on every checkpoint update. Fix: cap (for example 256) and fold overflow into a single aggregate "other" entry or mark partial; add `.max()` to the schema so a huge file is rejected cheaply.

8. MODERATE - `session-history-reader.service.ts:381-392`. The metadata read now runs for every history read, including Claude. It is cheap and the Claude path is otherwise unchanged. Two concerns: `metadataStore.get` rejecting would abort the history read (not isolated by its own try/catch), and `messageCount: 0` in the snapshot (`owner :168`) is a placeholder that may misreport history-sourced message counts. Fix: wrap the checkpoint read in try/catch and fall back to the Claude path with a logged warning; source `messageCount` from `codexMessageCount`.

9. MODERATE - `session-history-reader.service.ts:418-440`. A rejected checkpoint (corrupt or unknown version) still returns an owner snapshot (`status: 'empty'`, zero tokens, `partial`) and replaces `publishHistoryStats`. That is the intended "empty + partial + diagnostic", and it is logged. The sidebar metadata keeps its old totals while the history snapshot shows zero, so the two views disagree in that state. Fix: report the discrepancy in the snapshot, or fall back to the metadata totals.

10. MINOR - persisted-format hygiene. `catalogSource` and `catalogVersion` are always `null` placeholders (`owner :153`). Add a comment, or drop them until batch 3. Metadata `totalCost: 0` is a placeholder for "unknown" (acknowledged in the report) and must not be shown as a price by batch 3.

11. MINOR - degradation-audit format. The new `catch`/fallback paths (`restore` returning an empty owner, the history reader's rejected-checkpoint branch, the `safeParse` fallback in the metadata store) carry no `// degradation-audit: reported - <reason>` comments. The owner file has none at all. Add them. The `restore` / metadata-store `safeParse` fallbacks should say `reported` (history logs it), but the metadata `safeParse` fallback at `session-metadata-store.ts:1160` and `:1310` silently drops a corrupt checkpoint without logging; add logging there.

12. MINOR - restore validation (`owner :68-81`). Restore does not check `accrued >= counters` per thread or that a child's `parentThreadId` exists. A forged-but-consistent checkpoint is accepted. Low risk (local file).

## Checked and OK

- Algorithm core: absolute-counter deltas, positive-only, stale/repeat no-op (`:99-131`), flagged reset gives a new epoch with the baseline reset to zero while accrued counters are retained (`:95-97`, `:113`), unflagged decrease gives partial plus the last safe total kept (`:105-108`, `:116-119`), reasoning counted inside output only (`:126`), and the sums are checked as safe integers (`:121`).
- Persistence: versioned Zod strict schema, `restore` never throws, and an unknown version gives `unknown-version` while corrupt data gives `invalid-checkpoint`, each with an empty partial owner. The aggregate is recomputed from per-thread accrued and compared. The writer validates session id, the aggregate and the native runtime (`updateCodexUsageCheckpoint`). Legacy metadata is unaffected because the field is optional; Claude sessions are untouched.
- Native identity save (`updateCodexExecution`, about 1170-1187) and `persistMetadata` now derive totals from a valid checkpoint instead of carrying stale values forward. A corrupt checkpoint falls back to the existing totals.
- Write path: the key is `codexUsageCheckpoint` in the session metadata detail, the format is the normalized checkpoint, and the only reader is the history reader plus the metadata `restore`. The write is queued, flushed and emits a change event.
- Logger only (no `console`), no `any`.

## Unverified

Specs are not type-checked or run. `reflect-metadata` and branded `SessionId` use in the new specs should be confirmed by the next verify run. The `@inject(..., { isOptional: true })` on the `SessionMetadataStore` token has not been checked against the DI registration for each host.

## Round 1

Static read only; nothing executed. Score: 8/10. Verdict: APPROVE (batch 2), with two moderate/minor follow-ups and batch 4 deferrals recorded.

### Defect status

1. FIXED - root identity separated: constructor/restore/checkpoint carry `rootThreadId` (`codex-session-usage-owner.ts:29,78,81,175,219`). Live wiring of the native root id is deferred to batch 4 (recorded in the report); history reader uses the checkpoint's own `rootThreadId` (`session-history-reader.service.ts` restore call).
2. FIXED (labeling) - persisted `childInclusion` + `childTotal`; unverified keeps children out of `total`, forces partial and `child-inclusion-unverified` (`owner:32,111,179,202`). No double count possible while unverified. Live confirmation deferred to batch 4.
3. FIXED - monotonic guard inside the queued write (`session-metadata-store.ts:167-182,1244-1252`). Reset epochs are not blocked: guard compares `accrued` and totals, never `counters`, and accrued is retained across a reset (`owner:161,174`). Epoch only compared as non-decreasing.
4. FIXED - ordinary save carries the stored checkpoint forward and re-derives sidebar totals; no throw (`store:1346-1361`).
5. FIXED - same-turn `none` no longer downgrades terminal state (`owner:184-185`).
6. FIXED - distinct diagnostics `class-conflict`, `classes-inconsistent`, `reasoning-exceeds-output` (`owner:154-173`).
7. FIXED - 256-thread cap in schema and `accept` (`owner:6,39,136-138`).
8. FIXED - metadata read wrapped in try/catch, history proceeds; `messageCount` from `codexMessageCount`; Claude path gated on `codexExecution.runtime === 'codex-app-server'` and checkpoint presence, so Claude is unchanged (`history-reader:382-411`).
9. FIXED - rejected checkpoint reports sidebar totals with `coverage: 'partial'` (`history-reader:390-401`).
10. FIXED - placeholders documented (`owner:34,212`).
11. FIXED - corrupt checkpoint now logged in metadata paths (`store:1186-1189,1244-1247,1346-1349`) and history catch (`history-reader:406-410`).
12. FIXED - restore checks accrued >= counters, root presence, parent existence, revision, aggregate (`owner:99-121`).
Batch 1 N1 (memory pruning): FIXED / N/A - only the latest checkpoint per thread is kept (bounded by 256).

### Regression checks

- Claude metadata/history unchanged; `codexUsageCheckpoint` optional, legacy metadata loads.
- History read cannot fail from the checkpoint (try/catch; `restore` never throws).
- No double counting; monotonic guard does not block a legitimate reset.
- Specs: `reflect-metadata` imported and branded `SessionId.from` used; not executed, so a verify run is still needed.

### New defects

N1. MODERATE - `codex-session-usage-owner.ts:99-121` vs `:133-205`. `accept` can build a state that its own `restore` rejects: a child thread observed before the root thread (root absent, `:112-113`) or before its parent (`:114-116`). `updateCodexUsageCheckpoint` then throws `Invalid usage checkpoint aggregate` (`store:~1236`) and that usage is not persisted. Fix: in `accept`, mark partial and track an orphan/pending parent instead of requiring presence in `restore`, or relax restore to mark partial rather than reject; batch 4 caller must catch and log persist failures.
N2. MINOR - `store:~1250`. Regression rejection reuses error code `invalid-identity`; add a dedicated code (e.g. `usage-regression`) for diagnosability. Also coverage `partial -> complete` is not treated as a regression (benign).
N3. MINOR - `history-reader:~381`. `validateSessionId` now runs before the metadata read at the top of the try; behavior is equivalent but confirm it was not duplicated by a later call in this method.

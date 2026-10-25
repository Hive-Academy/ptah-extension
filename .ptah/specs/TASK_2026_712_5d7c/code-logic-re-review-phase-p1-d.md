# Code Logic Re-Review — TASK_2026_712 P1-D fix round (commit 253942222)

- Review family: glm-5.3:cloud (Ollama) on OpenAI (Codex) + Anthropic (orchestrator fix)
- Scope: commit 253942222 only — `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
  (the new `listAccountLinkage` and its three list call sites) plus
  `session-metadata-store.account-binding.spec.ts`. Read-only review; no tests, nx, tsc,
  lint or build were run (review rules).
- Fix score: **8/10**
- Verdict: **APPROVED** (0 Blocking, 0 Serious, 1 Moderate new, 2 Minor new). F2 is fixed
  on the records hosts (Electron first) and on sync storage. The fail-closed contract is
  intact and the spec pins the new behavior, including the nullish edge. One write path
  keeps F2's failure mode on a host-conditional branch and must ride with the next batch
  that touches this file.

## Check 1 — F2 fixed?

Yes on every host path I could trace, except the async-storage index write.

Evidence:

- `getAll()` maps all three branches through `listAccountLinkage`: records branch
  `session-metadata-store.ts:1023`, pendingAll `:1025`, stored array `:1035`.
- `getForWorkspace()` records branch `:998`; the non-records branch inherits the fix
  through `getAll()` (`:1000`).
- `_saveInternal` still reads `getAll()` at `:823` and `:830`; that read no longer throws
  for one malformed row.
- Records hosts (Electron, CLI): `_saveInternal` upserts only the saved row
  (`:816-818`); other rows are untouched. Writes fully repaired.
- Sync-storage hosts: `flush()` writes the staged snapshot without per-row validation
  (`:878`, the `: snapshot` arm). Writes repaired.

Residual (R1): the async-storage branch still fails. `flush()` maps every staged row
through `this.indexEntry(item)` (`:876`) → `sessionIndexEntry` (`:361-365`) →
`validateAccountLinkage` (`:362`), which throws `invalid-bound` for the malformed row.
`_saveInternal` stages the full list that the lenient `getAll()` returned
(`:823-828`), so the next flush — the queue drain, the named-checkpoint flush (`:838`)
or `flushForShutdown` (`:901`) — throws for a row the fix deliberately let pass.

Scenario: a host without the records repository whose storage satisfies
`isAsyncStateStorage`; one stored row has an unparseable `accountBinding`; the user
saves, renames, touches or deletes any other session → the write stages all rows →
flush throws `invalid-bound` → every write on that host fails. That is F2's blast
radius again, moved from the list read to the index write. It contradicts the commit
message's write-path claim ("broke every write path that reads the list", implying the
repair).

Reachability: the store comment says the records repository is absent only on VS Code
(`:628-631`), and the file describes that adapter through sync `IStateStorage.get`
(`:1027-1029`). If the VS Code adapter also exposes `getAsync`, the branch is live on
VS Code; if not, no current host runs it and R1 is latent. I could not confirm the host
matrix inside this re-review's tool ceiling. `_deleteInternal` (`:1408-1465`) was not
re-read; it shares the stage/flush mechanics, so R1 is inferred to apply to deletes too.

## Check 2 — No new silent ambient downgrade

Holds.

- A malformed row keeps its stored `accountBinding` value and key: `listAccountLinkage`
  returns the row unchanged when the schema parse fails (`:121-122`). The spec pins key
  presence (`session-metadata-store.account-binding.spec.ts:52`).
- Detail reads still refuse: `get()` validates strictly on every branch (`:915`,
  `:920-923`, `:932`, `:936`), so the malformed session itself throws `invalid-bound`.
- Gates still refuse: `resolveAccountBinding` reads through `this.get()` (`:744`);
  `getAccountBound` reads through `get()` (`:725`); `saveAccountBound` parses strictly
  (`:714`). No account gate reads list rows — every gate routes through the strict
  detail reads. The spec pins both refusals (`spec:46-48`).
- Ambient rows are untouched: no `accountBinding` key → returned as-is (`:120`), the same
  as the strict validator's ambient branch (`:108`), same object reference. No ambient
  behavior change, no new logging, no defaults.

Nullish edge (`accountBinding: null` / `undefined` stored, key present):

- The spec covers it directly: `it.each([null, undefined, {}, ...])` (`spec:38-41`)
  seeds such a row and asserts `get` and `resolveAccountBinding` reject `invalid-bound`
  (`spec:46-48`). `validateAccountLinkage` sees the present key (`:108`) and the schema
  rejects nullish values, so every detail read and every account gate refuses.
- List consumers today: the importer prune (`session-importer.service.ts:389-405`,
  uses `entry.sessionId` only), the session list RPC
  (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:451`) and the
  organization handler
  (`libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts:255`).
  None branches on `row.accountBinding` for an account decision. A nullish row can read
  as ambient only to display code — a mislabeled badge at worst, never an admission.
- Precision caveat (R3): the nullish value stays nullish in the listed row. A truthiness
  check (`if (row.accountBinding)`) reads ambient; a key-presence check reads bound. The
  doc comment "so it never reads as ambient" (`:114`) holds for key-presence checks
  only. No current consumer makes an account decision this way, but a future list
  consumer that branches on truthiness would silently treat a corrupt-bound row as
  ambient.

## Check 3 — the spec pins the new behavior

Yes.

- Two-row seed, malformed plus healthy (`spec:44-45`); `get` rejects (`spec:46`);
  `resolveAccountBinding` rejects (`spec:47-48`); `getAll` lists both rows in order
  (`spec:50-51`); the bad row keeps the `accountBinding` key (`spec:52`);
  `getForWorkspace` resolves both (`spec:53`); the projection and the record input still
  throw `invalid-bound` (`spec:56-57`).
- The case list covers null, undefined, empty object, negative epoch, wrong ownerKey,
  injected `directory`, bad `profileId` (`spec:38-41`).
- Gaps: no spec covers a write with a malformed row present (R1's path), and none pins
  that ambient rows pass list reads unchanged. Neither blocks this fix.

## Check 4 — D25 deferrals sound

- **F1 → certification: sound.** Unreachable while admission is release-held — no
  reservation can exist and both settlement endpoints are stubs. F1 goes live exactly
  when certification happens; D25 files it with the termination proof as certification
  work.
- **F3 → Batch 26: sound.** 'claude' is absent from the lane roster today, so no
  ambient claude lane can spawn. The deferral ties the fix to the batch that makes it
  reachable and names the second prerequisite (pass `accountPersistence` to
  `ClaudeCliAdapter`). Watch item: Batch 26 must land both together, or every claude
  lane resume refuses 'unavailable-storage'.
- **F8 → certification: sound.** Latent; no session can be bound before certification.
- **F4–F7, F9 recorded, not fixed: acceptable.** All Minor; none is a release-hold hole
  or an ambient downgrade. They are availability, telemetry-precision and
  error-contract items that can batch.

## New findings

| # | Severity | File:line | Scenario | Fix |
| --- | --- | --- | --- | --- |
| R1 | Moderate (host-conditional) | `session-metadata-store.ts:876` (with `:823`, `:828`, `:361-365`) | Async-storage host without the records repository: one malformed `accountBinding` row; any save/rename/touch/delete of another session stages all rows from `getAll()`, and `flush()` maps them through strict `sessionIndexEntry` → `invalid-bound` → every write on that host fails. F2's availability defect survives on this branch. | Map the index write through a list-semantics variant of `sessionIndexEntry` — keep the raw binding like the list reads, still drop `cliSessions` — or skip-and-collect bad rows at flush. |
| R2 | Minor | `session-metadata-store.ts:119-120`, `:1005` | A non-object row (null, string, number from storage corruption) passes `listAccountLinkage` unchanged; `getForWorkspace`'s filter calls `m.workspaceId.replace(...)` → TypeError → the workspace list fails again for all sessions in it. Same exposure as the pre-P1-D baseline (no validation then), so not a regression; the commit's claim covers object rows with malformed bindings only. | Guard the filter with a shape check that keeps garbage rows out of workspace lists, or note the boundary in the doc comment. |
| R3 | Minor | `session-metadata-store.ts:114`, `:121-122` | Present-nullish `accountBinding` values stay nullish in list rows; a truthiness-based consumer reads them as ambient, contrary to the doc comment's "never reads as ambient". No current account decision does this. | Tighten the comment to key-presence semantics, or normalize present-nullish values to a non-nullish sentinel in list reads. |

## Guarantee spot-check (scoped to this fix)

| Guarantee | Verdict | Evidence |
| --- | --- | --- |
| Ambient unchanged | PASS | Ambient rows (no key) pass through both validators unchanged (`:108`, `:120`); `listAccountLinkage` adds no logging, defaults or normalization for them. |
| Fail-closed for corrupt bindings | PASS | Detail and gate reads stay strict (`:915`, `:920-923`, `:932`, `:936`, `:744`); spec pins the refusals (`spec:46-48`). |
| No release-hold change | PASS | The commit touches list normalization and its spec only; no admission, lease or port code moved. |

## Coverage

Read in full: the commit diff for `libs/`; `session-metadata-store.ts` lines 1-130,
350-414, 555-845, 915-1036 (schema and validators, `sessionIndexEntry`,
`toSessionRecordInput`, `withStrays`, constructor, save paths, `resolveAccountBinding`,
`_saveInternal`, `stage`/`flush`/`flushForShutdown`, `get`, `getForWorkspace`,
`getAll`); the account-binding spec (188 lines); `session-importer.service.ts:370-423`
(prune list consumer); D25 in `decisions.md`; the prior phase review for F2 context.

Partly read: `session-rpc.handlers.ts:451` and
`session-organization-rpc.handlers.ts:255` call sites only, located by search; the
surrounding handlers were read in the P1-D phase review, not re-read here.

Not covered: `_deleteInternal` (`:1408-1465`) and the remaining store methods (shared
stage/flush mechanics; R1 inferred to apply); the host matrix for
`isAsyncStateStorage` without records (tool ceiling — R1's reachability is unconfirmed);
no test, typecheck or build was run (review rules).

## Verdict

APPROVED. F2 is fixed on the records hosts (Electron first) and on sync storage; the
fail-closed contract holds and the spec pins it, nullish edge included. R1 rides with
the next batch that touches `session-metadata-store.ts`: confirm whether any host runs
async storage without the records repository — if none does, R1 downgrades to latent.
R2 and R3 are notes, not blockers.
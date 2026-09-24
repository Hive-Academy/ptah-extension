# Code Logic Review — TASK_2026_538_3ccf

Verdict: NEEDS_REVISION

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 4 |

Scope: Batch 9 only. Read all six production/spec files in full: surface-operation-ledger.ts/.spec.ts, surface-state.store.ts/.spec.ts, surface-state-reader.ts/.spec.ts. References below abbreviate their directory as S = libs/backend/vscode-lm-tools/src/lib/surface; C = libs/shared/src/mcp-apps-contracts; T = .ptah/specs/TASK_2026_538_3ccf. Read the task context, relevant requirements, Component 10, Q4, budget contract, Batch 9, R13, Task 10.3 obligations and executor report. No code-style-review.md exists in this task folder. Direct Ptah instruction-file search returned no AGENTS.md; native checks found no applicable AGENTS.md/CLAUDE.md in the examined ancestor chain.

The score is below 5–6 because the prescribed store/ledger composition silently loses a newly reserved operation and permits a second reservation, breaking the central idempotency guarantee (finding 1). It is above 1–2 because the ordinary retention, capacity, routing isolation and eviction mechanisms are implemented and exercised, and the defects have identifiable local causes.

Verification:
- Permitted targeted Jest command: **4 suites passed; 62 tests passed** (includes the existing surface-push suite). No build was run.
- Scoped ptah_get_diagnostics: typescript-compiler, **0 errors, 0 warnings**.
- Ran in-memory Node reproductions against the actual TypeScript classes and real shared helpers, with TypeScript transpilation only; no reproduction files or source edits.
- No TODO/PLACEHOLDER/STUB markers or empty implementation bodies found in the six reviewed files.
- Existing tests miss admission after retention expires: S/surface-state.store.spec.ts:355 uses a constant clock, while S/surface-operation-ledger.spec.ts:290 exercises expiry without store admission.
- Existing reader worst-case test uses ASCII, short paths and does not validate its fixture (S/surface-state-reader.spec.ts:329); it does not establish the complete-read budget for all valid data.

## Five logic questions

### 1. How does this fail silently?

A fresh operation returns reserved even though its record is inserted into a detached Map. Lookup, settlement and accounting cannot see it, and retry reserves it again: S/surface-operation-ledger.ts:235, :287, :303, :366 (finding 1). An all-surfaces read claims truncation even when every complete state fits: S/surface-state-reader.ts:193, :205 (finding 3).

### 2. What user action produces unexpected behaviour?

After a conversation has no pending operations and its settled records age past retention, its next submit/change/select can lose idempotency when admission uses the store as required by T/batches.md:1352. A retry can be admitted as a new operation (finding 1). Reading a valid large Unicode surface can return too-large instead of its complete state/tree, violating the per-surface recovery guarantee at T/task-description.md:306 (finding 2).

### 3. What input data produces a wrong answer?

A valid surface with 100 text inputs, long valid shared path prefixes, separator characters in values and a valid prior submit produces a 333,329-byte state against the 327,680-byte default cap. Its document passes the real validator, but the reader refuses it (finding 2). Eight valid ASCII surfaces whose complete aggregate text is 327,607 bytes unnecessarily omit surface "7" (finding 3). A configured 100-byte reader returns 195 bytes for a one-surface list (finding 4).

### 4. What happens when a dependency fails?

These units have synchronous local dependencies; no network, timers, awaited operations or disposal resources are introduced. A normal false admission returns too-many-operations before inserting a new record (S/surface-operation-ledger.ts:287); an impossible byte reservation returns a typed refusal before surface eviction (S/surface-state.store.ts:256). However, a successfully returning admission callback can sweep away its caller's Map through the real charge source (finding 1). Injected callbacks/source methods that throw propagate: S/surface-operation-ledger.ts:223, :287; S/surface-state.store.ts:195; S/surface-state-reader.ts:131. The advertised “never throws” comments therefore depend on validated data and nonthrowing internal dependencies; the later facade must provide the planned external typed-error boundary (T/implementation-plan.md:587). No external failure handling in that unimplemented facade was reviewed.

### 5. What is missing that the requirements never mentioned?

The admission callback is reentrant with respect to ledger housekeeping; synchronous execution alone does not make a retained Map reference safe (finding 1). Read-byte budgeting must use the final escaped representation, including its metadata and marker (findings 2–4). Store ownership also assumes consumers respect readonly records: get/list return references, not frozen snapshots (S/surface-state.store.ts:173, :186); no caller misuse was established, so this is a residual integration assumption, not an additional defect.

## Failure modes

### 1. BLOCKER — Store admission detaches the routing ledger and loses the newly reserved operation

- Trigger: an existing routing ledger's last terminal records have expired; reserve is called for a fresh id with the prescribed admission callback bytes => store.makeRoom(bytes).ok.
- Symptom: reserved is returned, but lookup is unknown, pending count and charged bytes are zero, settlement is unknown, and retry returns reserved instead of replay.
- Evidence: S/surface-operation-ledger.ts:235 retains the Map; :236 sweeps it to empty; :287 calls admission; S/surface-state.store.ts:256 calls ledger.chargedBytes(); S/surface-operation-ledger.ts:366 deletes that empty Map from the outer ledger map; :303 writes to the retained detached Map and :305 only registers it when the original variable was undefined.
- Current handling: none. The success record is unreachable immediately after reservation.
- Impact: a caller can perform a mutation or dispatch a submit with no retained operation record. Busy checks cannot see it, settlement cannot record its outcome, and the same fresh id is admitted again. This directly breaks Req 6.4/10.5 and R13, and can duplicate side effects.
- Recommendation: make admission and publication preserve ledger membership. Reacquire/register the target Map after admission, or restructure sweeping and insertion so the target cannot detach. Preserve capacity checks and no-write-on-refusal. Add a real store+ledger regression at retention+1 and at the exact boundary, asserting lookup, pending count, charges, settlement and replay.
- Reproduction: executed against the real classes using the shared bootstrap below:

~~~js
let now = 1700000000000;
const ledger = new SurfaceOperationLedger({ clock: () => now });
const store = new SurfaceStateStore({ charges: ledger });
const request = nonce => ({
  operationId: "op-" + now + "-" + nonce,
  kind: "submit", surfaceId: "a", incarnation: 1, fingerprint: nonce
});
const admit = bytes => store.makeRoom(bytes).ok;
const old = request("oldold01");
ledger.reserve("r", old, admit);
ledger.settle("r", old.operationId, { status: "applied" });
now += 600001;
const fresh = request("newnew01");
ledger.reserve("r", fresh, admit).outcome; // "reserved"
ledger.lookup("r", fresh.operationId);     // { status: "unknown" }
ledger.pendingCount("r");                 // 0
ledger.chargedBytes();                    // 0
ledger.settle("r", fresh.operationId, { status: "applied" });
// { ok: false, reason: "unknown" }
ledger.reserve("r", fresh, admit).outcome; // "reserved", should be replay
~~~

### 2. MAJOR — Escaping expands valid state/tree beyond the promised complete-read budget

- Trigger: valid Unicode separator characters consume three UTF-8 bytes in stored JSON but six bytes after escapeLineSeparators. The state duplicates input values into formValues and can also retain lastSubmit.
- Symptom: a valid named surface returns too-large; the agent cannot recover its complete state by following the advertised per-surface read path.
- Evidence: S/surface-state-reader.ts:251 duplicates the data model into form values at :252; :263 and :283 escape after serialization; :170 refuses the expanded output. Structure uses the same escaping at :268. C/surface-catalog.ts:103, :104, :109 budget 64 KiB model, 256 KiB surface and 320 KiB read. T/implementation-plan.md:267 assumes the unexpanded model-byte bound twice.
- Current handling: explicit too-large, which prevents oversized text but does not satisfy complete single-surface reads.
- Impact: Req 8.3 recovery is unavailable for validated content, including a valid prior submission. Structure inspection can also be unavailable.
- Recommendation: reconcile the final serialized representation with the catalog budget. Either use a bounded encoding that preserves all data, or revise/enforce a proven escaped-state budget at admission and the shared read limit. Include maximal valid paths, separator expansion, form issues and a real admissible prior submit in the budget test; validate the fixture.
- Reproduction: the following real-validator fixture is accepted. The prior submit formatter accepts a 13,906-byte message. The current model is 64,236 bytes; the full reader state is **333,329 bytes**, so the default reader returns too-large.

~~~js
const prefix = Array.from({ length: 5 }, (_, i) =>
  String.fromCharCode(97 + i).repeat(64));
const inputs = [], fields = {};
for (let i = 0; i < 100; i++) {
  fields["k" + i] = "\u2028".repeat(210);
  inputs.push({
    kind: "text", id: ("f" + i).padEnd(128, "x"), label: "Field",
    path: [...prefix, "k" + i].join("."),
    hints: { required: true, minLength: 1000 }
  });
}
let dataModel = fields;
for (const p of [...prefix].reverse()) dataModel = { [p]: dataModel };
const surface = {
  schemaVersion: "dashboard-spec/2", catalogVersion: "dashboard-catalog/2",
  surfaceId: "a", title: { text: "Title" },
  components: [
    { kind: "stack", id: "one", children: inputs.slice(0, 10),
      actions: [{ id: "send", action: "surface.submit", label: { text: "Send" } }] },
    { kind: "stack", id: "two", children: inputs.slice(10, 55) },
    { kind: "stack", id: "three", children: inputs.slice(55) }
  ]
};
validateSurfaceDocument({ ...surface, dataModel }, jsonUtf8Bytes).ok; // true
const lastSubmit = {
  operationId: "op-1700000000000-oldold01",
  actionId: "send", scopeComponentId: "one", baseRevision: 1,
  status: "applied", submittedAt: 1700000000000,
  values: inputs.slice(0, 10).map(i => ({
    componentId: i.id, path: i.path, value: "x".repeat(1000)
  }))
};
formatSurfaceSubmitMessage(
  { ...lastSubmit, surfaceId: "a" },
  { actionLabel: "Send",
    inputLabels: Object.fromEntries(inputs.map(i => [i.id, i.label])) },
  "12345678-1234-1234-1234-123456789012"
).ok; // true; prior valid submit, followed by permitted draft changes
const store = new SurfaceStateStore();
store.commit("r", {
  ...createSurfaceRecord("a", {
    contract: "dashboard-spec/2", surface, dataModel
  }, 2), lastSubmit
});
new SurfaceStateReader(store).describeForAgent("r", { surfaceId: "a" }).status;
// "too-large"
~~~

Independently, a valid document with 40 stat components, each title.text = "\u2028".repeat(2000), id = "s" + index and value = 1, has documentBytes **242,416**, but the structure read expands to **482,504** bytes and returns too-large. Validated with validateSurfaceDocument; measured with a temporary reader maxStateReadBytes of 1,000,000. No raw separators were printed.

### 3. MINOR (Moderate) — Worst-case marker reservation omits complete states that fit

- Trigger: complete states fit within maxStateReadBytes, but do not fit alongside a hypothetical marker naming every surface.
- Symptom: the agent is told to perform another read even when no truncation is necessary.
- Evidence: S/surface-state-reader.ts:193 reserves the marker for all ids; :205 applies that unchanged reserve to every candidate, even the final candidate that would remove the need for a marker.
- Current handling: omission and truncation marker.
- Impact: fails “as many complete states as fit” (T/batches.md:1273); unnecessary tool calls at the real default limit.
- Recommendation: first test whether all complete states fit without a marker; otherwise budget the actual omitted-id marker and reconsider candidates as that marker shrinks.
- Real-class reproduction: create eight valid surfaces with ids "0" through "7", revision 1, title "T", one stat {kind:"stat",id:"s",value:1}, and no inputs. For each dataModel, split ASCII padding across k0, k1, ... into strings of at most 2000 characters. Give the first seven 40,000 padding characters each and the last 44,890. All eight pass validateSurfaceDocument. The complete all-surfaces text is **327,607 bytes**, below **327,680**, but the default reader returns **282,522 bytes** and omittedSurfaceIds ["7"].

### 4. MINOR (Moderate) — Configured read bound does not cover the index and error text

- Trigger: maxStateReadBytes is smaller than the mandatory index plus truncation marker.
- Symptom: describeForAgent returns found with text larger than its configured cap.
- Evidence: S/surface-state-reader.ts:124 accepts the option; :199 measures the index but never rejects it; :215 returns index+marker without a final byte check. Error texts at :157, :164, :173 and :183 are likewise not bounded.
- Current handling: none for this configuration.
- Impact: the exported reader's byte-bound guarantee fails for small configured caps. Default catalog limits leave sufficient index space; this is an edge case rather than a default-limit failure.
- Recommendation: reject unsupported limits explicitly at construction or provide a bounded failure result; guard all response variants. If complete indexes require a minimum cap, document and enforce it.
- Reproduction: one valid surface "a" at revision 1 (one stat suffices), reader option {maxStateReadBytes:100}, describeForAgent("r",{}): **195 output bytes**, status found. The indexed contract/revision text and marker alone exceed the cap.

## Blocking issues

Finding 1: S/surface-operation-ledger.ts:303. A fresh reservation is lost after successful admission; prevent detached-map publication and add the integrated retention regression.

## Serious issues

Finding 2: S/surface-state-reader.ts:170. Valid Unicode content cannot be read completely per surface; prove/enforce budgets over the final escaped output.

## Moderate and minor issues

- Finding 3: S/surface-state-reader.ts:205 — marker over-reservation unnecessarily truncates within the default budget.
- Finding 4: S/surface-state-reader.ts:215 — small configured bounds are exceeded by the mandatory index/marker and potentially error messages.

## Explicit answers to the three requested points

### 1. Do makeRoom, reserveTicket and commit cover every eviction path? Any unreported removals?

**Yes for capacity eviction; no unreported capacity-removal path was found.** commit collects per-routing, whole-routing and global byte evictions at S/surface-state.store.ts:220. makeRoom returns shrinkTo's list at :266; reserveTicket returns that result at :291. shrinkTo records each evict at :337; evictRouting returns every removed pair at :383; evict returns its pair at :390.

The only other remove caller is explicit delete at :241, which returns the removed record at :242; this is an intentional deletion, not an eviction. Replacing an existing record at :212 is a committed replacement. There is no background surface cleanup. The ledger sweep removes operation records only, not surfaces.

The store pushes nothing by design (:3). Task 10.3 must collect and push all three eviction lists, including those produced before a later mutation refuses, from its single ordered push site (T/batches.md:1347, :1351). The existing admission integration test collects ids but does not test the future facade push (:369 of the store spec).

### 2. Is canonicalSurfaceJson deterministic? Can semantically different inputs collide?

**Deterministic for the validated JSON domain:** object keys are code-unit sorted at S/surface-operation-ledger.ts:183; nested arrays preserve order at :172; keys are emitted as literals at :191, so null-prototype objects and ordinary objects with the same own data properties serialize identically and __proto__ remains data. Real-class reproduction produced identical canonical text for differently ordered nested plain/null-prototype objects.

**It normalizes -0 to 0** through JSON.stringify at :166. Their fingerprints match; this is JSON-value normalization, not a cryptographic collision. No distinct supported UI-operation meaning was demonstrated for the sign of zero.

**It is not injective over arbitrary JavaScript values.** Undefined object members are dropped (:185); nonfinite numbers become null (:166); a one-hole sparse array and [] both serialize as [] because map skips holes (:174). NaN and null also collide. These were reproduced. Dates/toJSON are not handled like JSON.stringify either. The documented precondition is validated requests (:156), and the shared data contract is finite JSON only (C/surface.types.ts:113); no supported-operation collision was established. Keep that precondition, and do not generalize this helper into an arbitrary-JavaScript fingerprint. Sparse arrays and non-JSON values should be rejected before use, rather than relying on the comment's broader “exactly as JSON.stringify” wording.

### 3. Is routingIdCount sweeping acceptable, or can a read-only call harm observable state?

**At a quiescent API boundary, sweeping is acceptable lazy expiry.** routingIdCount calls chargedBytes (S/surface-operation-ledger.ts:373), which only drops ledgers empty after sweep (:366); forgetAt uses max(settledAt,issuedAt)+retention (:334), strict > sweep (:391), and monotonic time (:222). Pending records have no forgetAt. Once forgotten, an old id is outside the admission window, so quiescent cleanup cannot authorize its replay.

**During admission, the same read-side cleanup is harmful in the current implementation.** Finding 1 is a real manifestation through chargedBytes. Replacing admit with () => { ledger.routingIdCount(); return true; } reproduces the same detached-map mechanism. reserve holds a Map across this callback but does not restore membership afterward (:235, :287, :305). Retention rules alone therefore do not make this side effect safe.

## Data flow

1. Validated operation -> canonical fingerprint: OK within the documented JSON domain (ledger :159).
2. Reservation -> monotonic now -> sweep -> existing-id replay/conflict before absent-id expiry: OK for retained records; sweep intentionally makes truly forgotten ids absent (:234–265).
3. Count/routing capacity -> store byte admission: count limits and refusal precede new insertion (:268–291); **GAP finding 1** at callback return/publication.
4. Settlement -> max(now,issuedAt)+retention -> strict expiry: OK, pending cannot expire (:310, :385). A detached reservation cannot reach settlement.
5. Validated record -> byte count -> preflight -> record swap -> high water -> ordered eviction lists: OK under real nonthrowing counter/charge source (store :194–232); high water survives delete/eviction (:214, :396).
6. Ticket admission -> room -> accounting; release -> accounting decrement: OK for valid nonnegative charges (store :274–301). Surface eviction does not release tickets.
7. Trusted routing id -> get/list -> complete RPC view: OK, same routing map only, no truncation (reader :129, store :166).
8. Agent state/tree -> serialization -> separator escaping -> cap: **GAP finding 2**; aggregate packing -> marker: **GAPS findings 3–4**.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| R13 retained replay/conflict, absent-id expiry, monotonic time, retention | PARTIAL | Ordinary rules hold, but integrated admission loses the next fresh record after expiry (finding 1). |
| R13 pending never forgotten; routing ledger lifetime | PARTIAL | Ordinary sweep retains pending; detached publication makes a new pending record unreachable. |
| Ledger capacity before new writes | COMPLETE | Ledger :268–291; store :256. Housekeeping may remove expired records. |
| Req 7.2 routing/per-routing/byte bounds, LRU order | COMPLETE | Store :166–232, :250; default limits and real charge source examined; finding 1 can undercharge lost operations. |
| Pending ticket accounting and impossible-reservation refusal | COMPLETE | Store :274–301; specs :295, :320. Busy/scope ownership belongs to Batch 10. |
| Req 7.6 report every capacity eviction | COMPLETE | All store eviction lists are returned; pushing them remains Task 10.3. |
| highWaterRevision/recreation support | COMPLETE | Store :214 retains maximum; actual highWater+1 creation enforcement is Task 10.3 (:1335 of batches). |
| Worst-case memory documented | COMPLETE | Store :30–37 includes charges/tickets and an estimated heap multiplier, not a measured heap bound. |
| Req 9.5 complete RPC reads | COMPLETE | Reader :129–144 and :65–72 preserve all SurfaceStateView fields. |
| Req 8.3 complete bounded named state/tree | PARTIAL | Valid escaped output can exceed cap and become unavailable (finding 2). |
| Aggregate agent index, complete states, omitted ids, byte bound | PARTIAL | Default index/marker order works; findings 3–4 break packing/configured cap. |
| Unique-path form values; cross-routing isolation | COMPLETE | Reader :85–106; store :167, :178; ledger :342. |

Implicit requirements not addressed: callback-safe publication, encoded-output budget proof, minimum configurable reader budget. Facade authorization, push delivery, host registration, cross-process wiring and restart persistence are outside this batch; persistence is explicitly excluded at T/task-description.md:81.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Known operation beyond issue window | YES | Replay/conflict before absent-id expiry, ledger :239 | Unless already legitimately forgotten. |
| Exact expiry/skew/forgetAt boundaries | YES | <, > checks; strict > forgetting, ledger :257, :262, :391 | Specs cover exact and +1 ms. |
| Clock rollback | YES | Nondecreasing now, ledger :222 | Forward wall-clock jumps are not reversed; matches plan. |
| Long-lived pending operation | YES | No forgetAt until settlement, ledger :293, :334 | Detached publication in finding 1 bypasses this protection. |
| Fresh reservation after final record expires | NO | Detached Map receives record | Finding 1. |
| Default count/byte bounds at limit and one over | YES | Eviction/refusal, store :197, :221, :226, :334 | Specs pin limits. |
| Protected record and pending tickets during eviction | YES | lruSurface excludes pair, store :354; tickets separate :149 | Caller must supply protect where required. |
| Empty RPC routing / named missing surface | YES | [] / not-found, reader :129 | Agent empty routing returns not-found at :180. |
| Duplicate input bindings | YES | Map keyed by path, reader :85 | Issues/ids retained for each bound input. |
| Valid Unicode-heavy state/tree | NO | Expanded output refused | Finding 2. |
| Aggregate complete text just below default cap | NO | Unneeded marker budget excludes final state | Finding 3. |
| Reader cap below index size | NO | Unchecked index+marker returned | Finding 4. |
| Process exit | NO | In-memory state disappears | Explicitly out of scope, not a defect. |

## Reproduction bootstrap

For the snippets above, run Node from W with this bootstrap followed by the relevant snippet. This loads the actual source and real dependencies without writing files, building projects or mocking their behaviour. platform-core's alias is narrowed to the real json-budget module to avoid loading unrelated host composition.

~~~js
const fs = require("fs"), ts = require("typescript");
const path = require("path"), Module = require("module");
require.extensions[".ts"] = (m, filename) => m._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true
    }
  }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...rest) {
  if (name === "@ptah-extension/shared/mcp-apps-contracts/surface")
    return path.resolve("libs/shared/src/mcp-apps-contracts/surface.index.ts");
  if (name === "@ptah-extension/platform-core")
    return path.resolve("libs/backend/platform-core/src/utils/json-budget.ts");
  return resolve.call(this, name, ...rest);
};
const { SurfaceOperationLedger, canonicalSurfaceJson } =
  require("./libs/backend/vscode-lm-tools/src/lib/surface/surface-operation-ledger.ts");
const { SurfaceStateStore, createSurfaceRecord } =
  require("./libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.ts");
const { SurfaceStateReader } =
  require("./libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.ts");
const { validateSurfaceDocument, formatSurfaceSubmitMessage } =
  require("./libs/shared/src/mcp-apps-contracts/surface.index.ts");
const { jsonUtf8Bytes } =
  require("./libs/backend/platform-core/src/utils/json-budget.ts");
~~~

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for all four reproduced failures; later facade integration remains outside scope.
- Top risk: a successful reservation can disappear before dispatch, allowing duplicate execution under the required store/ledger wiring.
- What a robust implementation would add: callback-safe ledger publication; an integrated expiry/admission regression; a validated final-encoding budget proof for complete state/tree reads; exact aggregate marker budgeting; enforced minimum reader limits or bounded error responses.



---

# Re-review after revision round 1

﻿Verdict: NEEDS_REVISION
# Code Logic Review — TASK_2026_538_3ccf

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 open; original four closed |

Revision round 1 closes all four original reproductions. One related, newly identified edge case remains: an admission callback that reserves other operations in the same routing ledger bypasses the pending/record capacity checks. This is a moderate internal-API issue, not a reproduction of the former duplicate-dispatch blocker under ordinary store admission.

The score rises from 4 to 7 because the actual store/ledger composition now preserves reservations, valid large Unicode reads succeed, aggregate packing returns all states when they fit, and every reader response is bounded. It does not reach 8 because the new reentrant-callback handling only rechecks some of the invariants it promises.

Paths below: S = libs/backend/vscode-lm-tools/src/lib/surface; C = libs/shared/src/mcp-apps-contracts; T = .ptah/specs/TASK_2026_538_3ccf.

## Scope and verification

Reviewed all named production files and their specs, including the new S/surface-state-reader.budget.spec.ts and the changed shared catalog/budget/contract tests. Used the prior archived review, both revision sections in T/batch-9-report.md:230 and :279, and the decision at T/implementation-plan.md:1018. Earlier task context, Batch 9 scope, R13 and Task 10.3 obligations remain applicable.

Ran only targeted Jest suites, with output restricted to summary lines:
- Backend surface folder: **5 suites, 75 tests passed**.
- Shared surface-budgets.spec.ts and surface-contract.spec.ts: **2 suites, 83 tests passed**.
- No build, source edit or git mutation.
- Scoped ptah_get_diagnostics returned **unavailable: compiler still running after 45 seconds**. No successful current diagnostic result is claimed; it was not repeatedly polled.
- Re-ran all original reproductions using the real TypeScript classes and real shared validator/formatter, transpiled in memory. No reproduction file was written and no raw U+2028/U+2029 was emitted.
- No TODO/PLACEHOLDER/STUB implementation markers found in the surface files.

## Per-finding disposition

### Original 1 — BLOCKER: detached routing ledger — CLOSED

S/surface-operation-ledger.ts:307 reacquires the registered Map after admission, creates and registers a replacement at :314, checks for an intervening same-id record at :317, and publishes at :338. It no longer writes to the stale reference captured before housekeeping.

Re-ran the original real-store admission, bytes => store.makeRoom(bytes).ok:

| Time after original settlement | Fresh reservation | Lookup | Pending | Charged bytes | Retry | Settlement | Retry after settlement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 600,000 ms (exact boundary) | reserved | pending | 1 | 2,048 | replay | ok | replay |
| 600,001 ms | reserved | pending | 1 | 1,024 | replay | ok | replay |

The old record stays at the boundary and disappears only afterward. A separate admission callback calling routingIdCount() also now returns a reachable pending record. Regression evidence: S/surface-operation-ledger.spec.ts:450 and :474.

The new routing-count recheck works: with maxLedgerRoutingIds = 1, an admission callback reserving into another routing id makes the outer operation return refused, leaving one routing ledger. The same-id reentry test returns replay and retains one pending record. See S/surface-operation-ledger.ts:309 and :317; existing regression at S/surface-operation-ledger.spec.ts:488. Remaining same-routing count behavior is finding 5 below.

### Original 2 — MAJOR: escaped valid state/tree exceeds read bound — CLOSED

The approved decision raises C/surface-catalog.ts:117 to **561,152 bytes (548 KiB)** while retaining lossless escaping at S/surface-state-reader.ts:385.

Original real-validator reproductions now produce:
- State: **333,329 bytes**, found; document validation and prior-submit formatter both accept it; parsed model equals the stored model.
- Structure of 40 separator-titled stats: **482,504 bytes**, found; document validates and output contains no raw separators.

The regressions use admissible fixtures and round-trip the actual data at S/surface-state-reader.budget.spec.ts:188 and :209. Additional near-limit structure and combined model/form/table-selection/submit cases at :226 and :263 pass. These cases supplement the bound argument below; fixture success alone is not a proof of all possible inputs.

### Original 3 — MINOR/Moderate: unnecessary truncation — CLOSED

S/surface-state-reader.ts:245 sums complete output without a marker; :249 returns all states when they fit. On the truncated path, :260 computes the omitted ids for each candidate and :269 admits it using that actual marker budget.

Re-ran the original eight valid ASCII surfaces with an explicit 327,680-byte cap: **327,607 bytes**, found, truncated false, omitted ids empty. This preserves the original boundary despite the raised default. Regression: S/surface-state-reader.spec.ts:323.

The algorithm preserves index order and complete states. After accepting a state the marker shrinks, but the output still grows: each serialized state contains its id plus more metadata than the marker entry it replaces. Thus a previously rejected candidate cannot become newly affordable merely because later candidates are accepted. No stale worst-case marker reserve remains.

### Original 4 — MINOR/Moderate: configured cap exceeded — CLOSED

The 100-byte reproduction now throws RangeError at construction, as the revised configuration contract requires (S/surface-state-reader.ts:145). The minimum is **40,960 bytes**, documented at :120. Runtime results pass through bounded() at :184/:299; oversized error ids are shortened at :327.

Additional real-class checks:
- Eight longest v1 surface ids (2,003 ASCII characters each) at the minimum: found, **33,122 bytes**, all eight index entries, no omissions.
- A store configured for 200 surfaces, beyond default count limits, at the minimum: too-large with **78 bytes** of text.
- The targeted tests cover noninteger/NaN/too-small constructor values, missing ids, rejected requests, truncation and the final guard: S/surface-state-reader.spec.ts:375, :394, :434.

This is an explicit configuration restriction, not silent widening of a caller's cap. Constrained hosts choosing less than the default may receive too-large for an otherwise valid single state, as documented at S/surface-state-reader.ts:128.

## 548 KiB budget assessment

**The overall bound is sufficient under the validated-content and formatter-accepted-submit contracts.** The appendix's T3a wording needs one qualification for missing values; its spare form-entry allowance covers that case without increasing the bound.

| Term | Bound | Evidence and reasoning |
| --- | --- | --- |
| T1 metadata/header | 4 KiB | Reader state fields at S/surface-state-reader.ts:348; ASCII ids have bounded length. |
| T2 model | 128 KiB | C/surface-catalog.ts:103 limits raw JSON to 64 KiB. Only raw three-byte separators expand to six bytes at reader :385; all other JSON text retains its byte size. |
| T3a present bound values | 128 KiB | Inputs are scalar, unique paths are collected once at reader :88, and ancestor/descendant bindings are rejected by C/surface-bindings.ts:178. Present values therefore occupy disjoint portions of model JSON. |
| T3b form paths/ids/issues/wrappers, plus absent defaults | 100 KiB | At most 100 inputs (catalog :93). Bounded ASCII paths/ids and at most one bounded submit issue per input (C/surface-bindings.ts:260, :313) leave substantial room below 1,024 bytes per input. Empty defaults add at most five bytes per absent input, or 500 bytes total. |
| T4 embedded selection | 140 KiB | C/surface-selection.ts:16 caps quoted strings at 200 UTF-16 units; :67 visits at most 50 cells and labels. JSON-embedding each already-escaped source unit costs at most seven bytes. 100 fields plus v2 id/title/target framing fit the allowance. |
| T5 last submit | 48 KiB | C/surface-submit.format.ts:41 replaces componentId with label and :60 limits the already-escaped message to 32 KiB. Replacing labels with bounded v2 component ids adds at most about 13.4 KiB for 100 entries; bounded metadata fits the remaining allowance. |
| Total | **548 KiB** | Catalog :117; shared arithmetic regression at C/surface-budgets.spec.ts:558. |
| Structure | **516 KiB** | At most twice the 256 KiB admitted document plus 4 KiB header/wrapper; C/surface-budgets.spec.ts:578. |

Qualification: T/implementation-plan.md:1065 calls all form values model substrings. That is false for absent bindings: a validated absent checkbox in an empty model gives a five-byte false value while the model {} occupies two bytes. I reproduced it. The literal assertion “sum of values <= actual model bytes” is not universal, but the **548 KiB total still holds**: allocate at most five bytes per missing input to the already generous T3b allowance. Even using the appendix's approximately 875-byte per-input estimate plus five bytes stays below 1,024. A documentation clarification and an absent-binding budget case would make that argument explicit; no read-limit breach results.

A v1 state need not satisfy each v2 subterm independently (v1 component ids can be longer); it has no v2 model/form terms, so their unused 356 KiB comfortably covers that difference. The v1 structure is bounded by its own 256 KiB admitted spec.

The arithmetic test uses fixed 140 KiB and 48 KiB allowances. Future changes to selection formatting, form issue wording, ids, input counts or submit formatting require revisiting the derivation, not just changing the read constant.

## Five logic questions

### 1. How does this fail silently?

A nested reservation inside admission can fill the same routing ledger after the outer capacity check. The outer call still returns reserved, exceeding the published pending or total-record cap (S/surface-operation-ledger.ts:277, :294, :338). Ordinary store housekeeping no longer loses records.

### 2. What user action produces unexpected behaviour?

No remaining failure was reproduced using the planned ordinary store admission or the four original user-visible scenarios. The open issue requires a host admission callback that itself reserves operations, a form of reentrancy already handled and tested for other routing ids at S/surface-operation-ledger.spec.ts:488. No current production callback performing same-routing nested reservation was established.

### 3. What input data produces a wrong answer?

Fresh, valid operation ids under that nested callback produce five pending operations with the default cap of four, or 129 records with the default cap of 128. Reader Unicode, packing and low-cap reproductions now produce the revised required outcomes (dispositions above).

### 4. What happens when a dependency fails?

False admission still refuses before publishing the outer record (ledger :294). A depleted routing-count slot is detected after callback return (:309). Expiry housekeeping through real store charging is safe after the Map is reacquired (:307). A dependency that throws still propagates through these internal synchronous helpers; callbacks and source data are expected to obey the existing internal contract. No timers, network resources or unobserved async work were added.

### 5. What is missing that the requirements never mentioned?

The permitted mutation behavior of admission callbacks remains underspecified: the revised code permits other-routing and same-id nested reservations but assumes same-routing counts cannot increase (:304). It needs an enforced nonmutating callback contract or coherent post-callback capacity enforcement. The budget proof should explicitly allocate absent-input defaults as described above.

## Failure modes

### 5. MINOR (Moderate) — Reacquired routing Map bypasses per-routing capacity checks

- Trigger: admission reserves different operations in the same routing id before returning true.
- Symptom: the outer call returns reserved even though the reacquired Map has reached maxPendingOperationsPerRoutingId or maxOperationRecordsPerRoutingId.
- Evidence: S/surface-operation-ledger.ts:276 checks the original Map only before admission; :294 invokes the callback; :307 reacquires the current Map, but :317 only rechecks operation identity, and :338 inserts without rechecking size or pending count. The new comment at :304 assumes housekeeping only removes records, while :305 and the regression at S/surface-operation-ledger.spec.ts:488 explicitly allow a callback that registers new operations.
- Current handling: routing-id capacity and duplicate-id races are checked; same-routing pending and record capacity are not.
- Impact: the ledger's advertised bounds are false for this supported-looking callback case. The ordinary planned callback only calls store.makeRoom, so this is an internal reentrancy edge and not a demonstrated current UI path or recurrence of the original lost-record blocker.
- Recommendation: after reacquiring and checking replay/conflict, enforce both per-routing limits before insertion. Alternatively, enforce and document that nested reservations during admission are refused while read-only housekeeping remains allowed. Define the callback's permitted mutations consistently; retain all original retention/admission regressions. If broader mutation reentrancy is supported, byte admission also needs a stable reservation protocol rather than assuming a boolean check stays valid.
- Regression needed: same-routing nested reservations at default pending and record limits, asserting outer refusal and unchanged bounded counts.

Executed reproductions (using the real SurfaceOperationLedger, no mocks):

~~~js
const now = 1700000000000;
const request = nonce => ({
  operationId: "op-" + now + "-" + nonce,
  kind: "submit", surfaceId: "a", incarnation: 1, fingerprint: nonce
});

// Default pending cap is 4.
const pendingLedger = new SurfaceOperationLedger({ clock: () => now });
const pendingResult = pendingLedger.reserve("r", request("outer001"), () => {
  for (let i = 0; i < 4; i++)
    pendingLedger.reserve("r", request(("inner" + i).padEnd(8, "x")));
  return true;
});
pendingResult.outcome;              // "reserved"; expected "refused"
pendingLedger.pendingCount("r");    // 5; bound is 4

// Default retained-record cap is 128.
const recordLedger = new SurfaceOperationLedger({ clock: () => now });
const recordResult = recordLedger.reserve("r", request("outer001"), () => {
  for (let i = 0; i < 128; i++) {
    const req = request(("inner" + i).padEnd(8, "x"));
    recordLedger.reserve("r", req);
    recordLedger.settle("r", req.operationId, { status: "applied" });
  }
  return true;
});
recordResult.outcome;                  // "reserved"; expected "refused"
recordLedger.chargedBytes() / 1024;     // 129; bound is 128
~~~

All nested calls in these reproductions returned reserved. This is newly identified in this review; it is not claimed to have been introduced by the source revision itself.

## Blocking issues

None open. Original finding 1 is closed with real integrated reproduction and boundary evidence.

## Serious issues

None open. Original finding 2 is closed under the approved 548 KiB contract.

## Moderate and minor issues

Finding 5 remains open at S/surface-operation-ledger.ts:338. The missing-value proof qualification above is a nonblocking documentation/test suggestion, not a separate runtime failure mode.

## Data flow and regression assessment

1. Validated request -> canonical fingerprint: key ordering, nested arrays, null-prototype data and -0 normalization remain deterministic (ledger :161). Sparse holes now serialize as null rather than disappearing (:177); reproduced [null] for Array(1).
2. Monotonic time -> sweep -> existing-id replay/conflict -> absent-id expiry -> capacity: unchanged required ordering (ledger :241–294).
3. Admission -> reacquire Map -> routing count/identity checks -> publication: original detachment fixed; **finding 5** remains for increased same-routing counts (:307–338).
4. Settlement -> strict retention sweep: max(settledAt,issuedAt)+retention and pending preservation remain intact (:367, :424).
5. Store commit/reservations -> LRU eviction reports and accounting: no new removal path. commit :220, makeRoom :266 and reserveTicket :291 return their eviction lists; explicit delete :242 returns the removed record.
6. Trusted routing id -> store reads -> complete RPC view: unchanged isolation and completeness (reader :157, :68).
7. Agent serialization -> escaped text -> aggregate fit/marker packing -> final guard: all four original reader failure cases are resolved (:249, :269, :299, :385).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| R13 retained identity, expiry, monotonic time, pending retention | COMPLETE | Original integrated lost-record failure fixed; ledger :307, :367, :424. |
| R13 operation capacities before publication | PARTIAL | Finding 5: same-routing counts can change during admission. |
| Store routing/per-routing/byte bounds under prescribed admission | COMPLETE | Store :197, :221, :226, :256; original integrated admission now retains its charge. |
| Eviction reporting, high-water revision and ticket accounting | COMPLETE | Store :214, :220, :274; facade push integration remains Batch 10. |
| Complete RPC read and routing isolation | COMPLETE | Reader :157–172; no cross-routing access added. |
| Default complete state/structure read | COMPLETE | Catalog :117 and validated round-trip budget specs. |
| Aggregate index, complete-state packing, omitted-id marker | COMPLETE | Reader :232, :249, :260. |
| Reader cap for every result variant | COMPLETE | Constructor minimum :145 and final guard :299. |

## Edge cases

| Case | Handled | Evidence | Remaining concern |
| --- | --- | --- | --- |
| Admission sweeps last old record at retention+1 | YES | Reproduction: pending, charged, replay, settle ok | None for ordinary store admission. |
| Exact retention boundary | YES | Reproduction: old+fresh charged 2,048 bytes | Old retained until strictly past boundary. |
| Admission calls routingIdCount | YES | Reproduction: fresh record remains reachable | Read-side housekeeping now safe. |
| Callback consumes last routing slot | YES | Outer refused; one ledger remains | Same-routing limits still need checks. |
| Callback reserves same id | YES | Replay, one pending | Different fingerprint follows conflict branch :319. |
| Callback fills pending/record cap | NO | Five pending / 129 records | Finding 5. |
| Valid Unicode state and structure | YES | 333,329 / 482,504 bytes, found | Budget derivation must evolve with contracts. |
| All states just under old cap | YES | 327,607 bytes, no omissions | None. |
| Minimum cap and longest default v1 ids | YES | 33,122 bytes, eight index entries | Beyond-default stores may return too-large. |
| Unsupported 100-byte cap | YES | Constructor RangeError | Intentional configuration contract. |
| Oversized configured store index | YES | 78-byte too-large response | Complete listing intentionally unavailable outside default bounds. |
| Missing bound checkbox | YES | Reads false | Allocate default bytes to form-entry allowance in proof. |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the four closures and the remaining reproduced capacity edge.
- Top risk: admission reentrancy can exceed per-routing operation limits despite successful publication into the correct Map.
- What a robust implementation would add: enforce both capacities on the reacquired Map, or prohibit mutating reentrancy consistently; add the two nested-capacity regressions. Clarify absent-value accounting in the budget proof.
- Residual scope: no host facade, RPC registration, real submit dispatch or delivery behavior was reviewed; those remain later batches. Current scoped diagnostics were unavailable, as recorded above.



---

# Re-review after revision round 2

﻿Verdict: APPROVED
# Code Logic Review — TASK_2026_538_3ccf

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 open |

**Finding 5 is CLOSED.** This final check covers only revision round 2: the ledger capacity helper and post-admission checks, three ledger regression cases, and the missing-checkbox budget case. Earlier findings 1–4 remain closed as recorded in the archived round-1 re-review.

S below means libs/backend/vscode-lm-tools/src/lib/surface.

The score rises from 7 to 8 because both previously failing capacity reproductions now refuse correctly, and identity ordering, registration and accounting regressions pass. This is a sound local fix; the review does not establish the later facade/runtime integration needed for an exemplary whole-feature score.

## Finding 5 closure and evidence

S/surface-operation-ledger.ts:283 checks capacity before admission. After admission, :306 reacquires the routing Map, :307 checks identity first, :318 checks the current Map's record and pending counts, and :320 checks routing-count capacity when a new Map is needed. Registration at :327 and insertion at :340 occur only after those checks.

The shared helper at :421 tests record count at :424 and pending count at :430. No refusal inserts the outer record, replaces an existing ledger, or charges an additional record. Nested operations intentionally performed by the callback remain intact; “no write on refusal” applies to the refused outer operation.

Re-ran both original reproductions against the real classes, plus targeted regressions:

| Case | Actual result | Observable state |
| --- | --- | --- |
| Admission fills four pending slots | refused / too-many-operations | Outer id unknown; pending 4; charged 4,096 bytes |
| Admission reserves and settles 128 records | refused / too-many-operations | Outer id unknown; pending 0; charged 131,072 bytes |
| Admission leaves one pending slot | reserved | Outer id pending; pending 4; charged 4,096 bytes |
| Admission inserts same id/fingerprint, then fills pending cap | replay | Pending 4; charged 4,096 bytes |
| Admission inserts same id/different fingerprint, then fills pending cap | conflict | Pending 4; charged 4,096 bytes |
| Callback consumes sole routing-ledger slot elsewhere | refused | Outer id unknown; one routing ledger; charged 1,024 bytes |
| Admission returns false | refused | Outer id unknown; zero routing ledgers and charged bytes |
| Real store admission after old record expires | reserved, then replay | Fresh id pending; charged 1,024 bytes |

The first two cases reproduce the prior 5-at-4 and 129-at-128 failures with the same request shape and default limits. They now preserve the limits exactly. Persistent regression coverage is at S/surface-operation-ledger.spec.ts:511, :529 and :550.

The callback contract at S/surface-operation-ledger.ts:94 now distinguishes count-safe reentrancy from byte admission: true must still represent room for the outer record. Spending that room on nested reservations is explicitly outside the store contract. The planned store.makeRoom-only callback satisfies this assumption; a general transactional byte-reservation protocol remains outside this change.

## Missing-value budget qualification

S/surface-state-reader.budget.spec.ts:344 adds a validated 100-checkbox fixture whose paths are absent from an empty model. It verifies complete bounded output, all false values, and at most 500 bytes of synthesized defaults (:361–381). Its comment at :340 correctly allocates those bytes to the existing per-input T3b allowance rather than claiming they are substrings of the model. This addresses the prior nonblocking qualification without changing the 548 KiB limit.

## Five logic questions

### 1. How does this fail silently?

No remaining silent failure was reproduced in this delta. Post-admission capacity refusal precedes insertion (:318 versus :340), and refused outer ids remain unknown with no extra charge.

### 2. What user action produces unexpected behaviour?

Neither former reentrant-capacity scenario produces the wrong result now. The positive one-slot case still succeeds (spec :550), so the fix does not reject every reentrant admission.

### 3. What input data produces a wrong answer?

No new case found within the documented request/callback contracts. Same-id replay/conflict wins even when the callback fills capacity (:307 before :318). Missing checkbox bindings return false within the read budget (budget spec :373).

### 4. What happens when a dependency fails?

False admission refuses at ledger :291. Real store housekeeping can drop the old emptied ledger, but reacquisition at :306 still publishes a reachable fresh record. Throwing injected callbacks were not changed by this revision and remain outside the tested nonthrowing admission contract.

### 5. What is missing that the requirements never mentioned?

No additional requirement gap found in this narrow delta. The byte-admission responsibility is now explicit (:94), and absent-default accounting is recorded in the new budget regression (:340).

## Failure modes

None open in the reviewed delta. The two earlier failure reproductions, identity races, capacity boundaries, registration, charging and real-store expiry admission were exercised directly. Scope remains internal classes; facade dispatch, push delivery and runtime composition were not re-reviewed.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None new. Finding 5 and the missing-value qualification are closed.

## Data flow

1. Existing-id lookup, then absent-id expiry — unchanged, OK (ledger :252, :264).
2. Initial count checks, then admission — OK (:283, :291).
3. Reacquire Map, resolve replay/conflict, recheck per-routing or routing-count capacity — OK (:306–327).
4. Publish one record, then expose pending status and charge — OK (:340, :387, :396).

## Requirements fulfilment

| Requirement | Status | Evidence |
| --- | --- | --- |
| Per-routing caps hold after reentrant admission | COMPLETE | Ledger :318, :421; both original reproductions refuse |
| Replay/conflict precedes capacity refusal | COMPLETE | Ledger :307; full-cap identity reproductions pass |
| Refusal does not publish/charge the outer record | COMPLETE | Ledger :319, :320 before :327/:340; unknown ids and byte counts verified |
| Routing-count limit remains enforced | COMPLETE | Ledger :320; sole-slot reproduction passes |
| Prior expiry/store-admission fix preserved | COMPLETE | Ledger :306; real-store reproduction passes |
| Missing-value budget qualification covered | COMPLETE | Budget spec :340–381 |

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Pending and record cap exactly reached inside admission | YES | Outer refusal; counts remain 4 and 128 |
| One slot remains | YES | Outer admitted to exact pending cap |
| Identity appears while admission runs | YES | Replay/conflict, no duplicate charge |
| Routing slot consumed by callback | YES | Refusal, one ledger retained |
| Empty ledger swept during real store admission | YES | Fresh record reachable and retry replays |
| 100 absent checkbox bindings | YES | Validated regression; defaults at most 500 bytes |

## Verification

- Targeted Jest: surface-operation-ledger.spec.ts and surface-state-reader.budget.spec.ts — **2 suites, 35 tests passed**.
- Scoped ptah_get_diagnostics — **0 errors, 0 warnings**.
- Independent reproductions used real classes and dependencies, transpiled in memory; no source/reproduction files written.
- No build or git mutation. Only this deliverable was written. No raw U+2028/U+2029 emitted.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for this revision delta.
- Top residual risk: later callers must honor the documented byte-admission contract; that integration is outside this final check.
- What a robust implementation would add: no further revision required for this delta; retain these regressions when wiring the facade.


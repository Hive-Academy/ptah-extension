# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

**Scope: Batch 15 only. Verdict: NEEDS_REVISION**

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The tests exercise real validation and namespace/service code, and both requested Jest files pass. One security regression can nevertheless pass silently: the prototype-denial tests obtain their hostile inputs from the production denylist. Removing a required entry removes its tests too. An in-memory mutation reproduced this at both public validators. This needs a small test-only correction, not a production change.

The score is above 6 because the other controls have effective assertions, mutation evidence, and complementary boundary coverage. It is below 8 because the security contract still lacks an independent oracle for required denied segments. This is a regression-detection defect, not evidence that the current production implementation permits those segments.

Paths below are repository-relative. For readability:

- **Shared spec** = `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`.
- **Host spec** = `libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts`.
- **Contracts/** = `libs/shared/src/mcp-apps-contracts/`.
- **Surface/** = `libs/backend/vscode-lm-tools/src/lib/surface/`.
- **Namespaces/** = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`.
- **MCP/** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.
- **RPC/** = `libs/backend/rpc-handlers/src/lib/`.

Read both review-target files in full, the task context, Batch 15 instructions and Task 4.4, security requirements, validation plan, and batch report. No `code-style-review.md` was present in the discovered task artifacts. No AGENTS.md was found by `ptah_search_files` or the native fallback search. No source files, task states, or concurrent Batch 14 files were changed; no git command or build was run. The historical append-only claim comes from `batch-15-report.md:9`; this review did not independently compare against a git baseline.

## Five logic questions

### 1. How does this fail silently?

Removing `constructor` from `Contracts/surface-catalog.ts:67` makes its two cases disappear from the new spec because both tables use `SURFACE_PATH_DENYLIST` (Shared spec:678, :698). The in-memory mutant ran 12 instead of 14 v2 cases, all passing, while `validateSurfaceDocument` accepted `dataModel: { constructor: true }` and `validateSurfaceUpdateInput` accepted a `set-data` path of `constructor`. See F1.

### 2. What user action produces unexpected behaviour?

No additional current user-visible failure was established in this test-only batch. A maintainer narrowing the denylist gets a green regression signal despite changing a required rejection (Shared spec:678; `Contracts/surface.schemas.ts:104`, :451). Cross-tab reads and writes use the real namespace/service in Host spec:123 and :141; removing routing isolation would expose the seeded record or accept the patch, contradicting their expected results.

### 3. What input data produces a wrong answer?

The reproduced regression uses a syntactically valid `constructor` path/key, not an invalid fixture that merely triggers another error. Both public validators return `ok: true` after the catalog-only mutation (Shared spec:681, :701; `Contracts/surface-catalog.ts:70`). Unknown actions, markdown format, forbidden URL schemes, and altered markup were independently mutation-sensitive; see the verification table.

### 4. What happens when a dependency fails?

Host spec:82 deliberately supplies a successful transport, so its payload assertions do not claim transport-failure coverage. Existing real-dispatcher tests inject a failing host at `MCP/protocol-dispatcher.surface.spec.ts:236`; namespace delivery handling distinguishes a committed-but-undelivered write at `Namespaces/surface-namespace.builder.ts:144`. The Batch 11 carry-forward is already pinned by `RPC/chat/session/surface-submit-turn.service.spec.ts:349` (raw error withheld) and `RPC/chat/session/surface-submit-turn.deadline.spec.ts:91` (fixed indeterminate deadline detail). No duplication is required by `batches.md:2012`.

### 5. What is missing that the requirements never mentioned?

The requirement to test denied segments needs a test-owned list or an independent assertion that the production list contains all mandatory entries. Without that, case generation shares the implementation's defect (Shared spec:678, :698). The renderer proof is explicitly deferred, not an unstated omission: `task-description.md:443` assigns text binding to TASK_2026_494, and Shared spec:601 states that limit. A preserved string alone cannot prove that no consumer also interprets it as HTML.

## Failure modes

### F1 — Removing a required denylist entry also removes its regression cases

- Trigger: Remove `constructor` from the production `SURFACE_PATH_DENYLIST`.
- Symptom: All newly appended v2 tests remain green; the public validators now accept the forbidden path and data-model key.
- Evidence: Shared spec:678 and :698 derive both test matrices from the implementation constant at `Contracts/surface-catalog.ts:67`. The in-memory probe observed baseline 14/14 passing with both inputs rejected; mutant 12/12 passing with both inputs accepted.
- Current handling: There is no independent assertion of the mandatory entries in these tests. Existing coverage has the same dependency: `Contracts/surface-contract.spec.ts:510`, `Contracts/surface-data-model.spec.ts:44`, and :187 all enumerate `SURFACE_PATH_DENYLIST`. The independently spelled pollution path at `Contracts/surface-patch.spec.ts:216` covers `__proto__`, so it does not rescue the removed `constructor` case. A repository spec search found no independent `constructor`/`prototype` path case or denylist-membership assertion.
- Recommendation: Drive these boundary cases with a test-owned literal `['__proto__', 'prototype', 'constructor']`, or add an independent assertion that the production denylist contains those three entries. Keep the public-validator assertions. Repeating the catalog-entry deletion in memory must then fail a test rather than decrease the case count silently.

## Blocking issues

None established. F1 is a regression coverage defect; the unmodified validators reject the supplied hostile inputs.

## Serious issues

None established within the two reviewed files.

## Moderate and minor issues

- **Moderate — F1, Shared spec:678 and :698:** the security test oracle shrinks with the production denylist. Fix the input table or assert mandatory membership independently. This warrants revision because Batch 15 exists to pin the trust-boundary controls (`batches.md:1988`, :2002).
- No separate minor findings. The limitations below have existing coverage or an explicit scope decision.

## Data flow

1. **OK:** Shared spec:536 and :538 call the actual `validateSurfaceUpdateInput` and `validateSurfaceDocument`, with the normal byte counter. Production reaches `SurfaceUpdateInputSchema.safeParse` and `SurfaceEnvelopeSchema.safeParse` at `Contracts/surface.validator.ts:560` and :640. The schema mutations below prove the negative results are not caused by unrelated malformed fixtures.
2. **GAP F1:** Hostile path/key values are selected from production data before reaching those validators (Shared spec:678, :698). The rejection assertions themselves work when the cases still exist.
3. **OK:** Host spec:87 creates a real `SurfaceStateService`; :90 creates the real namespace. `Namespaces/surface-namespace.builder.ts:102` validates the request, then :124 passes the trusted caller's session and tool-call id to the service. No validator, store, or service implementation is replaced by a Jest module mock.
4. **OK:** `Surface/surface-state.service.ts:188` looks up the record by routing id and surface id. Reads likewise forward the routing id at :419. `Surface/surface-state-reader.ts:199` and :226 use scoped get/list operations. If namespace caller scope were collapsed to tab-a, Host spec:131 would get a found result and :150 would accept the patch, failing the assertions. This is reasoned mutation evidence, not an executed backend mutation.
5. **OK:** `Surface/surface-push.ts:22` passes the actual committed payload into the broadcast. Host spec:105 inspects the three actual send arguments and :114 checks all three markup-bearing fields. Changing their contents, dropping the snapshot, or suppressing the send fails this test. It stops at the adapter seam and makes no browser DOM assertion.
6. **OK, complementary coverage:** The new host tests call namespace methods directly, not the MCP dispatcher. The real tool path is separately exercised through HTTP and `handleMCPRequest` at `MCP/protocol-dispatcher.surface.spec.ts:94`, :161, :192 and :211, including legitimate access and forged body identity. `MCP/surface-tool-handlers.ts:104` forwards to the same namespace. Therefore this is not a missing real-MCP-boundary control, though the new file alone does not prove dispatcher scope extraction.
7. **OK, bounded claim:** Shared spec:725 invokes the real formatter and :748 parses the values line. It proves input-label fencing, but not every metadata line. The existing formatter spec covers metadata escaping at `Contracts/surface-submit.format.spec.ts:59` and :74; the surviving metadata mutation was killed there.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Unknown action rejected at document and update boundaries | COMPLETE | Shared spec:547, :564; action-enum mutation fails both. |
| Only plain text format | COMPLETE | Shared spec:589; admitting markdown fails it. |
| Markup unchanged through validation and actual push payload | COMPLETE | Shared spec:600; Host spec:95. Renderer interpretation remains TASK_2026_494 per task-description.md:443. |
| URL scheme limits on action and list item | COMPLETE | Shared spec:632, :659, :672; schemas reuse DashboardUrlSchema (`Contracts/surface.schemas.ts:139`, :392). |
| Prototype-pollution paths/keys rejected with independent regression protection | PARTIAL | Current rejection works; mandatory case membership is not pinned. F1. |
| Spoofing label remains form data | COMPLETE | Shared spec:721 plus existing metadata/Unicode checks at `Contracts/surface-submit.format.spec.ts:59`. |
| Cross-routing reads and mutation lookups fail closed | COMPLETE | Host spec:123, :141; existing namespace matrix at `Namespaces/surface-namespace.builder.spec.ts:154` and real dispatcher coverage above. |
| Zod values/strictness at MCP and RPC boundaries | COMPLETE | Namespace validation at :102 and :179; invalid inputs and no side effects asserted in `RPC/handlers/surface-rpc.handlers.spec.ts:124`; forged tool arguments in `Namespaces/surface-namespace.builder.spec.ts:207`. |
| Host-mediated actions; forged renderer parameters rejected | COMPLETE | Actual forged action params tested in `RPC/handlers/surface-rpc.handlers.spec.ts:108`, with unchanged state/no dispatch at :124; undeclared action at :354. This is distinct from forged MCP routing parameters. |
| Mutation operation ids and timeout/replay handling | COMPLETE | Missing/malformed ids in `RPC/handlers/surface-rpc.handlers.spec.ts:88`, :113; ledger replay/conflict/expiry at `Surface/surface-operation-ledger.spec.ts:63`, :78, :118. Agent correlation ids are host-stamped at `Surface/surface-agent-mutations.ts:115`, per implementation-plan.md:150. |
| Non-finite backup conditional on Task 4.4 | COMPLETE | Skip is justified: `Contracts/surface-validator.spec.ts:339` tests Infinity, -Infinity and NaN in stat value/delta, chart x/y, data-model and patch values through both public validators (:356, :372, :388). |
| Batch 11 fixed error details | COMPLETE | Existing service/deadline evidence above; no new duplicate required. |
| Extend the existing trust-boundary file | COMPLETE for file placement | Shared spec is 754 lines; host spec is 166. The historical no-v1-edits claim was not independently diff-verified in this review. |

Implicit requirement not addressed: an independent security-policy oracle for mandatory denied segments (F1).

The 754-line size is acceptable: `batches.md:1994` specifically requests appended v2 blocks in the existing file. The new material starts at Shared spec:514 and consists of six coherent describe blocks through :754. It exceeds the supplied 700-line soft guideline without creating a logic or isolation defect. No split is required for this batch; 1,000 lines is not treated as a mandatory cutoff.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Unknown executable-like action | YES | Both validators reject; two mutations fail (Shared spec:547, :564). | None established. |
| Forbidden URL schemes in two locations | YES | Action and item assertions (Shared spec:659, :672). | A combined test stops at the first failed assertion; schemas show both locations use the same URL control. |
| Missing foreign scope versus populated owner scope | YES | New scoped read/write tests; existing owner-state and foreign/missing equivalence checks at Namespaces/surface-namespace.builder.spec.ts:154. | New isolation tests do not individually assert seed acceptance; complementary happy-path tests provide that evidence. |
| Removed denylist entry | NO | Input table shrinks with the constant (Shared spec:678, :698). | F1. |
| Prototype remains unchanged | YES, with limited local proof | Shared spec:688 and :705 assert rejection. Existing data-model tests snapshot all prototype descriptors at Contracts/surface-data-model.spec.ts:47 and :66. | The new `not.toBe(true)` assertions alone are not a general prototype-integrity proof or a test of actual writes. |
| Spoofed action-label metadata | YES elsewhere | Existing formatter exact-message and metadata parsing assertions (:29, :59). | New case alone survives raw action-label interpolation; verified below. |
| Dependency timeout/failure or repeated operation | YES elsewhere | Ledger and submit service/deadline specs cited above. | Existing tests were inspected, not rerun as additional Jest suites. |
| Rendering text as HTML | NO in this task | Explicit renderer handoff (task-description.md:443). | Transport equality is not a renderer security certification. |

## Verification and mutation evidence

Executed exactly the two requested targeted Jest files, with no build:

```text
npx jest --config libs/shared/jest.config.ts --runInBand --runTestsByPath libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts --silent
  1 suite passed; 94 tests passed.
npx jest --config libs/backend/vscode-lm-tools/jest.config.ts --runInBand --runTestsByPath libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts --silent
  1 suite passed; 3 tests passed.
```

Both runs emitted a Node module-loading warning for the TypeScript Jest config, then completed successfully. `ptah_get_diagnostics`, scoped to the two absolute test paths, returned TypeScript compiler errors: 0, warnings: 0.

Mutation probes used a process-local TypeScript require hook: read source, transform selected text in memory, compile it in memory, and execute the actual captured test callbacks with the installed Jest `expect` package. No source/temp file was written and no `jest.mock` was used. This is separate from the normal Jest results, not a claim to have run the full mutation suite under Jest. Baselines: all 14 appended v2 cases passed; all 22 cases passed when the eight existing formatter cases were included.

| In-memory mutation | Observed result |
| --- | --- |
| Surface action enum becomes any string (`Contracts/surface.schemas.ts:137`) | Both new unknown-action cases fail. |
| Dashboard text enum also permits markdown (`Contracts/dashboard-spec.schemas.ts:100`) | New format case fails. |
| URL refinement always returns true (`Contracts/dashboard-spec.schemas.ts:90`) | All three new URL cases fail. |
| Disable schema path denial and raw object-key denial (`Contracts/surface.schemas.ts:104`, :451) | All six new path/key cases fail. |
| Escape `<` in the successful document result (`Contracts/surface.validator.ts:653`) | New exact-markup case fails. |
| Format values array with String instead of JSON (`Contracts/surface-submit.format.ts:56`) | New spoofing case fails, as do six existing formatter cases. |
| Interpolate actionLabel without JSON escaping (`Contracts/surface-submit.format.ts:55`) | All 14 new cases pass; existing exact-message and Unicode metadata cases fail. Covered limitation, not another missing-control finding. |
| Delete only `constructor` from the catalog denylist (`Contracts/surface-catalog.ts:70`) | New cases drop from 14 to 12; all pass; explicit document and patch probes change from rejected to accepted. F1. |

Backend routing and push mutations were reasoned from the actual data path and assertions, as permitted by the request; they were not executed. No raw U+2028 or U+2029 characters were printed.

## Verdict

**Verdict: NEEDS_REVISION**

- Recommendation: REVISE
- Confidence: HIGH for F1 and the targeted test results; backend mutation sensitivity is supported by code tracing.
- Top risk: a required denied segment can disappear from production and its regression cases in the same edit without a failing assertion.
- What a robust implementation would add: a test-owned mandatory-segment table or explicit mandatory-membership assertion, then confirm the catalog-entry-removal mutant fails. No production change, spec split, duplicate non-finite matrix, or duplicate Batch 11 cases is needed.


---

# Re-review after revision round 1

﻿# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

**Batch 15, revision 1. Verdict: APPROVED**

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining |

F1 from `code-logic-review-batch-15.md` is closed. This re-review covers the test-oracle correction; the earlier review's other conclusions stand. No Batch 14 code was reviewed or changed.

Evidence shorthand: **spec** means `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`; **catalog** means `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`.

## Five logic questions

### 1. How does this fail silently?

The previously silent denylist narrowing now fails: spec:686 owns the required input set, spec:688 independently checks membership, and spec:693/:713 retain both boundary cases even if catalog:70 is removed. The repeated mutation failed all three relevant tests.

### 2. What user action produces unexpected behaviour?

No new scenario found in this correction. Removing a mandatory production entry now produces failures instead of silently dropping its cases (spec:688, :693, :713).

### 3. What input data produces a wrong answer?

The formerly missed `constructor` path/key is still submitted to the real validators at spec:696 and :716. Their rejection assertions at :703 and :720 fail under the catalog-entry mutation.

### 4. What happens when a dependency fails?

This revision changes only test data and assertions (spec:678). It introduces no dependency or failure-handling change; the earlier review's transport and timeout coverage assessment remains applicable.

### 5. What is missing that the requirements never mentioned?

No remaining gap identified in this revision. The independent oracle now spells out exactly the mandatory segments in `task-description.md:171`: `__proto__`, `prototype`, and `constructor` (spec:686).

## Failure modes

None remaining within this re-review scope. F1 was checked experimentally, not closed solely on the tester's report. Baseline: **15 v2 cases, zero failures**. Removing only `constructor` from the catalog in memory: **15 cases still registered, three failures**:

- Required membership assertion (spec:688).
- `constructor` patch-path rejection (spec:693).
- `constructor` data-model-key rejection (spec:713).

The probe compiled modified source strings through a process-local TypeScript loader and executed the actual test callbacks with Jest's `expect`; it used no `jest.mock` and wrote no source files. Both the catalog and spec were checked unchanged afterward.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None requiring revision. The file is now **769 lines**, measured independently; the report's 765-line count is stale. The prior soft-ceiling disposition remains appropriate for this append-only spec.

## Data flow

1. **OK:** Test-owned literals originate from the requirement, independently of production data (spec:686).
2. **OK:** Membership is asserted against the production constant (spec:690).
3. **OK:** Both fixed tables feed the real request/document validators and assert rejection (spec:693–720).
4. **OK:** Deleting a production entry leaves those cases present and failing; no shrinking oracle remains.

## Requirements fulfilment

| Requirement | Status | Evidence |
| --- | --- | --- |
| Independent mandatory set | COMPLETE | Spec:686 matches task-description.md:171. |
| Detect catalog-entry removal | COMPLETE | Repeated in-memory mutation fails three tests. |
| Preserve v1 blocks | COMPLETE | Spec:86–512 matches the v1 describe blocks in `D:/projects/ptah-extension/libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`, with line endings normalized. |

Implicit requirements not addressed: none within this correction.

## Edge cases

| Case | Handled | Evidence | Concern |
| --- | --- | --- | --- |
| Delete `constructor` from production list | YES | Three failures, unchanged case count | None remaining. |
| Keep all required entries | YES | Baseline passes | None. |
| Additional denied entries | YES | Membership assertion permits extras | Correctly enforces a required minimum. |

## Verification

Targeted Jest only: `npx jest --config libs/shared/jest.config.ts --runInBand --runTestsByPath libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts --silent` — **1 suite, 95 tests passed**, exit 0. Scoped `ptah_get_diagnostics` returned **0 errors, 0 warnings**. No build or git command was run; no raw Unicode line separators were printed.

The normalized v1 block SHA-256 matched the reference checkout: `0806161597736fd3a79b26bd0c05267f5a5d58e950d2b936061f7e5488cc7009`. This comparison establishes block equality against that checkout, not a git-history audit.

## Verdict

**Verdict: APPROVED**

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none remaining from F1; the earlier review's renderer and backend-mutation scope limits remain.
- What a robust implementation would add: nothing further required for this correction.
- Score rationale: 8/10 reflects sound boundary assertions with independent mutation proof. It improves on 7 because the security oracle no longer shares the production omission; this focused re-review does not establish the broader evidence needed for 9–10.

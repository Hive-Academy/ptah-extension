Verdict: REVISE

## Round 1 resolution

This review checks the previous 11 findings against revision 1 only. Plan line numbers refer to the current implementation-plan.md. D5 and D6 were read; accepted console-window, UI-scope and E2 decisions are not reopened.

| Previous finding | Resolution | Plan lines and assessment |
| --- | --- | --- |
| 1. Certified launch context | **Not fixed completely** | 97-105, 120-163, 202-220, 372-389, 418-420 supply the context, enumerated allowlist, bootstrap rationale and final-context checks. However, 209 treats registry query failure as proved absence. See new finding 1. Required regression cases also need explicit ownership (finding 7). |
| 2. Main-chat holds | **Fixed at design level** | 390-403 replace both holds, define authoritative binding/identity checks and preserve the live owner's lease; B11 at 558 owns the adapter and spec. |
| 3. Lease/binding store contract | **Not fixed completely** | 292-316 define lease-only acquisition, separate binding commit, owner/epoch checks and independent settlement; existing bindings are reused on resume. Migration line 291 incorrectly equates every old epoch to zero. See finding 2. |
| 4. Uncertain-child settlement | **Not fixed completely** | 160-161, 263-270, 277-283 and 312-314 correctly propagate close evidence and serialize polling. The fallback completion rule at 271-273 bypasses the aggregate evidence for Ptah-owned status children. See finding 3. |
| 5. Actual spawner transport | **Fixed at design level** | 225-244 specify visible console, ignored stdio, null streams and worker/inline changes; B4 at 551 owns the actual files and spec. No login bytes enter Ptah. |
| 6. Fallback login and pending status | **Not fixed completely** | 245-254 provide quoted scripts, strip selectors and set both directories; 274-276 reuse the pending reservation. Scripts still do not establish the certified working directory, and fallback settlement has the gap above. See findings 3-4. |
| 7. Storage-backend live evidence | **Fixed** | 505-518 assign all R8 steps to senior-tester/test-report.md, establish the mapping procedure before sign-in, forbid existence/substring/creation-order inference and keep unresolved evidence from passing. |
| 8. DI/persistence wiring | **Not fixed completely** | 327-352 identify metadata/import implementations, dependency direction, registration location, constructor edges and Electron smoke assertions. B7 nevertheless registers a probe implemented in B8 and a persistence class created in B9. See finding 5. |
| 9. Optional parser metadata | **Fixed by justified refinement** | 184-201 accept optional metadata, specify source-consistency rules, tag evidence and require positive fixtures. Rejecting conflicting auth-source metadata is consistent with R2.11; mere key presence is no longer the refusal rule. |
| 10. Verification and batch ownership | **Not fixed completely** | 483-503 name ambient pins; 541-565 use scoped project IDs and batches of at most six files. nx.json:4 and jest.preset.js:17 confirm the stated defaults. Ordering is unsafe, an existing copy surface is unowned, and several requested security/lifecycle test cases are not specified. See findings 5-7. |
| 11. Current D5 and account labels | **Fixed** | 8-18, 441-461 and 505-518 incorporate D5, identify running/finished label producers and consumers, and assign dark/light before/after visual evidence without introducing another design gate. |

## Architect points

- **D-D: accepted in principle.** R1 criterion 4 (task-description.md:149-150) requires that user-facing copy and tool descriptions no longer say accounts await release; it does not require deleting the union member. Keeping an unreachable `release-held` member with neutral fallback copy is a justified deviation. However, changing the RPC COPY entry alone does not meet the criterion: the existing Accounts section also contains and exposes release-pending copy, outside the manifest. Finding 6 must be fixed.
- **D-K: accepted as a type-compatibility choice.** Optional `launch` is safe if every named execution boundary rejects its absence before spawning or handing off the prompt, with no ambient retry. The explicit admission/launch refusals are appropriate. The model-discovery exception at 388-389 returns an empty list rather than `identity-unproved`; this remains fail closed because it launches no child. State that exception accurately and pin missing-launch behavior in consumer specs. Optional typing preserves compilation only; it cannot preserve old positive named-run fixtures without updating them.
- **Batch-order caveat: rejected.** B7 cannot rely on B8/B9 becoming valid later when each batch must pass its own lint/typecheck/test before commit. Delaying Electron smoke to B9 does not validate B7's registration graph. The early environment-helper change also affects existing integration tests before consumer updates. See finding 5; no exception to per-batch verification is approved.

## New findings

These include residual portions of the original findings and contradictions introduced by the revision.

1. **Blocking — lines 207-220: registry failure is treated as absence.** The rule `reg.exe query` exit 1 → absent does not distinguish a missing key from an unreadable or otherwise failed query. Microsoft documents exit 1 as failure, not as a missing-key result ([reg query documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-query)). This directly defeats the original requirement to refuse unreadable managed policy. The statement that an undetected source is a fail-closed default at 218 is also inaccurate: a user checklist is not a runtime refusal.

   **Exact fix:** define a bounded registry probe that distinguishes positively established absence from access/query failure; refuse every ambiguous result with a safe code. Identify the supported policy-source set explicitly and do not claim unobserved sources are detected. Add absent, present, access-denied, generic failure, timeout and malformed-result fixtures to `claude-auth-settings-scan.spec.ts`; preserve the no-helper/no-raw-output rules.

2. **Serious — lines 287-305: migration loses existing reservation epochs.** Line 291 says old lease epochs are all zero because the old query uses `COALESCE`. In fact `provider-account.store.ts:428-429` returns the joined binding's nonzero epoch when present; `admit` writes that epoch at 313-319. After the proposed migration, a valid old nonzero reservation fails `held()` because its new lease column is zero. This leaves the original independent-settlement migration incomplete.

   **Exact fix:** backfill each existing lease's epoch and route revision from its associated binding where present, retaining zero only for genuinely unbound legacy rows; define conservative treatment of inconsistent rows. Add a migration fixture with a nonzero bound lease, plus post-migration release/retain checks and a pre-binding nonzero-epoch failure case. Do not silently clear retained leases.

3. **Serious — lines 263-279: fallback completion bypasses owned-child uncertainty.** Fallback owns no login console, but it still owns status probes. Lines 271-273 allow success/cancel/deadline completion without requiring the aggregate close evidence established at 263-265. An earlier status child can have unproved termination even if a later status succeeds. The existing wording contradicts 268-270 and the original finding 4.

   **Exact fix:** make the aggregate owned-child close check a common prerequisite for completion in both console and fallback modes, including cancel/deadline/disposal. Retain the reservation on any unproved probe termination. Keep external terminal ownership explicitly separate; this review does not require Ptah to kill an unowned user process. Add fallback tests for an unproved status child followed by success, cancellation and deadline, and assert `completeAuth` is never called in those cases.

4. **Serious — lines 162-163 and 245-254: fallback executes outside the certified cwd.** Certification uses the canonical profile directory, but both scripts execute in whichever directory the user happens to occupy. A local `.claude/settings.json` there can introduce an auth helper or conflicting source that was never scanned. Stripping process environment variables does not remove settings overrides. The fallback therefore still fails the original context-equivalence fix.

   **Exact fix:** generate a safely quoted change-directory step to the certified cwd before login and make the fallback's actual settings-loading behavior match the context scanned for that command. Include any deterministic run-key normalization needed by the certified env policy without disclosing inherited values. Specify tests starting from a different workspace containing an auth override, inherited cloud/API-key selectors and profile/executable paths containing spaces and quotes. The script remains read-only and user-operated under D5.

5. **Serious — lines 318-321 and 538-557: the batch graph contains forward dependencies and incompatible intermediate tests.** B7 registers `CLAUDE_CLI_PROBE` to a class that gains the required methods only in B8, and registers `ClaudeNamedAccountPersistence` before its B9 creation. B3 makes missing-launch named env calls refuse, while options-builder/runner/model consumers change only in B10/B12. The existing `claude-account-route-env.spec.ts:316-332` exercises named options construction, so updating only direct helper fixtures cannot make that intermediate project suite pass. Also, B7 owns DI specs that currently spy on `authorization` and `environment` (`register.spec.ts:184-186`), which B8 deletes. Test ownership must handle both transitions.

   **Exact fix:** replace the order/manifest with a dependency-valid sequence. Create implementations before registering them; make early helper additions additive and assign enforcement plus consumer/fixture conversion to coherent later batches, or provide an explicit fail-closed transitional adapter that actually passes the intermediate suites. Assign each changed file once, split batches to remain at most six files, and list the specs affected by each transition. Include the real DI guard in the batch that changes its dependencies. Do not defer a failing batch's proof to B9/B18 or weaken final guards to make it pass.

6. **Moderate — lines 450-455, 548-565 and 584-588: release copy still has an unowned surface.** `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:70-72` defines `ACCOUNT_HELD_NOTE` as "Named account starts are awaiting release authorization" and exposes it at 474. Neither this component nor its existing spec is in the manifest. The RPC COPY change and drawer edits do not remove this separate text. Thus the implementation handoff does not yet realize the otherwise acceptable D-D decision.

   **Exact fix:** assign this component and `accounts-section.component.spec.ts` to a concrete batch within the six-file limit; remove or update the held note and pin the resulting copy. Include the drawer fallback and RPC COPY in the same final production-copy audit. Retain the union member if desired; no broad 40-file deletion is required.

7. **Moderate — lines 115-116, 184-201, 424-426 and 548-565: requested regression cases remain implicit.** The manifest names useful spec files, but does not commit the key tests requested by original findings 1-6: certified context drift and selector coverage, both spawner modes, pre-commit nonzero epoch settlement, resume without a second binding/lease, cancellation during commit/late admission, and omitted/same/conflicting main-chat selections on both branches. A generic "Requirements 1-7 by specs" at 522 is not the specified component/flow/test mapping.

   **Exact fix:** add a compact case-to-existing-spec/batch table for those cases, including missing-launch refusals before spawn and the fallback/registry/migration cases above. Explicitly assign any added public helper exports needed by auth-providers to a file in the manifest (the agent-sdk root currently explicitly exports `applyClaudeAccountRouteEnv` at `src/index.ts:453`; editing only the helpers barrel does not establish a root export for the new helpers). Preserve ambient expectations and scoped verification; no new test project or workspace-wide run is needed.

## Citation spot-checks

Read-only source checks; the first six are new or expanded citations relative to the previous review.

1. Plan 51 → `agent-sdk/.../session-registry.service.ts:428-466`: **ok**. Stores fingerprint/revision/epoch and invalidates older-epoch queries; does not itself store the full profile/identity binding, hence metadata lookup remains necessary.
2. Plan 52 → `agent-sdk/src/lib/session-metadata-store.ts:732-775`: **ok**. All three methods exist and `resolveAccountBinding` requires the authoritative lookup callback.
3. Plan 53 → `agent-sdk/src/lib/di/register.ts:218-223`: **ok**. Both persistence and import lookup defaults are null factories.
4. Plan 54 → `agent-sdk/.../sdk-query-runner.service.ts:312-314`: **ok**. Constructor injects admission and named persistence.
5. Plan 58 → `agent-sdk/.../spawn-worker-pool.ts:104`: **ok**. Worker spawn message carries `windowsHide`; it needs the proposed stdio-mode extension.
6. Plan 58 → `agent-sdk/.../off-thread-process-spawner-source.ts:254`: **ok**. Worker hard-codes stdin/stdout pipes.
7. Plan 291 → claimed equivalence with `provider-account.store.ts:428-429`: **wrong**. COALESCE returns a present binding epoch, not always zero (finding 2).
8. Plan 541-543 → `nx.json:4`, `jest.preset.js:17`: **ok**. Default Nx parallelism is one and Jest maxWorkers is two.
9. D-D compliance spot-check → `accounts-section.component.ts:70-72,474`: **missing from plan ownership**. Separate release-pending UI copy remains (finding 6).

## Decisions

- **REVISE.** Accept D-D's retained union and D-K's optional type with runtime refusal; reject the proposed batch-order exception. Address findings 1-7 before the next Gate 2 review.
- D5 remains authoritative: separate OS console with no Ptah login I/O, read-only user fallback, no new designer/Gate 1.7 step, visual evidence as specified, and E2 with the user before named runs. D6's acceptance of the original findings does not waive their exact fixes.
- No new product surface, login, paid probe or approval gate is imposed. Remaining changes enforce the existing fail-closed, settlement, copy and per-batch verification requirements.
- Only this deliverable was edited. No builds, tests, logins, paid calls or git mutations were performed; source inspection and an official registry-command documentation check were used.

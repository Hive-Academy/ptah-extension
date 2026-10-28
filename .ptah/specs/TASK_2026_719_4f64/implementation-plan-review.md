Verdict: APPROVED

## Scoped re-check

Plan lines refer to revision 4. Reviewed the round3b review first, then D5/D8-D13, supplied research, approved Requirement 3, the revision-3/revision-4 diff and targeted source boundaries. This approves the scoped plan, not its future implementation.

| Item | Fixed/Not fixed | Plan lines | Assessment |
| --- | --- | --- | --- |
| Previous Serious finding 1 under D13 | Fixed | 270-298, 335, 343-373, 501-508, 1144-1168 | Class P requires loggedIn, claude.ai, firstParty, exactly pro/max, no forcedLoginMethod or allowedProviders, apiKeySource absent/none and only known keys. orgId/orgName do not determine eligibility. Class O cannot produce a launch; unsupported-source is the explicit policy. See the non-blocking error-precedence note. |
| Cache absence, A-S1 and A-S12 | Fixed | 203-209, 335, 343, 346, 458-459, 912-914 | Cache/consent absence is explicitly not proof. Files are additional refusal signals. User settings are read under the proved config base. Both SDK modes reject managedSettings and the managed-settings extra argument; B3 tests the guard/env exclusion and B12/B13 pin builder absence. |
| Assumptions and pre-prompt tripwire | Fixed | 348-373, 428-438, 795-798, 831, 960-977 | DA-1 is the labelled documentation-based assumption accepted by D13. A-C2 is recorded in E4 without using org presence as a gate. A-T1 fails closed on unknown words and is checked in E4. R-1 explicitly identifies the pre-classification status child authorized by D13. Both runtime paths check tokenSource/apiKeySource and subscription before prompt/task release. |
| Previous Serious finding 2: four SDK boundaries | Fixed | 156-161, 480-487, 752-758, 783-798, 825-831 | B1 owns boundary/outcome types, B6 the certifier, B9 the adapter, B12 lane calls and B13 main-chat calls. Each bootstrap and final check is awaited before query creation. Route/class, coverage, policy signals and executable fingerprint are checked. Failure suppresses the next query and settles release/retain from close proof. |
| Boundary fixtures and performance | Fixed | 909-917, 982-990 | B12/B13 cover changes after certification and between bootstrap/final, no query/task release, and release once versus retention. Performance now includes two additional scans, up to three scans/twelve registry queries per run start. |
| Previous version-cache note | Fixed | 242-249, 483-486, 531-534, 910 | Reuse checks path and size/mtime; an in-place update re-probes during certification. Run boundaries refuse changed fingerprints without another version child. Fixtures cover reuse, update and stat failure. |
| Previous scan/version ordering note | Fixed | 449-454, 493-497, 515-518 | Known uncovered versions refuse before scan I/O. Initial certification scans before discovering the version, then refuses before status. Separate fixtures now match the flows. |
| N accounts concurrently | Fixed | 535-537, 741, 756-758, 918, 934-938, 965-972 | Independent routes, directories, digests and run leases support chat on A while a lane uses B. Three-profile fixtures ensure refusal of C does not disturb A/B. E4 explicitly exercises simultaneous use. |
| New dependencies, ownership, D5/requirements | Fixed | 540-583, 1021-1033, 1044-1058, 1144-1154 | No new Serious forward dependency, duplicate file ownership or fail-open path found. B9 can add its method before the interfaces require it; B12/B13 own affected fakes. No agent-sdk import of auth-providers is needed. D5's unread console, sanitized polling, read-only fallback and evidence order remain. R3.5 is not waived. |

Bootstrap retains the previously accepted tmpdir/empty-settingSources invariant (197-218). The boundary rescans the certified route sources and both modes validate actual options. This is conservative for the disabled bootstrap user/project/local tiers; globally applicable managed sources and profile remote signals are still checked. Final checking uses the certified final context.

The previous demand for an SDK post-child cache check is explicitly superseded at 792-794: the final boundary detects bootstrap-created signals, and the next admission detects signals left by the final child. Under D13/DA-1, cache absence is no longer the eligibility proof. No stronger remote-policy proof is demanded here.

## New findings

None at Blocking or Serious severity.

## Non-blocking notes

Carry these into batches.md; none permits an unsafe named launch or requires a new architecture decision.

1. **Moderate — complete the injected filesystem contract (B6/B8).** Plan 483 requires stat, but the constructor at 470-471 and factory at 711-712 list only readFile/lstat/readdir. Add stat to the injected contract, factory and B6 fakes, returning size/mtimeMs. These files already belong to B6/B8; no new batch or forward edge is needed. The fingerprint refusal and fixture requirements are otherwise clear.
2. **Minor — make class-O error precedence explicit (B5/B6).** Plan 501-506 retains step 6's identity-mismatch for criteria also producing class O, before step 6b's unsupported-source. Apply D-S at 1148-1151: parsed class O returns unsupported-source before identity comparison; retain identity-mismatch for a class-P identity/directory mismatch. Pin an apiKeySource or non-firstParty case at the certifier level alongside team/enterprise. Current wording still refuses before any named query; the ambiguity is the typed reason, not admission safety.
3. **Minor — correct E4 signal wording.** Plan 975 says S9 files no longer decide anything, whereas 343, 507-508 and 1135-1137 correctly make presence/unreadability decisive refusal signals. Say absence no longer decides remote eligibility; presence/unreadability still refuses. Do not weaken the checks.

## Citation spot-checks

| Plan citation / claim | Source checked | Result |
| --- | --- | --- |
| Main-chat bootstrap, 787-788 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:694-705 | assertRouteCurrent precedes invokeNamedQuery at 697; accountInfo and close follow. Correct insertion boundary. |
| Main-chat final, 788-789 | Same file:714-729 | Final invokeNamedQuery is at 722, before verifyIdentity. Correct insertion boundary. |
| Main-chat port/tripwire, 783-798 | Same file:555-568, 780-784 | Token-only boundary expressly forbids auth-providers imports; verifyIdentity reads accountInfo at 783. Proposed method preserves dependency direction. |
| Lane bootstrap, 827 | libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:429-445 | this.open is at 444, followed by readIdentity. Correct insertion boundary. |
| Lane final/tripwire, 827-831 | Same file:398-415, 480-508 | this.open is at 494; readIdentity uses accountInfo and route validation. Correct insertion points. |
| Bootstrap/final context | libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:30-52, 175-189 | Bootstrap uses tmpdir/empty sources. Final currently uses empty named sources; B12 explicitly changes those to certified sources. Executable override exists at 189. |
| Main-chat flag tier/executable | libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1325-1332, 1424 | Builder emits settings and executable override; planned guards target real fields. |
| N-account storage, 934-938 | libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts:16-39, 58-84 | Route-specific profiles/selections and run_id-unique leases; no provider-wide single-account constraint. |
| B12/B13 fake ownership | session-query-executor.accounts.spec.ts:72; claude-sdk-lane-runner.spec.ts:512; claude-cli.adapter.spec.ts:486-493 | Interface-reference search found typed fakes/adapter usages in already assigned files. |
| Refusal copy, 1155-1157 | libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:11 | Existing unsupported-source text matches the plan's safe message. |
| A-S1/A-S12 and DA-1 | research-report-2.md:52-54, 58-60; decisions.md:75-81 | Research distinguishes proved config/parent channels from invalid remote-file proof. D13 accepts documented Team/Enterprise scope. |
| Requirements/D5 | task-description.md:223-245; decisions.md:28-33 | Executable/context, pre-prompt version and auth-policy refusal requirements remain; D5 console and E2 decisions are authoritative. |

## Decisions

- APPROVED for this scoped Gate 2 re-check. Previous Serious findings 1 and 2 are closed under binding D13; both previous non-blocking notes are addressed.
- D13 is not reopened. Personal Pro/Max eligibility uses the specified class rule and labelled DA-1. Team/Enterprise and unknown classes remain refused for named runs. D5 and D8's accepted batch-cap exception remain unchanged.
- Only implementation-plan-review.md was changed. No builds, tests, installs, logins, paid calls, state-changing git or live policy experiments ran. Binary/doc evidence was assessed from supplied research, not independently re-derived. Batch implementation checks and E1-E6/live concurrent-account evidence remain future work, not results claimed here.

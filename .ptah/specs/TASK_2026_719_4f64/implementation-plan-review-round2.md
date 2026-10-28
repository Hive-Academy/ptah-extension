Verdict: REVISE

## Round 2 resolution

Line numbers refer to revision 2 of implementation-plan.md. “Fixed” assesses the seven specific round-1 fixes, independently of the requirements contradiction below.

| Finding | Fixed/Not fixed | Plan lines | Assessment |
| --- | --- | --- | --- |
| 1. Registry query failure treated as absence | Fixed | 176-180, 194-268, 735-737 | Parent enumeration establishes absence; failures, malformed output, timeout and unproved termination refuse. The supported set and omissions are explicit; requested fixtures are assigned. The acceptance of unresolved policy coverage is separately addressed in New finding 1. |
| 2. Migration loses nonzero reservation epochs | Fixed | 366-401, 426-445 | Consistent bindings backfill epoch/revision; only genuinely unbound ambient rows retain zero. Inconsistent rows are preserved and quarantined. Tests cover epoch 4 release/retain and pre-binding epoch 3 settlement. |
| 3. Fallback completion bypasses child uncertainty | Fixed | 329-361 | Common allClosed gate covers both modes and every terminal outcome. Unproved status children prevent completeAuth even after later success; cancellation, deadline and disposal have explicit cases. External user terminal remains unowned. |
| 4. Fallback runs outside certified cwd | Fixed | 287-317, 323-324, 576 | Both dialects change to certified cwd before login and stop on failure. Allowlist/run-key rules, quoting and inherited-selector fixtures belong to B6. This fixes cwd equivalence, subject to the independent coverage issue below. |
| 5. Forward dependencies and intermediate specs | Fixed | 414-422, 450-464, 648-677, 703-731 | B6 creates probe interfaces/certifier before B8 implements/registers them; B9 creates persistence before B17 registers it. B3 is additive; B11/B12 migrate consumers before B13 changes the old helper. B8 includes DI and RPC activation guards; B12 includes its DI guard; B17 includes Electron smoke. No duplicate changed-file assignment or concrete remaining forward symbol dependency was found. D-M resolves the cap exception. |
| 6. Unowned Accounts-section held note | Fixed | 540-548, 668, 686-692 | B21 owns component/spec, removes the note and paragraph, and pins resulting copy. Drawer and RPC copy have separate owners. See the non-blocking audit detail below. |
| 7. Implicit regressions and missing root exports | Fixed | 153-158, 552-579, 650, 703-715 | Case/spec/batch table assigns context drift, both spawner modes, settlement, resume, cancellation, selection branches, fallback and missing-launch behavior. Both helper barrels belong to B3. D-K accurately distinguishes model discovery returning an empty list without spawning. |

## D-M peer check

**Accepted.** D8 authorizes the exception. B7's 19 head-version pins are real; B8 couples store/service signatures, command spies, DI and the no-storage refusal expectation; B12 couples lane options, runner/adapter fixtures and read-only-persistence DI expectations. One commit and one scoped verification per closure avoids broken intermediate commits or repeated ownership of the same specs. Implementations now precede registration.

The precedent ea27188eb exists and changed 22 files, including a report; it supports coordinated migration/spec updates rather than an exact identity of file counts. Current B7 independently totals 22 (three substantive files plus 19 existing specs). Carry the work-package correction below into batches.md; it does not require rejecting D-M.

## New findings

1. **Serious — unresolved policy coverage is accepted instead of refused.** **Plan:** 248-261, 300-305, 407-408, 608-611. **Source:** `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:47-57`; approved `task-description.md:235-240`; `research-report.md:78`.

   Revision 2 explicitly says remote/server-managed settings, drop-in directories, other MDM sources and settings above cwd are not detected and cause “no runtime refusal from the scan.” It relies on status and runtime identity/source checks as the only backstop. This makes an unresolved certification gap explicit: listing omissions satisfies the prior review's transparency request, but does not satisfy Requirement 3 criterion 5. That criterion requires refusal when precedence cannot be determined and forbids running an apiKeyHelper to discover the source. The existing certification contract likewise refuses unknown settings. A successful status/identity observation does not prove that all effective policy was examined; detecting an override after starting a settings-reading child cannot undo a helper invocation during startup. E4 user evidence is not a per-admission refusal, and the plan acknowledges that dormant policy is not caught. The fallback claim that its loading sources equal the scanned set also contradicts these omissions.

   **Exact fix:** make policy coverage an explicit prerequisite of certification before any settings-reading status, login, logout or SDK child. For the certified executable/version/platform/context, establish and scan the effective policy-source set, or positively establish that an unsupported source is absent/inapplicable. Any unresolved source or precedence returns fixed `unsupported-source` before those children launch. Do not infer absence from successful status/accountInfo or disable managed policy. Replace the “no runtime refusal” rule and narrow the fallback equivalence claim accordingly. Assign coverage/unknown-source fixtures to B5's scan spec and B6's certifier spec, with B8 actions tests proving no status/login/logout spawn on coverage refusal. Include ancestor-context ambiguity and an unresolved managed source whose mocked status would otherwise succeed; assert the status mock/helper is never invoked. Retain runtime identity checks as defense in depth. If the installed CLI cannot support this proof, keep that context refused and record the limitation through the existing live-evidence procedure; do not change D5 or the approved requirements.

## Non-blocking notes

- **Minor — B7 work packages:** lines 642-644 require at most six files per package, but line 654 labels all 19 pin edits “WP-b.” In batches.md enumerate WP-a (three substantive files), WP-b/c/d (six pins each), WP-e (one pin). Preserve one batch commit and verification.
- **Minor — production-copy audit:** lines 686-688 require empty non-spec grep for `release-held (D7)`, but `libs/shared/src/lib/types/agent-process.types.ts:334` contains that exact phrase in an unowned internal comment. This is not user-facing copy or a production refusal. Scope the audit to user-facing text and actual producers, explicitly exempting historical internal comments, or assign this cleanup once before B22. Do not silently turn B22's “none” file manifest into an editing batch.
- **Minor — registry path normalization:** lines 212-216 use abbreviated input hives while 242-244 recognize canonical output roots. B5 fixtures should pair HKLM/HKCU requests with HKEY_LOCAL_MACHINE/HKEY_CURRENT_USER output and normalize before path comparison. Otherwise positive absence can fail closed for every Windows account. This is a handoff clarification, not a claim that an implemented parser is wrong.
- **Minor — certifier handoff:** revision 2 refers to “certifier steps 1-3” without restating the full sequence. Carry rev1 lines 149-161 into B6's handoff, using revision 2's structural probe/factory injection and the coverage refusal above. Do not reintroduce the old forward registration dependency.

## Citation spot-checks

Actual read-only source checks; no verification suites were run.

| Plan citation | Actual source | Result |
| --- | --- | --- |
| 38-40 | `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:312-327`, `:428-431`, `:455-458` | Confirmed: binding/reservation carry profile epoch; held uses joined binding; leases block auth operations. Supports corrected backfill. |
| 45 | `libs/backend/auth-providers/src/lib/di/register.spec.ts:170-186` | Confirmed: explicit migration 58 and authorization/environment spies require B8 conversion. |
| 46 | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts:330-346` | Confirmed: no-SQLite admission expects release-held; now owned by B8. |
| 51 | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:22-42` | Confirmed: lane env delegates to old helper; bootstrap uses it with empty settingSources. B12 conversion precedes B13 enforcement. |
| 53 | `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts:295-330` | Confirmed: read-only persist and bound resume pin release-held; included in B12. |
| 57 | `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts:291-336` | Confirmed: main/one-shot named options tested through builders; ownership with B13 builder transition is correct. |
| 59 | `libs/backend/agent-sdk/src/index.ts:453`; `libs/backend/agent-sdk/src/lib/helpers/index.ts:264` | Confirmed: explicit exports in both files; both assigned to B3. |
| 64 | `apps/ptah-electron/src/di/container.smoke.spec.ts:307-334` | Confirmed: handler resolves against list-only ProviderAccountService mock; B17 owns dependency/fixture transition. |
| 65 | `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:70-72`, `:474` | Confirmed: separate held-note constant and exposure exist; B21 covers both. |
| 43 / D-M | `libs/backend/persistence-sqlite/src/lib/migrations/0059_provider_account_session_links.spec.ts:48-55`, the other 18 named migration specs; `git show --stat ea27188eb` | Confirmed: 19 head-version pins and coordinated migration precedent. |
| 455-456 | `libs/backend/auth-providers/src/lib/di/register.spec.ts:156-160` | Confirmed: private-export denylist omits proposed persistence adapter; B9 need not revisit that spec. |

## Decisions

- **REVISE solely for New finding 1 (Serious).** The seven specific round-1 fixes are present. No new batch-order blocker was established by static inspection.
- Accept D-M and retain accepted D-D and D-K. Non-blocking notes belong in batches.md and do not independently justify REVISE.
- D5 remains authoritative: separate OS console, no login output read by Ptah, sanitized status polling, read-only fallback, no new UI surface, existing visual evidence and E2 before named runs. No new approval gate is proposed.
- Reviewed revision 2 against the prior review, relevant rev1 sections, D1-D8, approved requirements and supplied research. Only this deliverable was changed. No builds, tests, installs, logins, paid calls or state-changing git commands ran. Static review cannot establish actual per-batch green status, CLI policy-source behavior or live Electron acceptance; these remain implementation/live-evidence obligations.

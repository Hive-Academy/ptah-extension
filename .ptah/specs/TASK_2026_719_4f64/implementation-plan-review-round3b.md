Verdict: REVISE

## Scoped re-check

Line numbers refer to implementation-plan.md revision 3. Scope is round-2 New finding 1, its four Minor notes, D-P/D-Q/D-R, and revision-3 contradictions. Earlier accepted fixes and D-M are not reopened.

| Item | Fixed/Not fixed | Plan lines | Assessment |
| --- | --- | --- | --- |
| Coverage before every settings-reading child | Not fixed | 224-276, 359-403, 464-475, 622-657 | Auth-action checks are explicit, but unresolved source assumptions still pass and SDK boundaries lack the promised coverage rechecks. Findings 1-2. |
| Formerly undetected sources scanned, positively absent or refused | Not fixed | 251-276, 324-328 | Drop-ins, registry, ancestors and uncovered platforms have concrete refusal rules. Remote applicability and parent-managed input remain unresolved. |
| No status/accountInfo inference; managed policy preserved | Fixed | 224-231, 330-334 | Explicit prohibitions and defense-in-depth identity checks are retained; no new policy-disabling mechanism is prescribed. The assumptions below still undermine coverage. |
| B5/B6/B8 required fixtures | Fixed | 335-403, 472-475, 713, 730-732, 822-825 | Unknown-source and ancestor cases, succeeding status mock never called, and zero status/logout/console action calls are assigned. These do not cover unresolved applicability with absent cache files. |
| Fallback claim narrowed | Fixed | 435-446 | Equivalence is limited to the same executable/version on win32. Unobserved terminal behavior is acknowledged, but does not cure finding 1. |
| B7 WP-a..e | Fixed | 812-814, 824 | Three substantive files, six/six/six/one pin edits; one commit and verify. |
| Copy-audit scope | Fixed | 856-865 | User-facing strings and producers only; historical comments exempt; B22 edits nothing. |
| HKLM/HKCU normalization | Fixed | 281-288, 335-343 | Request/output roots normalize before comparison; canonical HKEY_* fixtures included. |
| Full certifier sequence without forward registration | Fixed | 359-403, 565-569, 823 | Steps 1-8 explicit; B6 owns structural interface/unregistered classes, B8 implementation/factory. |

## D-P / D-Q / D-R assessment

D-P's exact-version/platform table is compatible with R3.1-3 and R3.5 (`task-description.md:218-240`). Refusing darwin/linux, uncovered versions and auto-updates is a product cost, not inherently a requirements defect. R4.4 explicitly handles certification failure (`task-description.md:294-296`). POSIX fallback remains unreachable until coverage exists. Below 2.1.301 the plan deliberately retains `unsupported-store` rather than the general uncovered-version code.

Executable tracing found no always-refused SDK-bundled 2.1.278 path:

| Named path | Actual selection under the plan |
| --- | --- |
| Status/login/logout and fallback | Plan 195-202 retains detector-backed installation discovery. `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:147-158` calls `detector.findExecutable()`; current command/prefix handling is at 128-135. Auth operations and fallback reuse the certified executable (plan 433-443). |
| Main chat via SDK | Plan 625-635 binds bootstrap/final options to the certified executable, explicitly `launch.executable.sdkExecutablePath` for final. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:794,1424` exposes the SDK executable override. |
| Claude CLI lane via SDK | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:131-141,179` passes `loader.getCliJsPath()` to both paths. That loader uses the installed detector result, NOT the SDK bundle (`libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:134-155`). Lane options set explicit paths (`libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:39,189`); plan 650-659 adds launch equality checks. A different cached path refuses. |

An existing native executable is also returned as `cliJsPath` (`libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:67-72`). The name does not imply JavaScript or an SDK bundle. Research records installed 2.1.310 versus bundled 2.1.278 (`research-report.md:35,79-81`). Only a detected executable passing the version/coverage checks can run named contexts; another detected installation must refuse unless covered. This conclusion required no live CLI invocation.

D-Q is not acceptable as written: pre-child cache absence and post-child checks do not establish the acknowledged remote-fetch semantics before launch. E4 records evidence; it cannot authorize unresolved sources meanwhile. D10 explicitly retains refusal (`decisions.md:59-60`).

D-R's env/argv/options restrictions and flag-tier inspection are useful, but do not establish that these exhaust the inputs to `parentManagedSettings`. A-S12 explicitly leaves the input channel unknown. Removing the row after another channel is discovered is not refusal while coverage is unresolved.

## New findings

1. **Serious — round-2 finding 1 remains open: unresolved policy behavior is classified as positive absence.**

   **Plan:** 263, 266, 268-276, 387, 435-445, 773-777, 925-933. **Source:** `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:47-57`; `task-description.md:235-240`; `decisions.md:59-60`.

   S9 returns absent when three files do not exist, while A-S9 acknowledges a possible fetch after credentials exist inside a child. A post-close check cannot prevent a helper already invoked during that child. The login console remains a Ptah-initiated settings-reading child even though D5 forbids reading its output. S12 similarly calls the source absent while its input channel remains an assumption. S1 also relies partly on status/E4 to confirm the config base. These are the same unresolved-coverage issue the exact fix required refusing, now described as assumptions rather than omissions.

   **Exact fix:** Keep the coverage entry unavailable, or refuse each unresolved context with `unsupported-source`, until read-only evidence establishes remote/consent semantics, the config base and parent-managed input channels. Scan every source or establish absence/inapplicability before any status/login/logout/SDK child. E4 records unresolved results; do not first enable the context to test whether an assumption was safe. Preserve D5 and managed policy. Add B5/B6/B8 cases where S9 files are absent but remote applicability is unknown, and where parent-managed input is unresolved: zero status/login/logout calls even with a succeeding status mock. Later cache/identity checks remain defense in depth.

2. **Serious — per-child SDK coverage checks are promised but not assigned to execution boundaries.**

   **Plan:** 13, 163-176, 369-370, 622-657, 742-746, 784-787. **Source:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:379,429`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:134-142`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1325,1424`.

   `checkCoverage` is assigned only to actions. SDK boundaries use `assertCertifiedLaunch`, which compares path/env/cwd/source metadata and the final flag value, but does not scan policy. Certification scans before status and rechecks S9 after that status. A bootstrap can subsequently create a remote cache, or policy can become unresolved between bootstrap and final, with no specified coverage check before the final child. The performance section confirms one scan per admission. D-Q's post-every-owned-child claim also lacks an SDK assignment. This is a gap in the scoped exact fix, not a reopening of unrelated runtime design.

   **Exact fix:** Assign an awaited coverage check at each main-chat and lane bootstrap/final child boundary, against its actual context, before query/spawn. Expose this through an admission port or additive callback contract without creating an agent-sdk dependency on a later auth-providers implementation. Assign contract/implementation/call sites once in dependency order. Specify post-child S9 checks and settlement for SDK-owned children. B12/B13 fixtures should change a source after certification and between bootstrap/final, assert `unsupported-source`, no subsequent query invocation and correct lease settlement. Update the performance statement.

## Non-blocking notes

- **Moderate — auto-update cache contract:** Plan 198-199 caches version by path; 369-370 rechecks only steps 1-2. An update can change a binary in place. Clarify executable-change invalidation or re-probing before reuse, and pin it with a fixture. The cache predates revision 3; this clarifies the new D-P guarantee rather than independently reopening the earlier review.
- **Minor — scan/version fixture ordering:** 344-345/713 promise no fs/registry calls for an uncovered version, but 372-379 scan before discovering the version. Distinguish an already-known incompatible version supplied to a scan from the initial certifier flow. B6 correctly forbids status on version refusal.
- D-P's platform/version support and maintenance costs are requirement-compliant trade-offs, not separate defects.
- No revision-3 duplicate file ownership or forward registration dependency was found in the changed manifest. B3 exports the shared rule, B5 consumes it, B6 defines the interface/classes, B8 registers them. D-M stays accepted. D5's console, unread output, sanitized polling, read-only fallback and E2/E4 procedure remain intact.

## Citation spot-checks

| Citation | Actual source | Result |
| --- | --- | --- |
| Plan 195 | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:147-158` | Detector-backed installation resolver confirmed. |
| Auth command selection | Same file, 128-135 | Direct execution uses a prefix; ordinary execution uses installation path. |
| Named lane executable | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:131-141,179`; `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:134-155` | Installed detector path, not implicit SDK-bundled CLI. |
| Native executable support | `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:67-72`; `claude-cli-detector.ts:355-366` in that directory | Native executable can populate cliJsPath with direct execution false. |
| Plan 265 / S11 | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1325-1332` | Main-chat flag settings are emitted; validation is relevant. |
| Plan 650-653 | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:39-42,175-189` | Both explicit executable fields and current empty named settings sources confirmed. |
| Plan 862-864 | `libs/shared/src/lib/types/agent-process.types.ts:334` | D7 phrase is an internal comment, supporting narrowed audit. |
| Round-2 exact fix | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:47-57`; `task-description.md:235-240`; `decisions.md:59-60` | Unknown effective settings refuse; successful status is insufficient. |

Checks used targeted reads and a read-only revision-2/revision-3 diff. Revision-3 binary-string claims were not independently re-derived; findings rely on its explicit unresolved assumptions.

## Decisions

- REVISE for Serious findings 1-2 only. All four Minor notes are incorporated; D-P product costs are not defects.
- Accept D-P's closed-table policy in principle. D-Q/D-R do not discharge unresolved-source requirements. No requirement or D5 change is authorized or proposed.
- Only this deliverable was changed. No builds, tests, installs, logins, paid calls, state-changing git or live policy experiments ran. Runtime policy semantics, per-batch verification and live Electron/E2/E4 evidence could not be established in this static review.

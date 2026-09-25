# Implementation plan review - final round

Verdict: REVISE

Reviewed the 497-line plan. RESOLVED means adequately specified in the design, not implemented or runtime-tested. Remaining items below go to the user; no further architecture round is presumed. Paths are worktree-relative. `P` = `implementation-plan.md` in this task directory; `H` = `libs/backend/harness-sync/src`; `A` = `libs/backend/agent-sdk/src`; `C` = `libs/backend/cli-agent-runtime/src`; `SDK` = `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | PARTIAL | C2a, P:165-198 improves publication, required acquisition and ownership checks. Existing `H/lib/lock/file-lock.ts:159-162,200-218,303-308` needs all those changes. The replacement still permits ownership races and an unsafe timed fallback; see residual N1 below. |
| N2 | RESOLVED | Import/C2, P:109-112,208-210,277-279 specifies completed import followed by a separate fresh transaction with pure mutators. This avoids the non-reentrant acquisition at `H/lib/lock/file-lock.ts:234-264,298-310`. First-set regression is explicitly required. |
| N3 | RESOLVED | Unverified/C3/C5, P:114-134,227-243,304 suppresses Claude skills, freezes managed copies, and refuses rival launch in PR 2. `SDK:2160-2174` supports an empty explicit skill set; `SDK:2193-2200` supports explicit-only MCP. This is a context filter, not file-access isolation, as `SDK:2163-2166` states. Live A2 remains a release check. |
| N4 | RESOLVED | Fingerprint/C5a, P:33,153-154,294-308 ties acknowledgement to processed inputs, includes PluginConfigState, rejects failed health and re-passes a mismatch. This addresses joining before force at `H/lib/preflight/harness-preflight.service.ts:157-162` and the separate storage update at `A/lib/helpers/plugin-loader.service.ts:783-791`. The existing API returns only health, not a joined flag (`preflight.service.ts:140`); the fingerprint-mismatch branch is implementable without adding that flag. |
| N5 | RESOLVED | C7, P:376-383 queries current status with bounded measurement and rechecks session identity. `SDK:2836-2852` supplies both methods; it replaces init-only status from `A/lib/helpers/stream-transformer.ts:519-530`. Same-session disconnect coverage is specified. Delivered in PR 2. |
| N6 | RESOLVED | Resolution/C4/C8, P:96-98,264,281,337 adds retained explicit workspace ON for install. This addresses same-name multi-source inventory at `C/lib/mcp-directory/mcp-install.service.ts:246-255` and separate native approval keys at `SDK:6538-6542`. |
| N7 | RESOLVED | Root/C4, P:81-85,268-269 separates physical I/O path from Windows-only folded identity. This matches `H/lib/workspace/workspace-root.ts:66-85,112-116`; `H/lib/targets/mcp/json-mcp-facet.ts:85-90` receives the physical path. Case-sensitive roots are tested explicitly. |
| #3 | PARTIAL | C2, P:203-211 supplies fresh, single-owner import/marker transactions and rejecting writes. Atomic replacement really rethrows (`H/lib/fs/atomic-write.ts:50-70`) and has unique temp names (`:36-40`). Mutual exclusion still depends on residual N1. |
| #5 | PARTIAL | Unverified/C3 resolves the skills/plugin widening defect (N3). C4, P:253 still cannot obtain an error by wrapping the swallowing Codex reader at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110,187-194`; see N9. |
| #6 | RESOLVED | Root/C4, P:81-85,259-269 uses the exported workspace resolver and physical root consistently (`H/index.ts:86`; `H/lib/workspace/workspace-root.ts:66-85`). Import, git, storage and SDK calls no longer use a lowercased Darwin pathname. |
| #10 | RESOLVED | C5a/C6, P:294-308,370-372 gives policy-specific acknowledgement and honest rival partial enforcement. Current force support exists at `A/lib/harness/harness-preflight.port.ts:30-50`; Ptah CLI ordering explicitly corrects `C/lib/ptah-cli/ptah-cli-registry.ts:657-659`. This resolution assumes the locking defect is fixed before concurrent writes are called safe. |
| #15 | RESOLVED | C7, P:376-383 replaces init-only validity with `SDK:2841` current status, token/config memo identity and timeout-to-unknown. P:351,446 explicitly keeps numeric measurements out of PR 1. |

## Remaining N1 - blocker - publication safety does not make lease recovery safe

- Section: C2a, P:171-184; existing primitive being replaced: `H/lib/lock/file-lock.ts:181-218`.
- Scenario: cross-host holder A checks its token for release and pauses. B expires A's lease, takes `.break`, renames A's lock away, then acquires the vacant path. A resumes its deletion and deletes B's lock. Checking the token before a separate unlink is not conditional unlink. The same gap exists between refresh's token check and rename: a displaced A can overwrite B's lock. Only breakers take `.break`, so the assertion at P:182 is false for release and refresh.
- Further failure: even perfectly serialized token operations cannot let an expired holder resume its protected JSON write after B has committed without fencing the write. The five-second fallback also reproduces the original empty-file race when A pauses longer than five seconds between `open('wx')` and payload write (`file-lock.ts:159-162`); the planned test only waits within the grace (P:192).
- Fix: use a proven process-lock primitive with a clearly bounded filesystem support contract, or specify a protocol that coordinates all ownership transitions and fences displaced writers before commit. Reject unsupported acquisition rather than substituting a timed empty-file guess for C2's required lock. Add deterministic pauses between check/delete, check/rename, lease loss/commit, and beyond the fallback grace. Existing P:194 tests displacement before release, which does not cover displacement inside release.

## New findings

### N8 - major - PID existence cannot establish owner identity

- Section: C2a, P:168,173,188; replacing `H/lib/lock/file-lock.ts:161,186-200`.
- Scenario: the lock owner crashes; its PID is reused, including after a reboot, by a long-running unrelated process on the same host. `kill(pid, 0)` succeeds, so the proposed same-host rule never reclaims the orphan. Every toggle write times out until that unrelated process exits. A UUID in the file does not identify the process answering the PID probe.
- Evidence: [Node's process contract](https://nodejs.org/api/process.html#processkillpid-signal) tests existence, not process creation identity. There is no birth/boot identity in P:168's payload.
- Fix: use verifiable process-instance identity or an OS-owned lock that is released on process death; define a safe recovery path when identity cannot be proved. Never kill the PID to reclaim this lock. Test an orphan whose PID now belongs to another process.

### N9 - major - the PR 1 Codex inspection wrapper cannot report read failure

- Section: C4, P:252-253,283-288.
- Evidence: `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110` calls `readFile`; `:187-194` catches every read error and returns empty text. Wrapping `readAll` observes an empty map, not EACCES. This facet is also absent from C4's PR 1 file list; only its PR 2 parser edit is budgeted (P:373).
- Scenario: the global Codex configuration becomes unreadable. The shared inventory reports no declarations instead of unverified; Marketplace silently loses sources and the resolver treats an incomplete inventory as verified, contrary to P:114. Rival not-enforced labels do not repair shared discovery.
- Fix: add a status-bearing low-level read that distinguishes ENOENT from other errors, use it in PR 1 `inspect`, retain compatibility for legacy `readAll`, and include the facet and an EACCES regression in the PR 1 budget. Quoted-key parsing can still remain in PR 2.

## Windows and existing-caller compatibility

- The successful-link publication step is appropriate for one local supported filesystem: the initialized file is published before contenders can read it; EEXIST must be treated as contention. [Node documents linkSync](https://nodejs.org/api/fs.html#fslinksyncexistingpath-newpath); [Microsoft documents same-volume hard links, NTFS and sharing restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw). These contracts do not validate the later lease/release algorithm.
- A6 remains untested on actual NTFS/APFS, antivirus interference and OneDrive-backed homes. EPERM is not proof that hard links are unsupported; permission/sharing failures need bounded failure and diagnostics. Inference: separate cloud-synchronized copies do not become one atomic cross-host lock merely because each local copy supports hard links. Either exclude that topology or use actual shared coordination.
- Keeping `requireLock` opt-in preserves the old `withFileLock` API (`H/lib/lock/file-lock.ts:298-310`) and `acquireWorkspaceLock` handle contract (`H/lib/lock/workspace-lock.ts:57`). It does not make all existing consumers exclusive: `H/lib/reconciler/harness-reconciler.service.ts:393-423` logs and writes without an acquired handle; removal at `:277-317` and repair at `H/lib/repair/blocked-repair.service.ts:206-214,287-290` also proceed. This is existing behavior, not a newly introduced finding, but compatibility must not be described as a cross-process safety guarantee for those callers.
- Mixed-version callers also need a rollout test: the current `file-lock.ts:200-203,216-218` ignores the new token and can break/release by path. Upgrading one host does not retrofit a concurrently running old host. No source edits to these callers were made during review.

## PR 1 honesty and verification limits

- Schema deferral is honest: C8/P:336 and C10/P:351 always produce "size unknown" in PR 1; AC-5.x explicitly completes in PR 2 (P:446).
- #12 is assigned to C4b/P:373 and rival enforcement to C6/P:370-372, with PR 1 "not enforced" at P:150,350. Proxy deferral is stated at P:478-480, although C1/C10's detailed lists mention only rivals; retain the explicit proxy label in implementation and UI tests.
- #16 is explicitly deferred, and AC-2.1 names C4c/PR 2 (P:429). The old reader really collapses duplicate scopes (`C/lib/mcp-directory/claude-user-mcp.reader.ts:90-106`). PR 1 cannot claim complete source-scope coverage; its release notes/UI must disclose this limitation. AC-2.5's C1 unit rule (P:433) is not evidence of complete end-to-end inventory coverage; its UI verification must include C4/C10 and the PR 2 duplicate fixture. The two-PR split itself is accepted.
- No live SDK/provider sessions, filesystem mutation probes, builds or tests were run in this read-only review. Installed SDK types and current source support the resolved design contracts; A1-A6 remain execution gates. Only this deliverable was written. No git state was changed.

## Five logic questions - final disposition

1. Silent success: residual N1 can lose an acknowledged toggle; N9 can return a success-looking empty inventory.
2. Unexpected user action: the first toggle no longer nests locks (N2 resolved); a toggle after owner crash/PID reuse still times out (N8).
3. Wrong-answer input: unreadable Codex config is currently indistinguishable from empty input (N9); duplicate source coverage is explicitly PR 2.
4. Dependency failure: unknown policy is restrictive by design (N3 resolved); unsupported/blocked link creation must not fall back to residual N1's unsafe grace protocol.
5. Missing operational contract: displaced writers, mixed-version hosts and synchronized-home topology still need explicit safe handling before concurrency approval.

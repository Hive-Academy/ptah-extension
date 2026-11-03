# Batch 8m-1 — D14 Manual approvals and resume fingerprint refusal

Implemented D14 and added specifications. No checks, tests, lint, typecheck, build, install, diagnostics, commits, or state-changing git commands were run, as instructed. Test results are not claimed. Electron's existing backend-to-renderer contracts and MCP setup remain in place.

## Files written (absolute paths)

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\tools\evidence-harness.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-parity-gate.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-native-contract.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-1-report.md

## Tasks

A: ask and auto-edit now use untrusted, workspace-write, writableRoots [normalized cwd], networkAccess false, approvalsReviewer user. Plan remains on-request/read-only/empty roots/network false; yolo remains on-request/workspace-write/cwd roots/network false. Updated the mapping comment and only policy() in the evidence harness (including its undefined/default Manual level and explicit user reviewer). Read-only inspection confirms both client and server approval-policy schemas accept untrusted. Changed the parity gate's historical command-accept evidence note to explicitly require a D14 live re-test; no gate status or routing was changed.

B: exported CodexResumeProfileChangedError from codex-runtime.ts with code resume-profile-changed. open() first retains the existing context/home/provider/workspace identity check, then refuses fingerprint changes with a fixed explanatory message and injected logger error containing the stable code. Refusal occurs before spawn, generation advancement, persistence, or marking stored identity inactive. Specs cover old fingerprints for both ask and auto-edit, error class/name/code/message, one runtime log, no process, and no persistence mutation. Existing same-identity resume coverage remains.

C: profile specs independently pin all four policy mappings, roots, network, reviewer, harness agreement, and ask-versus-plan fingerprints. Runtime fixtures now reflect D14; added exact thread/start and turn/start frame assertions. thread/start carries the protocol's sandbox mode string; turn/start carries workspaceWrite with only cwd as writableRoots and networkAccess false. Native contract specs cover fileChange and commandExecution crossed with Allow and Deny, requestApproval before item/started, exactly one PermissionRequest through the real shared parser, real bridge response accept/decline, subsequent successful execution only for Allow, and declined completion with isError true and no successful tool_result for Deny. These use the existing scripted server, translator, adapter, host ports, router and broadcaster, not a live Codex process.

D: this report records decisions, caller-chain findings, scope limitations and validation status.

## Decisions

1. Implement fixed D14. Options were granular/read-only (old ask mapping) versus untrusted/workspace-write; D14 selects the latter to obtain approval requests before edits and untrusted commands while allowing approved workspace writes. Evidence: supplied D14 and read-only inspection of the accepted protocol enum and existing Ptah permission policy integration. Reversible by changing the two mapping helpers, but fingerprints change again; no live upstream behavior was measured in this lane.

2. Refuse changed fingerprints rather than silently migrate old threads. Per-turn overrides exist, but the fingerprint also covers instructions, permission level, account and other thread identity; a digest mismatch cannot prove that only D14 changed. Automatically accepting would erase this distinction. The new named error is logged and preserves a safe actionable message: "Codex cannot resume this chat because its execution profile has changed. Start a new chat to use the current permission policy." Reversible in a future explicit migration with appropriate evidence; stored identity is preserved.

3. User-visible result and caller-chain limitation: createCodexThreadIdentityStore reads codexThread.profileFingerprint from session metadata. codex-chat-host-ports rebuilds the current profile and returns it with stored resume identity; its own identity check covers home/workspace/provider, not the fingerprint. CodexChatAdapter.open -> openContext -> runtime.open reaches the fingerprint check. The adapter's failure() wraps all non-adapter errors in CodexChatAdapterError('runtime-failed', 'open', { cause }), logs the original error, and rethrows the wrapper. ChatSessionService.codexFailure() maps that wrapper to CODEX_RUNTIME_FAILED and "Codex chat could not complete the operation." This was the user-visible result before this change and remains the renderer result afterward. The runtime cause is now coded, actionable and logged rather than a plain generic mismatch, but the specific message does NOT reach the renderer yet. The alternative is a targeted safe mapping of this named error/cause in the adapter/session error classifier; those files are outside the allowed edit list. No raw runtime errors should be exposed as a workaround. This limitation prevents claiming complete user-visible resume remediation.

## Risks and remaining work

- Required outside-lane follow-up for a clear renderer resume refusal: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts (codexFailure), with its native session spec. Optionally extend D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts to preserve a dedicated adapter code. Export through the runtime library barrel if consumers need the named class. None of these files was edited.
- An accepted approval returns accept through the bridge; this lane does not widen sandbox policy. Every turn still sends networkAccess false and only cwd in writableRoots. Network access or writes outside that root may fail or provoke another escalation request. A command approval does not itself establish that such operations are permitted; actual Codex enforcement and repeat-prompt behavior require the live re-test.
- thread/start supplies sandbox mode, while turn/start explicitly supplies roots/network. No thread-frame config overrides were added, and no MCP servers/configuration were removed or altered.
- Evidence harness policy() now mirrors D14, but existing code outside that helper requires a file request's itemId to be in validatedFileItems before accepting. A newly earlier approval may therefore be declined by that harness until its scenario logic is adapted. This was observed by source reading only; changing that logic was outside scope.
- The parity gate still retains historical proved status; its updated evidence text warns that the D14 mapping needs a live re-test. No new live proof is claimed.
- Other lanes own protocol schemas, event translator, runtime types and host ports. Native contract assertions must be reviewed against their final combined changes by the team leader.
- No verification ran. Team leader owns the permitted project checks, live Electron approval re-test, and commits.

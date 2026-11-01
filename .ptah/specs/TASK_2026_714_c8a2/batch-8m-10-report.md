# Batch 8m-10 — scope D14 `untrusted` to chat

CI failed two lane specs because batch 8m-1 applied decision D14 to every Codex consumer. Headless lanes delegate to `buildCodexExecutionProfile` with `consumer: 'lane'`, so auto-edit became approval `untrusted` and ask lost its granular read-only policy. D14 now applies only when `consumer === 'chat'`. Lane, gateway, and usage use the pre-8m-1 mapping again.

Tests were not run. This batch is forbidden from verify, Jest, lint, and typecheck. The coordinator runs the scoped check.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-10-report.md`

Not changed:

- `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-profile.ts` already sets `consumer: 'lane'` (line 96) and keeps delegating. No lane-side override.
- `codex-lane-profile.spec.ts` already asserts the pre-8m-1 lane behavior. Those expectations were not weakened.
- `libs\backend\codex-runtime\tools\evidence-harness.ts` `policy()` is unchanged.

## Mapping

Sandbox `networkAccess` stays false. Writable mode uses `writableRoots: [cwd]`. Read-only uses `writableRoots: []`. `yolo` never gets full access (`fullAccessStatus: 'unproved-disabled'`).

| Consumer | Level | Before 8m-10 (8m-1, all consumers) | After 8m-10 |
| --- | --- | --- | --- |
| chat | ask | `untrusted` + `workspace-write` | unchanged (D14) |
| chat | plan | `on-request` + `read-only` | unchanged |
| chat | auto-edit | `untrusted` + `workspace-write` | unchanged (D14) |
| chat | yolo | `on-request` + `workspace-write` | unchanged |
| lane, gateway, usage | ask | `untrusted` + `workspace-write` | granular all-true + `read-only` |
| lane, gateway, usage | plan | `on-request` + `read-only` | unchanged |
| lane, gateway, usage | auto-edit | `untrusted` + `workspace-write` | `on-request` + `workspace-write` |
| lane, gateway, usage | yolo | `on-request` + `workspace-write` | unchanged |

Granular all-true is `sandbox_approval`, `rules`, `skill_approval`, `request_permissions`, and `mcp_elicitations`, each `true`.

`profileFingerprint` hashes `approvalPolicy` and `sandboxPolicy` (plus consumer and the other thread-identity fields). Chat ask and auto-edit digests stay on the 8m-1 values. Lane, gateway, and usage ask and auto-edit digests return to the pre-8m-1 values because those two fields are restored and no other identity field from 8m-1 changed. Plan and yolo digests never moved.

## Pre-8m-1 evidence

Commit `3fe8842700e58844eccdbedf60137f6e7975e5cb` (`fix(codex-runtime,rpc-handlers): ask before writes in manual mode (8m-1)`) is the change that widened the mapping. Its parent `91b848f86d1e1ed0ae5801b5bcbc01ce8802fb58` has the previous function in `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts`:

- Lines 226–228: `writable` is only `auto-edit` or `yolo` (ask stays read-only).
- Lines 238–250: ask maps to the granular all-true object; plan, auto-edit, and yolo map to `'on-request'`.
- Lines 251–255: sandbox mode follows `writable`, `networkAccess: false`, `writableRoots` is `[cwd]` only when writable.

`git show 3fe884270 -- libs/backend/codex-runtime/src/lib/codex-execution-profile.ts` shows that commit adding `ask` to `writable` and replacing the granular ask branch with `ask || auto-edit ? 'untrusted' : 'on-request'` for every consumer.

`c7367c03698f75e50ab525304b8f41ce3498c988` (`docs(task-specs): record round 8m wave 2 results`) is later than 8m-1 and already contains the widened mapping. It is not the pre-image.

D14 in `.ptah/specs/TASK_2026_714_c8a2/decisions.md` (P8 D14, 2026-10-28): Ptah `ask` and `auto-edit` map to `untrusted` + `workspace-write`; `plan` and `yolo` stay as they were. That decision is what 8m-1 implemented without a consumer guard.

## Decisions

- Apply D14 only for `consumer === 'chat'`, in `resolveApprovalPolicy`. Chat still matches `policy()` from the evidence harness.
- Restore the parent-of-8m-1 mapping for `lane`, `gateway`, and `usage`, including ask (granular + read-only), not only auto-edit. The second CI failure is the lane ask case.
- Do not override policy in `buildCodexLaneProfileSettings`.
- Leave `codex-lane-profile.spec.ts` as written. The two failing cases already expect pre-8m-1 behavior:
  - `retains suppression and Ptah attachment in public core settings` (default level `ask`): granular all-true and sandbox `read-only` (lines 213–222).
  - `delegates auto-edit to the settled core policy`: `approvalPolicy === 'on-request'` and sandbox `workspace-write` (lines 228–243). Plan and yolo in that `it.each` already matched 8m-1.
- Execution-profile specs now pin chat ask and chat auto-edit to `untrusted` (existing harness comparison, now also asserts `consumer === 'chat'`), and lane, gateway, and usage auto-edit to `on-request` + `workspace-write`. They also pin headless ask back to granular + read-only.

## Risks

- Any lane, gateway, or usage thread stored after 8m-1 with an ask or auto-edit fingerprint will not match the restored digest. D14a refuses that resume with `CodexResumeProfileChangedError`. The native runtime is dev-gated, and Codex 0.155.1 rejects `approval_policy = "untrusted"` at startup, so those headless sessions were unlikely to have started.
- Chat ask and auto-edit fingerprints are unchanged, so D14a behavior for main chat is unchanged.
- Gateway keeps an approval sink from batch 9a, but this batch puts gateway auto-edit back on `on-request`. Under the D14 research note, `on-request` plus a restricted sandbox allows in-sandbox commands unless an override is requested. That is the pre-8m-1 behavior this batch was told to restore.
- `policy()` in the evidence harness still returns `untrusted` for ask and auto-edit. Only chat profiles mirror it. Headless profiles intentionally differ.

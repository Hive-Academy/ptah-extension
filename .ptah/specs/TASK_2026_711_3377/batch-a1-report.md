# Batch A1 report

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`: exported `PTAH_LANE_POLICY`, task-text placement, resume `lanePolicy` flag.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`: typed `LanePolicyDelivery`, `instructionFileStore` and SDK effective-channel hook.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`: config delivery with argv-limit fallback to SDK task text; channel reporting.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`: explicit task-text channel.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`: policy in SDK system prompt append content.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-instruction-file-store.ts`: per-run claim/write/remove with canonical path containment and symlinked-parent rejection.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: owns the store, passes it to adapters, cleans up on spawn failure, stop, timeout, exit and subprocess release; stamps effective channel from SDK handle when supplied.
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`, `di/register.ts`: store token and singleton factory using the injected file provider.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`: guidance bound raised to 64 KiB with explicit truncation marker.
- Specs changed: `cli-adapter.utils.spec.ts`, `codex-cli.adapter.spec.ts`, `ptah-cli-spawn-options.role.spec.ts`, `enhanced-prompts.service.spec.ts`; added `lane-instruction-file-store.spec.ts`.

## Acceptance evidence

- Policy: `cli-adapter.utils.ts:416` has canary once, all requested table keys, skill rule, file URL browser rule, cost and memory rules. Measured UTF-8 size: **2,378 bytes**. A static roster scan found no forbidden vendor word.
- Delivery: `cli-adapter.interface.ts:43`, `cli-adapter.utils.ts:520-616`, `codex-cli.adapter.ts:539-652`, `cursor-cli.adapter.ts:328-332`, and `ptah-cli-spawn-options.service.ts:199-205` establish the three A1 channels. The other adapters default to task text. The Codex handle reports a fallback channel to `agent-process-manager.service.ts:726`.
- Files: `lane-instruction-file-store.ts:8-62` implements `write(workspaceRoot, agentId, relativeName, content): Promise<string>` and `remove(agentId): Promise<void>`. `agent-process-manager.service.ts:693-719` passes `instructionFileStore` through `CliCommandOptions`; terminal cleanup is at about lines 1959, 2211, 2290 and 2333.
- Guidance: `enhanced-prompts.service.ts:75-110` keeps 64 KiB with a truncation notice; its spec now supplies >64 KiB input.
- Resume: `cli-adapter.utils.ts:503-580` renames the delivered block to `lanePolicy`, omitting it only for a restored context when task text delivered it. Codex config is rebuilt per process and continuation.
- Specs include canary size, vendor roster and placement checks, a store write/remove/symlink/traversal test, and updated SDK prompt assertions.

## Verification

No Jest, Nx, TypeScript, build, lint or e2e command was run, per the batch prohibition. `ptah_get_diagnostics` was called on changed production files; it returned **unavailable** because its TypeScript check remained running after 45 seconds. It reported nine files unchecked, so compilation is unverified. Static byte and forbidden-token checks passed.

## Gaps for orchestrator

- The combined 4,000-byte argv preamble cap is **not implemented** for the unchanged argv adapters. Their final `assertCommandLineWithinLimit` remains the only bound.
- DI host guard lists (`expected-resolvable.ts` / `container.smoke.spec.ts`) were not updated. The token is registered by the shared runtime factory, but host smoke coverage is not added.
- Codex, Cursor and Ptah CLI specs were adjusted but not executed; further test updates may be needed after the orchestrator's scoped run.
- The store has an integration seam but no A1 adapter writes a file, so failed-spawn and terminal cleanup of an actual instruction file have not been exercised through the manager.

## Decisions

- **Store API:** pass the manager-owned store in `CliCommandOptions`; adapters call `write(root, agentId, relativeName, content)` only after the per-CLI file channel is verified. This follows the manager's existing ownership of agent ID and terminal paths, avoids global config, and is reversible.
- **Codex overflow:** use task-text fallback only for `CliCommandLineTooLongError` from the predicted argv check; other errors still fail. This follows the plan's explicit fallback and retains the final command-line guard.
- **Cursor:** keep task-text delivery because the channel matrix has no confirmed SDK system field. Reversible if a verified field becomes available.

## A2 handoff

Use `options.instructionFileStore?.write(options.workingDirectory, options.agentId, relativeName, content)` from verified file-channel adapters. The `relativeName` is a slash-separated safe path below `.ptah/lanes/<agentId>/`; the returned absolute path is passed to that process only. The manager calls `remove(agentId)` at terminal paths and failed spawn. A2 should verify channel support per installed CLI before writing, implement the 4,000-byte combined argv fallback cap at actual argv assembly, and add host DI guard coverage.

## Revise round 1

- **Manager TS2304/TS2552:** `agent-process-manager.service.ts:824-831` now derives the effective channel from the SDK handle and `meta.roleStamp` in that scope. It uses `effectiveInfo` when adding the session ID. At lines 1972, 2224 and 2303, cleanup awaits removal only when the optional store exists; this preserves the idle release timing in tests.
- **Codex assertions:** `codex-cli.adapter.spec.ts:1418-1422,1436-1441` now checks the 10,000-character cap on the role block itself and expects the policy appended in `developer_instructions`. The second assertion excludes `developer_instructions` from both compared override sets. Production delivery is correct.
- **Ptah CLI assertion:** `ptah-cli-spawn-options.role.spec.ts:155-160` expects the capped role followed by the policy in the SDK system prompt. Production delivery is correct.
- **Windows link test:** `lane-instruction-file-store.spec.ts:37` creates a junction on Windows and a directory symlink elsewhere; the production symlink rejection remains intact.
- **Argv gap:** `cli-adapter.utils.ts:634-667` provides `buildArgvTaskPrompt`, budgeting 4,000 UTF-8 bytes for the policy, role and guidance preamble. It reserves the whole policy, truncates guidance before role, and retains the source pointer for a condensed role. `opencode-cli.adapter.ts:623,692` uses it for the positional prompt and retains a final command-line guard. `antigravity-cli.adapter.ts:690,699` uses it on the `--print` argv path and retains its guard. `cli-adapter.utils.spec.ts:101-115` tests the byte limit and policy canary. The Copilot adapter uses an SDK task field, so it has no argv prompt to cap.
- **DI guard gap:** `apps/ptah-cli/src/di/container.smoke.spec.ts:849`, `apps/ptah-electron/src/di/container.smoke.spec.ts:977`, and `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:236` assert that the runtime store token resolves as a singleton. The `expected-resolvable.ts` lists contain handler classes, so the store symbol belongs in these token checks.

### Verification

- Initial four changed specs: `Tests: 1 failed, 199 passed, 200 total`; the new argv assertion revealed a two-byte policy separator omission. After fixing it, the focused helper spec reported `Tests: 105 passed, 105 total`. The other three specs passed in the initial run.
- Manager, OpenCode and Antigravity specs: `Tests: 2 failed, 294 passed, 296 total`; the two manager idle release failures came from an await on an absent optional store. After the guarded await fix, the focused manager idle release run reported `Tests: 162 skipped, 14 passed, 176 total`. OpenCode and Antigravity passed in the combined run.
- Scoped `ptah_get_diagnostics` was called after edits. The TypeScript compiler remained running beyond the tool's 45-second window; result **unavailable**, three files unchecked on the final request. Host smoke specs were added but not run under the CLI runtime Jest config.

### Decisions

- Keep the 10,000-character limit on the role block itself; appending policy text to a stronger channel increases the total field length without changing the role cap. This matches `renderRoleBlock` and is reversible if the channel contract changes.
- Keep the store symbol out of `EXPECTED_RESOLVABLE`, which is a handler-class census; test token resolution directly in each host smoke spec. This follows the existing DI guard structure and is reversible.

### A2 update

The shared argv helper is now available as `buildArgvTaskPrompt(options, cli)` from `cli-adapter.utils.ts`. File-channel adapters should continue to use the existing `instructionFileStore.write(workspaceRoot, agentId, relativeName, content)` API and report their effective channel through the SDK handle.

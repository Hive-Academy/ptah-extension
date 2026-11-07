# Implementation report — Batches 1 and 2

Status: partial. Scoped source changes are in place; typecheck remains blocked by two consumers assigned to later batches.

## Files changed

- Shared contracts: `agent-process.types.ts`, `rpc.types.ts`, and `messages/{agent-monitor.ts,index.ts,message-constants.ts,payload-map.ts,schemas.ts,agent-monitor.spec.ts}`.
- Adapter contract and translation: `cli-adapter.interface.ts`, `lane-spawn-policy.ts`, and Claude, Codex, Copilot, Antigravity, OpenCode, Cursor, Grok, and Pi adapter implementations.
- Detection and provider rows: `cli-detection.service.ts`, `ptah-cli-registry.ts`, `agent-spawn-environment.service.ts`.
- Specs updated beside the adapters, detection, lane spawn policy, and Ptah CLI registry.

## Adapter manifests

| Adapter | Messaging: steer / interrupt / continue / resume | Explicit permission | Network deny | Limit reader | MCP |
| --- | --- | --- | --- | --- | --- |
| Claude | no / no / yes / yes | plan, ask, auto-edit, yolo | unsupported | available: anthropic | yes |
| Codex | yes / no / yes / yes | plan, auto-edit, yolo; ask refused | plan and auto-edit only | available: openai-codex | yes |
| Copilot | no / no / yes / yes | plan, scoped auto-edit, yolo; ask refused | unsupported | no-reliable-source | yes |
| Antigravity | no / no / probe-dependent / yes | plan, auto-edit, yolo; ask refused | unsupported | no-reliable-source | yes |
| OpenCode | no / no / yes / yes | plan only | unsupported | no-reliable-source | yes |
| Cursor | no / yes / yes / yes | all refused pending SDK binding evidence | unsupported | no-reliable-source | yes |
| Grok ACP | no / no / yes / yes | all refused pending ACP evidence | unsupported | no-reliable-source | yes |
| Pi | yes / no / yes / yes | all refused pending RPC scope evidence | unsupported | no-reliable-source | unsupported |
| Ptah CLI provider | no / no / yes / yes | Claude SDK modes | unsupported | PtahCliLanePlanLimits for claude-cli and ollama-cloud; no-reliable-source otherwise | yes |

Unsupported manifest entries carry a reason. Detection rows carry the manifest, including failed detections. Ptah CLI `listAgents()` rows carry the provider manifest.

## Policy translation

| Path | Native translation |
| --- | --- |
| Codex | plan → read-only; auto-edit → workspace-write; yolo → danger-full-access; deny → native `networkAccess: false` with plan or auto-edit; yolo + deny refused |
| Claude / Ptah CLI | plan → plan; ask → default; auto-edit → acceptEdits; yolo → bypassPermissions |
| Copilot | plan → `--mode plan`; auto-edit → scoped write-tool allowlist; yolo → `--allow-all` |
| Antigravity | plan → `--mode plan`; auto-edit → `--mode accept-edits`; yolo → `--dangerously-skip-permissions` |
| OpenCode | plan → `--agent plan`, removing default `--auto` |
| Cursor / Grok ACP / Pi | explicit permission refused; explicit network deny refused |

Omitted fields leave the prior argv/options path unchanged. Explicit unsupported requests throw `LaneSpawnPolicyError` with `UNSUPPORTED_LANE_POLICY` before adapter process creation. URL filters do not count as network denial.

## Tests added or updated

- Shared push schemas: all receipt terminal states, parent delivery states, and unknown-field rejection; compile-time RPC and manifest contracts.
- `lane-spawn-policy.spec.ts`: Codex translation, yolo + deny refusal, Claude denial, and unchanged default argv.
- Adapter specs: manifest messaging and limit reader assertions migrated from legacy booleans.
- Detection mock manifest and Ptah CLI provider manifest assertions.

## Verification

- `npm run verify -- -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime`: shared lint/typecheck and CLI runtime lint passed; CLI runtime typecheck failed at `agent-message-router.service.ts:423` because it expects legacy booleans. Test phase failed to build the Nx project graph when three plugin workers exited. Nx summary: 4 tasks, 3 succeeded, 1 failed.
- `npm run verify -- -t typecheck -p @ptah-extension/cli-engine,@ptah-extension/platform-cli,ptah-electron`: platform-cli passed; cli-engine and Electron failed. Both logs name `agent-message-router.service.ts:423` and `mcp-response-formatter.ts:1998` (new `start-turn` mode missing from its label map). Nx summary: 3 tasks, 1 succeeded, 2 failed.
- `npm run verify -- -t test -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime`: shared passed; CLI runtime failed. Nx summary: 2 tasks, 1 succeeded, 1 failed. CLI runtime Jest summary: 74 suites failed, 56 passed, 130 total; 9 tests failed, 949 passed, 1 skipped. Most failed suites could not resolve Jest's `marked` mapping because this worktree lacks `node_modules/marked/lib/marked.umd.js` (verified `Test-Path` false, while the main checkout has it). The nine assertion failures are in untouched `mcp-install.service.spec.ts`.
- `git diff --check`: passed.
- Scoped `ptah_get_diagnostics`: no errors in requested policy or registry source files; eight sibling errors from the legacy router and test mocks before the scoped detection mock was updated.

## Pre-existing failures

The missing `marked` worktree dependency and nine `mcp-install.service.spec.ts` failures are independent of changed files: the former fails during module resolution through `tool-output-reducers/markdown.reducer.ts`; the latter spec and implementation are untouched. No baseline run was available to prove when the nine assertions began failing. The router and formatter failures are integration follow-ups caused by the widened types and are outside Batch 1–2 file scope. The earlier Nx plugin worker exits occurred during project graph construction, before tests ran; their root cause is unverified.

## Needs

- Batch 3 should call `legacyMessagingCapabilities(adapter.capabilities())` in `agent-message-router.service.ts:423` and update its own legacy mocks.
- Batch 5 should add the `start-turn` label in `mcp-response-formatter.ts:1998`.
- The spawn manager owns the `SpawnAgentRequest` to adapter options handoff, but is outside this lane's allowed files. It must pass `permission` and `network` through and call `AgentSpawnEnvironment.resolveLanePolicy()` before process creation. Its Ptah CLI provider spawn path must pass these fields into `PtahCliRegistry.spawnAgent()`.
- The MCP/RPC error boundary outside this scope must preserve the structured `LaneSpawnPolicyError.refusal` payload.

## Decisions

- Kept the manifest as the only adapter declaration and derived legacy booleans through `bestMessagingCapability`; the plan chooses this. Reversible by the later messaging conversion.
- Refused unverified Cursor, Grok ACP, and Pi policy modes; Tier 1 evidence does not establish native enforcement. Reversible after verified binding evidence.
- Marked provider limit readers available only for the two Ptah CLI provider IDs with owner rules in `PtahCliLanePlanLimits`. Reversible if another owner rule is implemented.

## Not done

- Spawn manager request handoff and structured MCP/RPC refusal rendering, both outside this lane's allowed files.
- Full green verification, due to the two out-of-scope type consumers, missing worktree Jest module mapping, and nine unrelated MCP install assertions.
- Skill loading: this host did not list a skill catalog or skill-loading tool for the lane.

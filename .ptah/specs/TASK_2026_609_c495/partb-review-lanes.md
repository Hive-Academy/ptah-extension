# Part B Code Logic Review — lane-authored slice

Verdict: APPROVED WITH NOTES
Score: 8/10

Scope: 2b9af459f, d28ce1337, 8fffc0652, 89fb3c5d3, 4fe3cae22, 15d845bd2, 6d9dcba5e, each read with `git show`, plus direct callers. Scoped test (`nx test harness-sync`, patterns for the resolver, agent-transformers and rival-targets.agent-model specs): 3 suites, 35 tests passed. The spec bodies were not read in full; the tests are evidence only for the paths they name.

## Checklist

| Item | Status | Evidence |
|---|---|---|
| (a) Root identity, resolver vs B-5g save | OK for the RPC path; Moderate residual (Finding 1) | The resolver passes the root from `resolveHarnessWorkspaceRoot(cwd)` (harness-reconciler.service.ts:173) to `layersForPath` (plugin-config-source-resolver.ts:285). The save path runs `requireActiveWorkspace` and `quarantineWorkspaceRoot` through the same `resolveHarnessWorkspaceRoot` (skills-synthesis-rpc.handlers.ts:2369-2416). Both then go through `normalizeActivePath` in `workspace-scope-resolver.ts:16-31`, so a trailing slash is stripped and a Windows drive letter is lowercased. Git root vs folder is not a mismatch because both sides use the same marker walk (`.ptah` then `.git`). |
| (b) Escaping per format | OK | Codex: `tomlBasicString(model, true)` escapes `\` and `"`, then every control character below 32 and 127 as `\uXXXX`. `Array.from` iterates by code point, so astral characters pass through intact. YAML (Copilot, Cursor, OpenCode) uses `yamlDoubleQuoted`, which escapes `\` and `"` and handles CR/LF. Other controls are not escaped there, but `isAgentModelEmittable` rejects every `\p{Cc}` plus U+2028/U+2029 (agent-models.types.ts:77,150), so they cannot reach it from the builder. The no-model path is the old `tomlBasicString` branch with the same replace chain, so the output is byte-identical. Copilot and Cursor use `replace(/^---\n/, () => ...)`. The function form of the replacement keeps `$` in a model from being read as a replacement pattern. `transformAgentContent` normalizes CRLF and always emits a leading `---\n`, so the anchor matches. |
| (c) Getter null or throw | OK | `readAgentModels` (resolver:276-288) returns undefined for a falsy root, a null getter result, or a throw. `agentModels` is spread in only when defined, so the resolved shape is unchanged and reconcile is unaffected. The host getters check `isRegistered` before `resolve`. |
| (d) Machine-only model, no root | Intended, with a caveat | `if (!workspaceRoot) return undefined` (resolver:282). Reconcile always has a root, because `resolveHarnessWorkspaceRoot('')` returns `''` and the check is falsy. A machine-only model therefore only drops out for an unscoped `resolve()`. Consistent with the comment, but see Finding 3. |
| (e) Silent failures | Two gaps | Findings 2 and 3. |
| PR/PA plan items, B-5b (one instance per process) | OK | `new AgentModelSettings` exists only inside the `if (scopeResolver)` guard in the vscode, electron and cli registrations. Hosts resolve it lazily, so there is one queue per process. |
| B-5c byte-identical `listAll` | OK | `diff` of the removed handler code against the new service: same call order (`listModelsForAll`, then Codex, then Copilot), same fallbacks, same `name` logic, same result object. `registerSingleton(CliModelListService)` sits in `registerSharedRpcHandlers`, which runs before `AgentRpcHandlers` is registered on vscode (phase-3:92), electron (phase-4:105) and cli (container.ts:839 vs 918). |
| B-5c provenance rule | OK | `codexReported` and `copilotReported` are true only when the live auth or host list was non-empty. Detector entries, cursor and opencode get `isFallback: true`; claude is `[]`. `listAll` and `listForClassification` share one `loadModels`, so `listModelsForAll` runs once per call. |
| Review fixes 1-6 | Partly checked | Items touching these commits hold (shared selection rule, builder warn wiring at di/register.ts:134, `HarnessPlanWrite.model` replacing the cast hack). Not re-verified against implementation-plan.md :200-210 line by line. |
| FU-4 (6d9dcba5e) | OK | `write.model` is read directly in `apply` (workspace-target.ts:982), so plan and apply use the same field. Type-only change; no behaviour change. |

## Findings

1. **Moderate** — Windows path-segment case can split the workspace key. `normalizeActivePath` lowercases only the drive letter (workspace-scope-resolver.ts:21-27), so `C:\Foo` and `c:\foo` hash to different `workspace.<hash>` keys. The resolver root comes from the reconcile cwd (rival-CLI cwd or host folder) and the save root from the host's active folder. Both are normalized by `resolveHarnessWorkspaceRoot`, which does not fold case or call `realpath`. Scenario: a rival CLI is launched from a shell that spells the folder with different casing from VS Code's `fsPath`. The saved workspace model is never seen and no copy carries it. Fix: case-fold the whole path on win32 inside `normalizeActivePath`, and add a spec with two spellings of the same folder.

2. **Moderate** — `readAgentModels` swallows every error with no log (resolver:284-286). If the settings store throws, or the path is rejected as un-normalizable, the user has set a model and every copy silently inherits the parent model. This is the "silent success" shape, and the resolver has no logger. Fix: accept an optional warn callback (the builder already has one) and log once per root, or return a `modelsReadFailed` flag the builder surfaces in health.

3. **Moderate** — The host getter returns null when `AGENT_MODEL_SETTINGS` is unregistered (the `scopeResolver` guard is false, i.e. no `ACTIVE_WORKSPACE_SOURCE`). In that case every model is dropped, with no signal at all. `requireAgentModelSettings` in B-5g refuses in the same situation, so the UI will error while the sync stays silent. Acceptable, but record it in health or the log.

4. **Minor** — Settings changes made through the B-5g save path do not obviously trigger a reconcile. Nothing in these commits subscribes to `agentGeneration.models`, so a copy changes only at the next reconcile trigger. That is a B-5g/B-6 wiring check, not a defect in this slice. Confirm that `HarnessPropagationService` is called after save.

5. **Minor** — `resolveAgentModels` warns on every reconcile for each non-emittable hand-edited value (builder:626-632). There is no dedupe, so a long-lived bad value produces repeating log noise. Low severity.

6. **Minor** — `isAgentSelectedForSync` takes `agentSyncEnabled !== false`, so `undefined` means enabled. The builder passes a real boolean, so builder behaviour is unchanged. A future preview caller that omits the flag gets "enabled" and could disagree with `AgentSyncGate`. The doc comment states this, so it is acceptable.

No Blocking or Serious findings. The five logic questions were applied to each commit; Findings 1-3 are the ones that held up.

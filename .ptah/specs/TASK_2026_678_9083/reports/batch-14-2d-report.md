# Batch 14.2d — projection source and barge-in N1

## Part 1: projection input

Source: `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`.

| Input field | Frontend source |
| --- | --- |
| `rootTabId`, `rootSessionId` | Caller arguments, lines 57 and 168–169. |
| `rootProviderId` | Root tab `liveModelStats.contextCapacity.providerId`, checked against `PROVIDER_BRAND_SLUGS`; unknown IDs become `undefined` (lines 16–18, 170–172). `TabState` has no direct provider ID. |
| `children` | Live `TabManagerService.tabs()` with `agentOrigin.parentTabId` matching the root; tab name, session, live model provider, status-derived `CommandWorkState`, and last activity (lines 60–70). |
| `persistedChildren` | `ChatStore.sessions()` entries with `organization.parentSessionId` matching the root, including last activity (lines 71–81). The session list exposes the persisted parent link. |
| `agents` | `AgentMonitorStore.agents()` CLI lanes and `subagents()` SDK records whose `parentSessionId` is the root or an owned child, including persisted children (lines 82–114). Status maps through `state()` at lines 20–47; `workflowRunId` becomes `runId`; CLI uses `ptahCliId` or CLI type for its brand; SDK uses Anthropic. Agents with no parent or an unrelated parent are excluded. |
| `runs` | `CommandCenterRecordsService.readRunManifests(workspace, root.tabId)` filtered by `rootSdkId`, with `PhaseDerivationInput` assembled from manifest move/spec/lanes and monitored agents (lines 115–166). The manifest has no artifact names or phase progress, so `artifacts` is `null` and `derivePhase` can report phase unavailable. Lane metadata absent from the manifest falls back to the monitored CLI or a generic `ptah-cli` lane; run state is `running` only when a monitored run agent is running, otherwise `unknown`. |

Spec: `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts:17` covers root provider, live child name/provider/state, persisted child, owned CLI and SDK agents, exclusion of another session's agent, and a root manifest run.

Controller wiring to apply in the later lane: add `private readonly projectionSource = inject(CommandCenterProjectionSource);`, register `CommandCenterProjectionSource` in the page providers, and replace the current inline object with this exact call:

```ts
return projectOwnedWork(this.projectionSource.input({ tabId: root.id, sessionId: rootSessionId }));
```

## Part 2: barge-in N1

`libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:279` clears `synthesisIds` beside `playbackMarks` when barge-in drops queued speech. The new case at `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts:415` barges into a four-chunk reply, fails the following reply's first synthesis, and verifies the next played chunk carries its `post-barge-in` origin with no mark left.

## Verification

- Jest: `Test Suites: 2 passed, 2 total`; `Tests: 13 passed, 13 total` (one requested invocation).
- ESLint: exit 0 on the four changed TypeScript files.
- Prettier `--write`: completed on the four changed files; `--check`: `All matched files use Prettier code style!`
- The requested Bash `tasklist` prerequisite check printed `tasklist: command not found`; Bash then ran Jest, which passed. No other Jest process was intentionally started by this lane.

## Decisions

- Provider branding uses known `PROVIDER_BRAND_SLUGS` keys only; unknown values do not produce a misleading logo.
- Persisted session links supplement live tabs, so closed child tabs can still project when listed by `ChatStore.sessions()`.
- Manifest records do not include artifact names or a complete lane roster. The source reports available run and lane identity without claiming completed phases.

## Not done

- Controller and page provider wiring are reserved for the orchestrator's later lane and were not edited.
- No Nx, TypeScript compiler, or Git command was run, per lane instructions.

# Code Logic Review — CodeRabbit r4 fixes (PR #900)

Implementer families: Claude (A), codex (B)
Review family: Claude subagent (A same-family, weaker evidence; B different family)
Verdict: APPROVED

Scope: read-only review of `git diff HEAD -- libs apps` plus the surrounding code, no tests run. Files read: select-codex-executable.ts (whole selection/snapshot/probe path), session-metadata-store.ts addCliSession, agent-process-manager.service.ts (updateCliSessionId and its callers), codex-app-server-lane.adapter.ts (openContext, retry, fallback path), agent-events.ts, cli-adapter.utils.ts (createBufferedEmitter), agent-process.types.ts.

## Findings

No Blocking or Serious findings.

1. Moderate — libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1213-1223
   `updateCliSessionId` is adapter-agnostic and treats the initial `cliSessionId` as "abandoned". Spawn pre-sets `cliSessionId` to `resumeSessionId` (lines 986, 1081, 1094). The Claude SDK lane (claude-sdk-lane-runner.ts:153) and ACP (acp-session-handle.ts:860) also call `onSessionResolved`. If a resumed run resolves to a different id than the one requested, the resume id is added to `replacesCliSessionIds`. `addCliSession` then drops the older agent's reference for that id and deletes its `ptah.agentOutput:<agentId>` key, which previously stayed. Codex is safe: a resumed Codex lane keeps `hasTurnHistory = true`, so its fallback reuses the identity (adapter lines 421, 510-512). The risk is only for non-Codex lanes whose resumed id differs.
   Fix: record `previous` only when it was not the resume id (for example, track the resume id separately and skip it), or gate the replace list to ids this run itself reported.

2. Moderate — libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:183-190, 213-220
   The new id and `replacesCliSessionIds` are persisted only on `agent:exited` or `agent:quota-owner`. `agent:spawned` fires with the original id, and `onSessionResolved` updates `tracked.info` silently, with no event. If the host dies mid-run after the fallback, the store keeps the abandoned zero-turn id X and a later resume uses the dead thread. This matches the old behaviour for any id change, but the fix does not close the window for this case.
   Fix: emit a lifecycle event (or call persist) when `updateCliSessionId` changes the id.

3. Minor — libs/backend/agent-sdk/src/lib/session-metadata-store.ts:2037-2041
   The stale-write guard returns silently, with no log and no `emitChange`. That is correct behaviour but hard to diagnose. Add a debug log.

4. Minor — libs/backend/agent-sdk/src/lib/session-metadata-store.ts:2019
   The doc comment indentation was broken (` *` became `    *`), which will draw a lint or format complaint. Fix: restore the original indentation.

5. Minor — libs/shared/src/lib/types/agent-process.types.ts:537
   `replacesCliSessionIds` is persisted on `CliSessionReference`, which is returned to the UI by session metadata queries. It is marked internal in a comment, but nothing strips it. This is harmless and optional.
   Fix: strip it when projecting to the UI if the UI uses strict types.

6. Minor (part A) — libs/backend/codex-runtime/src/lib/select-codex-executable.ts:84
   `reportedVersion` is `output.trim().slice(0, 128)` of the raw stdout, or of stderr when stdout is empty. Multi-line or banner output is part of the key. This is deterministic per binary, so it is only a re-probe cost if the banner varies (for example, update notices).
   Fix: optional. Use the first line.

## Checks requested

Part A:
- Key consistency: `markUnsupported`, `activateFallback` (through `markUnsupported`) and `selectForOpen` all call `unsupportedKey` on selections that came from `inspect`, so all carry `reportedVersion`. The `?? version` fallback only covers hand-built selections. Spreading a `bundledFallback` copy keeps the field; `failed` passed to `markUnsupported` is the original frozen selection. OK.
- Version cache: `readVersion` stores and returns the raw `output` on a cache hit (lines 262-270). OK.
- Prerelease versus stable at the same base version now get different keys, and so do two paths. OK.
- Spec assertions: `select-codex-executable.spec.ts` has no `toEqual` or `toStrictEqual` on whole selection objects (grep). Other specs build selections by hand. OK.
- Weaker evidence: same-family review, with no tests run.

Part B:
- Existing semantics without the field: `replacedIds` is empty, so `exactIndex` is used, and the `prior.replacesCliSessionIds` merge is empty unless the prior carried the field. The slot-replacement and displaced-agent deletion logic is equivalent for old references. The displaced loop now skips entries whose agent is still retained in `updated` (same-agent replace), which is correct. OK.
- Stale old-id write: when an entry with `replacesCliSessionIds` including the incoming id exists, the write is ignored. The guard runs inside `enqueueWrite` after a fresh `get`, so it is serialised. OK.
- Replacement chain: merging `prior.replacesCliSessionIds` and deleting the current id keeps the abandoned set across later writes. The list is bounded by the number of fallbacks.
- Displaced-agent cleanup: output deletion happens after `flush()`, as before, and is limited to agents that no longer have a reference. OK.
- The lane reports the new id immediately: `sessionResolved.emit` runs at the end of `openContext`, used by both the fallback open (line 510) and the first open. The buffered emitter replays to a late subscriber. See finding 2 for persistence timing.
- No `any`, `as unknown as`, `!` or `console.*` in the changed source.

## Cross-family review (codex)

Verdict: APPROVED — 7/10; 0 Blocking, 0 Serious. Both requested fixes work by inspection. The score stays below 8 because the existing session-persistence timing gap remains; it stays above 6 because neither change introduces a demonstrated failure.

| Part | Logic and spec assessment |
| --- | --- |
| A: executable mark | `unsupportedKey` uses canonical path plus raw reported version (`select-codex-executable.ts:129-130`); selection and marking use that same key (`:133-155`). The mutable `versions` map and installed-path array in the new spec (`select-codex-executable.spec.ts:115-137`) exercise prerelease → stable at one path and stable at another path. Both assertions should pass. |
| B: session replacement | `updateCliSessionId` records the prior ID only for Codex (`agent-process-manager.service.ts:1212-1225`). The mock registers `onSessionResolved` before `spawnFromSdkHandle` returns (`account-binding.spec.ts:109-121`; service `:1340-1344`), so both callback assertions (`account-binding.spec.ts:373-398`) should pass. The non-Codex case leaves `replacesCliSessionIds` unset, preserving the old reference when persistence later processes the new ID. |

Five logic checks: (1) Silent failure: no new silent failure in these changes; the existing delayed persistence window is at `agent-process-manager.service.ts:1212-1225` and `agent-events.ts:187-189,218-220`. (2) User action: upgrading prerelease to stable at the same path selects the installed binary (`select-codex-executable.spec.ts:128-131`). (3) Input: an equal version at another path gets a distinct key (`:133-137`). (4) Dependency failure: absent bundle retains installed selection on later opens, while `activateFallback` rejects (`select-codex-executable.ts:139-150,163-169`). (5) Unspecified case: a host crash after ID resolution and before exit can retain the old persisted ID; this predates commit `53d117af7` and remains Moderate.

Checks: scoped `ptah_get_diagnostics` returned 0 errors for the four reviewed files. Jest was not run as instructed; the pass assessment is from tracing `probes`, `harness`, `lane`, and callback order. The tests do not cover persistence after callback delivery. No skill loader was available in this lane.

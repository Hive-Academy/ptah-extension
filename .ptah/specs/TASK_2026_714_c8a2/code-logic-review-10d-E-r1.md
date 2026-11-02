# Code Logic Review — Batch 10d.E revision 1 (TASK_2026_714_c8a2)

Review family: claude
Implementer family: codex

Score: 6/10

VERDICT: REVISE

Scope examined: `git diff` of all 14 modified files and the untracked
`codex-lane-composition.ts` and `codex-lane-composition.spec.ts` (read in full). Context read:
`registration.ts#resolveGatedCodexRuntime` (`:108-135`) and the `ParityGate` token
(`registration.ts:66`), `session-metadata-store.ts` (`updateCodexExecution` detail build,
`getForWorkspace`, `getAll`, `sessionIndexEntry`, SQLite `toRecord` `isChild`),
`sqlite-session-record-repository.ts#listForWorkspace`, `session-runtime-identity-cache.ts`,
`cli-detection.service.ts` constructor injection, `agent-process-manager.service.ts#readOutput`,
the two `getAll` consumers (`peer-session-directory.service.ts:169`,
`host-attention-coordinator.ts:260`), and D26/D27 in `decisions.md`.
No checks were run (read-only review by instruction).

Why 6 and not 7-8: six of the seven defects are fixed with real proofs. But the change contains an
uncommitted, unflagged edit of `parseOutput` that deletes every single newline from lane output,
and the R3 case is tautological. Why not 4-5: routing, D27 binding, lane-row isolation and
disposal are correct and spec-proven.

## Defects 1-7 of the first review

| # | Status | Evidence |
| --- | --- | --- |
| 1 R3 and 10d.E spec cases | partial | (a) `codex-lane-composition.spec.ts:173-184` (spawner throws on call); (c) `:255-285` (`process.env['CODEX_HOME']` = other home, catalog/run profile home and MCP names from selected home; credential probe proven at `codex-app-server-lane-auth.spec.ts:43-49` and `codex-app-server-lane.adapter.spec.ts:186-196`); (d) `:296-299`; (e) `:316-321`, `:328-344`. (b) is tautological, see new defect 2. |
| 2 lane rows in chat store | fixed | marker written `codex-thread-identity-store.ts:115`; cross-consumer persist refused `:99-100`; reads filtered `:59`; lane rows marked child `session-metadata-store.ts:1168-1169`; listings filter `:1579-1580`, `:1588`; SQLite `is_child` excludes them (`sqlite-session-record-repository.ts:103`); chat lookup drops them `session-runtime-identity-cache.ts:44-48`; host resume refuses unmarked rows `codex-lane-composition.ts:118`. Rows without the marker map to `chat` in every check (`codex-thread-identity-store.ts:59,99,140`), so existing chat rows keep their behaviour. Spec `session-metadata-store.spec.ts:350-376`. |
| 3 gate bypass / D27 | fixed | single helper `codex-lane-composition.ts:240-249`, only call site `:223`; bind rule `:235-236`; packaged+closed throws without reading the dev route `:248`; gated path `:245` (dev route is consulted only when the gate is closed, and that branch is unreachable here). Specs: `codex-runtime-composition.spec.ts:178-183` (unpackaged raw, packaged closed throws with `PTAH_CODEX_RUNTIME_DEV: '1'` set), `:192-209` (packaged admitted); `container.smoke.spec.ts:1340-1348` (packaged closed: no factory, legacy adapter). |
| 4 empty HOME / CODEX_HOME | fixed | `codex-lane-composition.ts:109-111` (`||` chain, explicit empty refused); one visible warning `codex-app-server-lane.adapter.ts:139-142`; spec `codex-lane-composition.spec.ts:379-393`. |
| 5 requestUserInput | fixed | port `codex-lane-composition.ts:214-217` delegates to the lane sink, which emits the kind-only line (`codex-app-server-lane.adapter.ts:252`); spec `codex-lane-composition.spec.ts:346-377` checks `{}` and the exact line without the question text. |
| 6 catalog model and cwd | fixed | `codex-lane-composition.ts:169-174` (`CODEX_LANE_DEFAULT_MODEL`, `tmpdir()` as cwd/workspace); export `cli-agent-runtime/src/index.ts:51`; spec `codex-lane-composition.spec.ts:269-270`. |
| 7 source-text order check | fixed | real resolution `container.smoke.spec.ts:1335-1348`. `CliDetectionService` takes the factory by constructor injection (`cli-detection.service.ts:91`), so registration order matters only before first resolve; the harness (`container.smoke.spec.ts:1189-1197`) repeats the order of `phase-2-libraries.ts:299-306` rather than calling it. Accepted residual. |

## New defects

1. **major — lane `parseOutput` now deletes every single newline.**
   `codex-app-server-lane.adapter.ts:184` changed from `/\r(?!\n)/g` (HEAD `82e5b4455`) to
   `/\n(?!\n)/g`. The adapter applies it to every text segment (`:246`), and
   `agent-process-manager.service.ts:1865-1866` applies it to the whole stdout/stderr buffer on
   read. Failure: lane output `"line 1\nline 2\n"` becomes `"line 1line 2"`. Multi-line answers,
   code blocks and lists collapse, and the tail-line limit of `readOutput` counts one line. A bare
   `\r` is no longer stripped. The revision report does not list this change and no spec covers
   `parseOutput` for this adapter.
   Fix: restore `/\r(?!\n)/g` and add an adapter spec case that keeps `\n` and removes a bare `\r`.

2. **minor — the R3 isolation case cannot fail.**
   `codex-lane-composition.spec.ts:216,236` compares `context1.identity.profileFingerprint` with a
   value read from the same static `fakeContext` object (`:59-69`), and `:224,240` compares
   `laneProfile.profileFingerprint` with itself. `CodexRuntime.prototype.open` is mocked
   (`:189-192`), so no runtime state exists that a later open could change. The assertions at
   `:242-244` prove only that later opens get their own profiles. R3 requires proof that a lane
   profile change does not change an open chat context's policy, and the reverse.
   Fix: snapshot the opened profiles (deep copy or `Object.isFrozen` check) before the later opens
   and compare after, or exercise a real `CodexRuntime` per scope with a fake spawner and assert
   the chat context's `turnPermissionLevel`/profile after `updateNextTurn` on the lane, and the
   reverse.

3. **minor — lane-row exclusion is proven only on the legacy storage path.**
   `session-metadata-store.spec.ts:121` builds the store without an `ISessionRecordRepository`, so
   `:350-376` exercises `getForWorkspace` at `session-metadata-store.ts:1583-1591`, not the SQLite
   branch at `:1574-1580` that Electron uses. The SQLite branch is correct by reading (`isChild`
   from `isChildSession` `session-metadata-store.ts:595`, `is_child = 0` filter
   `sqlite-session-record-repository.ts:103`, summary carries `codexThread` via
   `sessionIndexEntry` `:539-543`), but it is untested.
   Fix: add the same case with a records-backed store (existing fixtures at
   `session-metadata-store.spec.ts:894-912` or `:2043`).

## Five logic questions

1. Silent failure: lane output loses newlines with no error (new defect 1).
2. User action: a user reads a lane's multi-line result through `ptah_agent_read`; it shows one
   joined line (new defect 1).
3. Wrong answer: none found in routing, identity or resume; cross-consumer rows fail closed.
4. Dependency failure: failed open disposes the scope (`codex-lane-composition.ts:226-228`);
   empty home reports once and does not spawn.
5. Missing from requirements: none new; D27 covers lane selection before 10d.P.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Rate the `parseOutput` edit major although it is outside the 7 defects | major / minor / out of scope | it is in the uncommitted batch diff and corrupts every lane read (`agent-process-manager.service.ts:1865`) | yes |
| Accept the smoke harness order as the fix for defect 7 | fixed / partial | constructor injection at `cli-detection.service.ts:91` makes first resolve, not register order, the contract | yes |
| Accept `consumer: 'lane'` plus `isChildSession` as the isolation choice | accept / ask for a separate store | marker absent maps to `chat` in all checks; listing, lookup and resume all filter | yes |
| Not flag the `displayName` change `cli-detection.service.ts:41` | flag / skip | matches both real adapters (`codex-cli.adapter.ts:322`, `codex-app-server-lane.adapter.ts:108`) | yes |

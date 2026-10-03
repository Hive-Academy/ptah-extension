# Code Logic Review — TASK_2026_580 R-TL8

VERDICT: APPROVED

Score: 8/10

Counts by severity: Blocking 0 · Serious 0 · Moderate 1 · Minor 2 · Failure modes 2

Scope reviewed (read in full unless noted): the uncommitted diff to
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts` and
`session-spawner.service.spec.ts`; the SDK `idResolved` fan-out
(`sdk-agent-adapter.ts:1139-1191`); the recorder port
(`platform-core/src/interfaces/session-organization-recorder.interface.ts:1-74`); the
recorder adapter (`session-organization.service.ts:369-403, 726-786`, `store.ts:223-254,
638-661, 769-782`); Electron DI (`apps/ptah-electron/src/di/phase-2-libraries.ts`,
`container.ts`, `activation/wire-runtime.ts`) and CLI DI
(`libs/backend/cli-engine/src/lib/container.ts`,
`thoth/register-thoth-libraries.ts`). Contract sources: `implementation-plan.md:1196-1223,
1428-1440`, `batches.md:170-185, 343`.

## Summary

The wiring is behaviourally correct on every check requested. The call is placed after
`bindSdkSessionId`, the non-child early return is preserved, the field mapping matches the
580↔584 contract (real SDK id never a tab id, parent by SDK id with the required
`lifecycle.find(parentTabId)?.realSessionId` fallback, optional task id), the store path is
idempotent, the failure is caught and logged without breaking bind or grace handling, and
the seven specs assert real observable behaviour. The only material gap is latent, not
active: the recorder is captured through an optional constructor injection, so a future
consumer that resolves the spawner during DI (before
`registerSessionOrganizationServices` runs) would pin `null` for the process life with no
error — and neither host currently pins that the spawner (as opposed to the three other
producers) actually holds the recorder.

## Five logic questions

### 1. How does this fail silently?

- Store-unavailable boot window. `registerSessionOrganizationServices` binds the recorder
  token whenever `SQLITE_CONNECTION` is registered, even if the connection is not yet open
  (`session-organization/lib/di/register.ts:36-55`). A child that binds its SDK id in that
  window reaches `recordOrganization` and the recorder is called, but
  `SessionOrganizationService.capture` drops the write at `runCapture` when
  `isAvailable()` is false (`session-organization.service.ts:757-773`). The child's lineage,
  worktree and task link are then never written, and the only trace is a
  `[SessionOrganization] recordAgentStartedSession dropped ...` output line. This is the
  plan's documented behaviour (`implementation-plan.md:1250-1252`), not a defect, but it is
  a real silent-to-the-user failure: the sidebar chip and group-by-parent simply omit the
  child.
- DI-order capture. `organizationRecorder` is an optional ctor param resolved once at
  construction (`session-spawner.service.ts:210-211`). If anything resolved
  `CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER` before `registerSessionOrganizationServices`,
  tsyringe would hand back no instance and the spawner would keep `null` forever, silently
  recording nothing. Verified not to happen on either host today (see question 4).

### 2. What user action produces unexpected behaviour?

- Starting a child session while the SQLite connection is still opening yields a child with
  no organization row (question 1). Every other child action behaves as intended.
- A parent whose SDK id is not yet known when the child starts is handled: the record
  captures `parentSdkSessionId` as undefined, and `recordOrganization` falls back to
  `sdkIdOf(child.parentSessionId)` at resolve time
  (`session-spawner.service.ts:876-877`). Verified by the spec at
  `session-spawner.service.spec.ts:878-891`.

### 3. What input data produces a wrong answer rather than an error?

- None found in this diff. `parentSessionId` is omitted (not passed as the tab id) whenever
  its SDK id is unknown (`:882`, spec `:893-904`); `taskId` is omitted rather than
  synthesised (`:885`, spec `:867-876`). An empty or malformed `realSessionId` reaches the
  recorder, which validates and drops it (`session-organization.service.ts:381-389`), so no
  bad row is written.
- One boundary the wiring relies on but does not enforce itself: it trusts the SDK
  `realSessionId` to be non-empty. `bindSdkSessionId` returns `undefined` for a blank id
  (`session-child.registry.ts:219-220`) yet `recordOrganization` is still invoked with the
  blank id; the recorder's own validation catches it. Correct outcome, but the guard lives
  one layer away.

### 4. What happens when a dependency fails?

- The recorder throws synchronously: caught and logged
  (`session-spawner.service.ts:887-893`); the already-completed bind and the subsequent
  grace-timer cancellation still run. Spec `:930-951` proves bind survives and the log line
  is emitted. The port contract already promises never-throw
  (`session-organization-recorder.interface.ts:11-15`), so this is defence in depth.
- The recorder is absent (VS Code, or a build without 580): optional injection yields
  `null`, `recordOrganization` returns immediately (`:874-875`), the child still binds
  (spec `:920-928`).
- The recorder is present but the DB is closed: detached drop + log (question 1).
- **DI order, resolved.** Electron: `registerCliAgentRuntimeServices` registers the
  `SESSION_SPAWNER` token at `phase-2-libraries.ts:291`; the recorder token is bound later
  at `:404` via `registerSessionOrganizationServices`. The spawner is a lazy singleton
  (`cli-agent-runtime/src/lib/di/register.ts:110-114`) and is first resolved only after DI
  completes — `wire-runtime.ts:581-588` (post-DI `captureShutdownHandles`) and, earlier,
  `wire-runtime.ts:328` `registerRpcSurface` constructing `ChatRpcHandlers`
  (`chat-rpc.handlers.ts:135-136`). No phase-2 `.resolve` call touches it; the phase's own
  smoke spec pins that producers are not resolved early
  (`apps/ptah-electron/src/di/container.smoke.spec.ts:500-518`). CLI: token registered at
  `container.ts:688`, recorder bound inside `registerThothLibraries` at
  `register-thoth-libraries.ts:162`, and the spawner is first resolved in phase 4
  (`registerRpcSurface`, `container.ts:901`) or lazily per `ptah_session_*` call
  (`ptah-api-builder.service.ts:1155-1159`). **Conclusion: the recorder IS injected at
  runtime on Electron and the CLI; it is `null` by design on VS Code.**

### 5. What is missing that the requirements never mentioned?

- No host asserts the spawner itself holds the recorder. R-TL11's smoke assertion covers
  `WorktreeHookHandler`, `SessionForkService` and `PtahAPIBuilder` only
  (`container.smoke.spec.ts:593-607`, `ptah-cli/src/di/container.smoke.spec.ts:462-476`);
  the R-TL8 consumer is not in that list. The correctness of this injection is currently
  maintained by DI ordering that no test pins for the spawner.
- No spec asserts the wiring is idempotent under a repeated `SessionIdResolved` (check 4).
  The store is (`ensureOrganization` `ON CONFLICT DO UPDATE`,
  `store.ts:223-227`; `upsertTaskLink` `ON CONFLICT ... DO UPDATE`, `:248-254`), but the
  spawner suite never fires the same resolve twice, so a future non-idempotent change to
  `recordOrganization` would not be caught.

## Failure modes

### Latent null recorder if the spawner is resolved before the recorder is registered

- Trigger: any future host/consumer that resolves `SESSION_SPAWNER` during DI before
  `registerSessionOrganizationServices` runs (the ordering convention R-TL11 exists to
  defend).
- Symptom: children spawn and run normally, but no `session_organization` row is ever
  written for them; the sidebar shows no parent grouping, worktree/branch chip or task
  link. No error is raised.
- Evidence: `session-spawner.service.ts:210-211` (optional capture at construction);
  `session-organization/lib/di/register.ts:36-55` (token bound only when SQLite is);
  tsyringe `dependency-container.js:101-108` (optional resolution returns `undefined`).
- Current handling: none at the spawner — it simply keeps `null` and returns at `:874-875`.
  Electron and CLI happen to be safe (question 4).
- Recommendation: add the spawner to the existing real-host smoke assertions that already
  prove the three producers hold the recorder, so the ordering cannot silently regress.

### Organization write silently dropped while the store is closed

- Trigger: a child SDK id binds during the boot window before SQLite opens (or after a
  native load failure).
- Symptom: the child is usable but permanently missing its organization row for that
  session; nothing surfaces in the UI.
- Evidence: `session-organization.service.ts:757-773` (`isAvailable()` false → log+return);
  `implementation-plan.md:1250-1252` documents the drop.
- Current handling: logged with the `[SessionOrganization]` prefix by the adapter; accepted
  by the plan's failure table.
- Recommendation: none required for R-TL8; optionally the spawner could log at its own
  boundary, but the adapter's single log is the design.

## Blocking issues

None.

## Serious issues

None.

## Moderate issues

### M1 — The spawner's recorder injection is not pinned by a real-host smoke assertion

- File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:210-211`
- Scenario: the injection is optional and captured at construction, so its correctness
  depends on DI ordering. The plan (`batches.md:174-181`) chose pinning over lazy lookup
  for the recorder consumers, and A5.1 added smoke assertions for three of them — but not
  for the R-TL8 spawner.
- Impact: a future reordering (e.g. resolving the spawner in phase 2, as its chat-host
  dependency B5 already warns about) silently disables all child organization capture with
  no failing test.
- Fix: in both `apps/ptah-electron/src/di/container.smoke.spec.ts:593-607` and
  `apps/ptah-cli/src/di/container.smoke.spec.ts:462-476`, resolve `SESSION_SPAWNER` after
  the recorder is bound and assert its `organizationRecorder`/recorder identity equals the
  service; and assert `phase-2-libraries.ts` never resolves the spawner before
  `registerSessionOrganizationServices`, matching the existing producer-text assertion at
  `container.smoke.spec.ts:516-518`.

## Moderate and minor issues

- Minor: `session-spawner.service.spec.ts:851, 874, 888, 901, 917` use
  `h.recorder?.recordAgentStartedSession`. The optional chain would let an assertion pass
  vacuously if the harness ever stopped supplying a recorder; the default harness does
  (`:160-163`), so it is safe today. Prefer a non-optional local in these specs.
- Minor: no spec exercises a repeated `SessionIdResolved` for the same child to pin the
  idempotency claim in `recordOrganization`'s doc comment (`:864-868`).
- Minor (observability, not a defect): the spawner adds no log of its own when
  `organizationRecorder` is null; a host with a registrar but no recorder is
  indistinguishable from one that never configured organization. The port contract makes
  this expected, so it is noted, not requested.

## Data flow

1. SDK session init → `metadataStore.create(realSessionId, workspaceId, ...)` then
   `sessionIdResolvedRegistry.notifyAll({ tabId, realSessionId, ... })`
   (`sdk-agent-adapter.ts:1156-1190`). OK — metadata exists before the listener runs.
2. `SessionSpawnerService.onSessionIdResolved` (`:848-855`): drops without a tab id; drops
   unless the tab id is one of its children. OK — non-children early return preserved.
3. `registry.bindSdkSessionId(tabId, realSessionId)` (`:853`). OK — bind happens first.
4. `recordOrganization(child, realSessionId)` (`:855`). OK.
5. Resolve `parentSessionId = child.parentSdkSessionId ?? sdkIdOf(parentTabId)`
   (`:876-877`). OK — never the parent tab id.
6. `recorder.recordAgentStartedSession({ sessionId: realSessionId, workspaceRoot,
parentSessionId?, worktreePath, branch, taskId? })` (`:879-886`). OK — field mapping
   matches the contract.
7. Adapter `guarded`/`capture` validate and detach (`session-organization.service.ts:369-403,
726-786`). OK — a bad id is dropped, never written.
8. `await resolveRoot(sessionId, workspaceRootHint)` from the child's metadata then
   `isAvailable()` (`:757-773`). Gap: if the store is closed, the write is dropped with a
   log (see failure mode 2) — accepted by plan.
9. `store.recordAgentStartedSession` writes the patch + task link in one transaction using
   `ON CONFLICT DO UPDATE` (`store.ts:638-661, 223-254`). OK — idempotent.
10. `emitChange` → broadcast. OK.
11. Back in the handler, grace timer is cancelled (`:856-861`) — reached even when the
    recorder throws, because step 6 is try/caught (`:887-893`). OK.

## Requirements fulfilment

| Requirement                                                                                           | Status   | Gap                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| Recorder injected at runtime on Electron and CLI                                                      | COMPLETE | Verified by DI ordering (question 4); not pinned by a spawner smoke assertion (M1) |
| Call placed in `onSessionIdResolved` after `bindSdkSessionId`                                         | COMPLETE | `:853` then `:855`                                                                 |
| Non-child early return preserved                                                                      | COMPLETE | `:850-852`                                                                         |
| `session_id` = real SDK id                                                                            | COMPLETE | `:880`                                                                             |
| `parent_session_id` = parent SDK id, fallback `lifecycle.find(parentTabId)?.realSessionId`, else omit | COMPLETE | `:876-877`, `:882`; specs `:848-904`                                               |
| Never store a tab id as parent                                                                        | COMPLETE | spec `:901-903`                                                                    |
| `workspace_root` = parent root                                                                        | COMPLETE | `:881`; `child.workspaceRoot` set from the caller root at `:354`                   |
| `worktree_path`, `branch`                                                                             | COMPLETE | `:883-884`                                                                         |
| `taskId` only when present                                                                            | COMPLETE | `:885`; spec `:867-876`                                                            |
| Idempotent repeated resolve                                                                           | COMPLETE | Store upsert `store.ts:223-254`; not spec-asserted in the spawner suite (minor)    |
| Throw cannot break bind or grace handling                                                             | COMPLETE | `:878-893`; spec `:930-951`                                                        |
| 7 specs assert real behaviour                                                                         | COMPLETE | `:836-952`                                                                         |

Implicit requirements not addressed: none material. Two are noted as moderate/minor above
(spawner smoke pin, idempotency spec).

## Edge cases

| Case                                        | Handled | How                                                                     | Concern                                                            |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No tab id / non-child tab id                | YES     | `:850-852`                                                              | —                                                                  |
| Blank `realSessionId`                       | YES     | Adapter validation drops it (`session-organization.service.ts:381`)     | Guard lives in the adapter, not here                               |
| Parent SDK id unknown at start, known later | YES     | `:876-877` fallback; spec `:878-891`                                    | —                                                                  |
| Parent SDK id unknown forever               | YES     | Omitted; spec `:893-904`                                                | Column stays NULL by contract                                      |
| Child started without task id               | YES     | Omitted; spec `:867-876`                                                | —                                                                  |
| Recorder absent (VS Code)                   | YES     | `:874-875`; spec `:920-928`                                             | —                                                                  |
| Recorder throws                             | YES     | `:887-893`; spec `:930-951`                                             | —                                                                  |
| Repeated resolve (same or rebound id)       | YES     | Upsert store; rebind covered by capture-service rekey on the same event | Not spec-asserted in this suite                                    |
| Store closed at resolve time                | PARTIAL | Adapter drops + logs                                                    | Child organization permanently missing for that session (accepted) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the optional recorder injection is only as reliable as DI ordering that no
  spawner-specific smoke test currently pins; today Electron and CLI resolve the spawner
  well after the recorder is bound, so capture works.
- What a robust implementation would add: a real-host smoke assertion that the spawner's
  bound recorder is the `SessionOrganizationService` (and that phase 2 does not resolve the
  spawner), plus a spawner spec firing the same `SessionIdResolved` twice to pin
  idempotency.

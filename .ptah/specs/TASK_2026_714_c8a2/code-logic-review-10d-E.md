# Code Logic Review — Batch 10d.E (TASK_2026_714_c8a2)

Review family: claude
Implementer family: codex

VERDICT: REVISE

Score: 6/10

Scope examined: full `git diff` of the worktree (9 files) and the untracked
`apps/ptah-electron/src/di/codex-lane-composition.ts` (read in full). Read for context:
`codex-runtime-composition.ts` (whole file), `codex-app-server-lane.adapter.ts` (constructor,
detect, credentials, runSdk open/close/approval path, resumeIdentity),
`codex-thread-identity-store.ts`, `session-metadata-store.ts#updateCodexExecution`,
`codex-runtime.ts#close`, `codex-approval-bridge.ts` (userInput branch),
`codex-execution-profile.ts#codexProfileFingerprint`, `di/registration.ts#resolveGatedCodexRuntime`,
plan-p10.md (10d.E and the Lane preserve list) and plan-p10-review.md (R1-R4).
No checks were run (read-only review by instruction).

Why 6 and not 7-8: the structure is sound (one child container, one runtime, one approval sink
per lane open; close reaches `runtime.close()` and `container.dispose()`; `create()` is pure),
but R3 and three plan spec cases have no proof, the "separate lane identity store" is the chat
session store, and the lane path bypasses the lane parity gate without a recorded decision.
Why not 4-5: no defect found that shares a CodexContext, leaks a chat approval sink, or grants
full access.

## Defects

1. **major — R3 and the 10d.E spec cases are not proven; `codex-lane-composition.ts` has no spec.**
   `apps/ptah-electron/src/di/codex-lane-composition.ts:93-247` is new and untested. The only
   new Electron case (`codex-runtime-composition.spec.ts:164-184`) proves that two scope
   factories give two runtime instances and two sinks. It does not open a context and does not
   exercise `registerElectronCodexLaneFactory`. Plan 10d.E requires cases for "distinct lane/chat
   policy and CODEX_HOME isolation, no extra process on detection", and R3 requires "the 10d.E
   spec proves that a lane profile change does not change an open chat context's policy, and the
   reverse". None exist. The implementer report admits this.
   Structural assessment: R3 is met by construction (separate child container, immutable
   per-open profile, `consumer` guard at `codex-lane-composition.ts:177`), but the amendment is
   binding on the proof, so it is a gap.
   Fix: add `codex-lane-composition.spec.ts` (with `import 'reflect-metadata'` first, fake
   spawner, fake runtime via the registration ports, jest fake timers). Cases: (a) `create()` and
   `detect()` call no `spawnProcess`; (b) one chat scope opens with a chat profile, a lane opens
   with a lane profile, then assert each `CodexContext` profile/fingerprint is unchanged after the
   other opens and after a second lane with other options opens; (c) `profiles.resolve`,
   `credentials.check`, `openCatalog` and `readCodexUserMcpServerNames` all receive the same
   `CODEX_HOME` when `env['CODEX_HOME']` differs from `process.env['CODEX_HOME']`;
   (d) `runtime.open` rejects a non-lane profile; (e) `close()` on the owned context calls
   scope dispose once and a failed open disposes the scope.

2. **major — the "separate lane identity store" is the chat session metadata store.**
   `codex-lane-composition.ts:99-114` builds the lane store with
   `createCodexThreadIdentityStore(getMetadata(), getMetadata())` on
   `SDK_TOKENS.SDK_SESSION_METADATA_STORE`. `persist` (`codex-thread-identity-store.ts:81-113`)
   calls `updateCodexExecution`, which creates a full `SessionMetadata` row with
   `runtime: 'codex-app-server'`, keyed by the lane thread id
   (`session-metadata-store.ts:992-1135`). This is the same row shape that main chat writes
   for its own sessions. Consequences:
   - The requirement "separate ... lane identity store" is not met; lane threads become
     indistinguishable from native Codex chat sessions in the store (PLAUSIBLE impact: they can
     appear in chat session listings for the active workspace when the lane cwd is not a
     registered foreign workspace, `session-metadata-store.ts:763-772`).
   - The write bypasses chat's `SessionRuntimeIdentityLookup` writer
     (`codex-runtime-composition.ts:327` uses `lookup` as writer), so the chat runtime-identity
     cache is stale for these ids until restart, then sees them after restart.
   - A chat resume of a lane thread fails only because the fingerprints differ; nothing marks
     the row as a lane row.
   Fix: give lanes their own storage key space or mark the row (for example a `consumer: 'lane'`
   discriminator in the thread record that chat listings and chat resume reject), or a separate
   store file. If reuse is intended, record it as a decision with the user and add a spec that a
   lane row is excluded from chat listings and chat resume.

3. **major — lane opens bypass the lane parity gate without a recorded decision.**
   `codex-lane-composition.ts:226-228` resolves `CODEX_RUNTIME_TOKENS.Runtime` from the scope
   and calls `open`. The composition module says the raw token is only for lifecycle ownership
   (`codex-runtime-composition.ts:256-258`); routing must use `resolveGatedCodexRuntime`
   (`di/registration.ts:109-123`), which also honours `PTAH_CODEX_RUNTIME_DEV`. The new spec even
   asserts that the lane gate is closed (`codex-runtime-composition.spec.ts:176-177`) while the
   factory routes every Electron lane to the native runtime. The `'lane'` scope consumer also
   skips the only capability check (`codex-runtime-composition.ts:230`). The task asks for
   native-by-default, so the behaviour may be intended, but no decision record ties "default
   before 10d.P proof" to "ignore the lane parity gate", and there is no fallback when the pin or
   bundle is absent (the lane then fails at run time instead of selecting the legacy adapter).
   Fix: either open through `resolveGatedCodexRuntime(scope.container, 'lane', input.platform)`
   and make the factory return the legacy adapter while the gate is closed, or record a
   decision (D-number) that 10d.E deliberately overrides the lane gate until 10d.P, and replace
   the misleading spec assertion with one that documents the override.

4. **minor — account home resolution differs from the credential probe for empty variables.**
   `codex-lane-composition.ts:105-109` uses `??` for `HOME`/`USERPROFILE`; the default probe uses
   `||` (`codex-app-server-lane-auth.ts:23`). With `HOME=''`, `join('', '.codex')` is relative,
   `canonical` throws `Invalid Codex lane path`, and `detect()` reports Codex as not installed
   (`codex-app-server-lane.adapter.ts:138-142`) with only a class-name warning. With
   `CODEX_HOME=''` the probe returns `unreadable` but the lane throws the same path error.
   Fix: use `||` for the home fallback chain and treat an empty `CODEX_HOME` as an explicit
   unusable home with one visible message; add the case to the new spec.

5. **minor — `requestUserInput` requests are answered silently with empty answers.**
   The lane scope passes no `requestUserInput` port (`codex-lane-composition.ts:198-217`), so
   `codex-approval-bridge.ts:460-462` returns `{}` for `item/tool/requestUserInput` and the lane
   output gets no line. R1 names four kinds; this fifth kind is neither declined visibly nor
   reported. Fix: pass a lane `requestUserInput` that emits the same kind-only line as the
   approval sink and returns an empty/declined answer, or document the accepted reduction
   under D26.

6. **minor — catalog context uses a hard-coded model and CODEX_HOME as the writable root.**
   `codex-lane-composition.ts:182-187` sets `model: 'gpt-6-sol'` instead of the adapter's
   `CODEX_LANE_DEFAULT_MODEL`, and `cwd`/`workspaceId` = the account home, so the lane policy
   makes the credential directory the workspace-write root. No turn starts on this context, so
   the risk is low, but a renamed default model makes the catalog open fail and fall back.
   Fix: import the lane default model constant; use a neutral read-only `usage`-style consumer
   or a temp cwd for the catalog profile.

7. **minor — DI order guard is a source-text check.**
   `container.smoke.spec.ts:1326-1333` compares `indexOf` of two source strings in
   `phase-2-libraries.ts`. A reformat or rename breaks it, and it does not prove the factory is
   registered before `CliDetectionService` is first resolved. Fix: resolve
   `CliDetectionService` in `composePhase2(true)` and assert its Codex adapter is a
   `CodexAppServerLaneAdapter`, which proves the real order.

## Requirement table

| Requirement / preserve row | Status | Evidence |
| --- | --- | --- |
| R1 consumer 'lane', workspace-write cwd, networkAccess false | met | adapter guard `codex-app-server-lane.adapter.ts:224-225`; host guard `codex-lane-composition.ts:177`; core lane policy `codex-execution-profile.ts:184` |
| R1 every approval declined with one kind+name line | met for approvals; gap for userInput (defect 5) | adapter sink `codex-app-server-lane.adapter.ts:244-251`; no parent sink or `requestUserInput` in lane ports |
| R1 no explicitFullAccess, no parent-chat cards | met | catalog `explicitFullAccess: false` `codex-lane-composition.ts:186`; lane ports omit `SDK_PERMISSION_HANDLER` |
| R3 no shared CodexContext; lane/chat policy isolation | met structurally; proof gap (defect 1) | separate child container per open `codex-runtime-composition.ts:248`; no spec of open contexts |
| Same host runtime, pin, separate context per lane | met | `findCodexExecutablePin`, `createElectronCodexExecutable`, path equality `codex-lane-composition.ts:197-201`; new `randomUUID` context |
| Separate lane identity store | gap (defect 2) | shared `SDK_SESSION_METADATA_STORE` `codex-lane-composition.ts:99-104` |
| Resume by session id and account binding | met in adapter; host round trip untested | `readByThreadId` `codex-lane-composition.ts:110-115`; `resumeIdentity` `codex-app-server-lane.adapter.ts:486-501` fails visibly on missing/mismatch |
| Approval and sandbox selection | met (D26 reduction) | see R1 rows |
| Detection (no process beyond version probe; packaged root) | met in code; untested at host (defect 1) | `create()` constructs only `codex-lane-composition.ts:242-245`; cached `inspectElectronCodexBinary`; packaged `app.asar.unpacked/node_modules` `codex-runtime-composition.ts:109-110` |
| Credential check in selected CODEX_HOME (defect 9) | met; edge gap (defect 4) | `check(await this.home())` `codex-app-server-lane.adapter.ts:147`; probe precedence `codex-app-server-lane-auth.ts:24-25` |
| Model selection and catalog in same home | met; minor (defect 6) | `openCatalog(binary.path, home)` adapter `:161-162` |
| Ptah MCP and user MCP (never stripped) | met | user servers read with lane home and merged `codex-app-server-lane.adapter.ts:189-208`; Ptah port kept |
| Lifetime / disposal per lane | met | owned `close` → `scope.dispose` → `runtime.close` (closes contexts, `codex-runtime.ts:164-170`) → `usage.close` → `container.dispose`; failed open disposes `:229-232`; late open closed on abort adapter `:290-297` |
| Factory before CliDetectionService | met; weak proof (defect 7) | `phase-2-libraries.ts:299-305` before `registerCliAgentRuntimeServices` |
| No secrets in errors; Zod at boundaries | met | fixed error strings; identity parsed by `identitySchema` in adapter; profile built by Zod builder |
| Spec rules (no any / as unknown as / ts-ignore, no real timers, readonly mocks) | met in changed specs | new cases use `jest.fn`, no timers, no readonly assignment |

## Five logic questions

1. Silent failure: `userInput` returns `{}` with no output line (defect 5); an empty `HOME`
   turns into "not installed" with a class-name-only warning (defect 4).
2. User action: a user opens the chat session list after lanes ran; lane threads stored as
   `codex-app-server` rows can surface as chat sessions that fail to resume (defect 2, PLAUSIBLE).
3. Wrong answer: none found; resume identity and fingerprint checks fail closed.
4. Dependency failure: failed open disposes the scope; close is idempotent; a missing bundle
   fails the lane at run time with no legacy fallback (defect 3).
5. Missing from requirements: whether the lane gate may be overridden before 10d.P, and how
   lane identity rows are kept out of chat surfaces.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the gate bypass as major, not blocking | blocking / major | task explicitly asks native-by-default; only the decision record and spec are missing | yes |
| Treat R3 as structurally met | met / gap | separate child container and immutable profile per open; amendment wording requires a spec, so a proof gap is reported | yes |

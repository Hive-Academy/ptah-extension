# PR803 runtime fixes — recovery record

Recovery lane: ptah-cli (glm), 2026-10-22. Scope held to
`libs/backend/cli-agent-runtime/**` plus this task folder. The browser/guidance edits
(agent-catalog.md, electron-browser-capabilities, chrome-launcher-browser-capabilities,
content-manifest.json) were preserved and not touched. No git operations were performed.

**Revision round 1/2 (same lane family, 2026-10-22):** fixed the two verified defects
from the independent Grok `code-logic-review.md` — the dangling-link ENOENT
misclassification in the instruction store (moderate 1) and the stop spec that never
entered the running-stop branch (moderate 2). While verifying defect 1, the two
previously unexplained ENOENT test failures were root-caused and reproduced (root
cause 6 below). Files touched in this revision, and ONLY these:
`lane-instruction-file-store.ts`, `lane-instruction-file-store.spec.ts`,
`agent-process-manager.service.spec.ts`, and this report.

## Root causes

1. **Original CI failure — codex spec fixture platform-blind.**
   `codex-cli.adapter.spec.ts:923` ("puts policy in continue text once when the resume
   thread id makes developer argv too long") used a 31,000-char thread id. That id breaches
   the win32 WHOLE-COMMAND limit (`WIN32_CMD_SHIM_COMMAND_LINE_LIMIT = 8_191`, measured by
   `assertCommandLineWithinLimit`, cli-adapter.utils.ts:228) but stays far under Linux's
   PER-ARGUMENT `MAX_ARG_STRLEN` (~128 KB), and dropping the ~1 KB policy can never cure a
   per-argument breach anyway. On Linux the `CliCommandLineTooLongError` fallback
   (`policyInTask = true`, codex-cli.adapter.ts:617-622) therefore never fired and the test
   failed in CI.
2. **4332578858 — role stamp read the policy channel.** The manager stamped `roleChannel`
   from `getLanePolicyDelivery`. When the Codex policy falls back to the task prompt, the
   ROLE still rides `developer_instructions` (codex-cli.adapter.ts:592 keeps the role block
   in `developerInstructions` when `policyInTask`), so the stamp lied. Pi delivers role and
   policy on one shared channel.
3. **4332578869 — cleanup could destroy terminal bookkeeping.** At HEAD the startup catch
   ran `await this.instructionFiles?.remove(agentId)` un-guarded before `throw error`, so a
   rejected remove REPLACED the original spawn error; in the stop/timeout/release paths an
   unguarded remove rejection skipped `clearIdleRelease`, `clearTimeout` and `flushDelta`;
   `releaseSubprocess` logged but re-threw, disturbing its caller.
4. **4332578879 — external ACP resume assumed earlier preambles.**
   acp-session-handle.ts (old line 802) passed
   `resumeDeliveredPreambles: fullPromptPreambles(options)` on EXTERNAL resume: a session
   restored from another handle/process/host may never have carried the lane policy or the
   messaging block, so both were silently dropped from the resume prompt.
5. **4332578889 — a vanished directory was owned forever.**
   lane-instruction-file-store.ts `remove()` realpaths the root and the owned directory
   un-guarded, so a deleted owned directory (or a deleted workspace root) made every later
   `remove` reject forever while the map entry stayed.
6. **Revision — a dangling link was misclassified as deleted (Grok review, moderate 1).**
   The ENOENT fix treated every `realpath` ENOENT as "already gone" and dropped ownership.
   But ENOENT also occurs when the owned ENTRY still exists as a dangling link or
   junction: `realpath` follows the link, fails on the missing target, while the entry
   itself remains. Ownership was silently dropped, `assertInside` and the
   changed-directory check never ran, the leftover entry was never retried, and the agent
   id could not be recreated through it.
7. **Revision — the ENOENT guard was realm-dependent; this is why the two ENOENT tests
   failed (now explained, previously "cause unknown").** `remove` classified ENOENT with
   `error instanceof Error`. Jest runs this module inside a `vm` context
   (jest-environment-node `build/index.js:109` `vm.createContext(...)`; the main realm's
   globals are copied only where the new context does not already own the name, `:121` —
   `Error` is a context intrinsic, so the main realm's `Error` is never transplanted).
   `node:fs` rejects with the MAIN realm's `Error`, so inside the vm context
   `instanceof Error` is false for every real fs ENOENT, the guard rethrew, and `remove`
   rejected instead of dropping ownership. Reproduced on this machine (win32, Node
   v24.15.0) with a standalone Node probe that mirrors the Jest realm design — see
   Evidence. OpenCode's probe ("realpath error code ENOENT") saw the right code; the guard
   was the bug. The earlier note in this report that said "suspect Windows temp-dir rm
   flakiness, NOT the realm check" was wrong and is corrected here.

## Dispositions (comment IDs)

- **4332578858 (role stamp)** — FIXED. New optional `SdkHandle.getRoleDelivery`
  (cli-adapter.interface.ts:108-115); Codex returns `'developer-instructions'` on every turn
  (codex-cli.adapter.ts:890), Pi returns its shared channel
  (pi-cli.adapter.ts:552). The manager reads it at both stamp sites
  (agent-process-manager.service.ts:742 with `?? roleChannel` fallback, and :843 guarded by
  `meta.roleStamp`). Codex and pi are the only `getLanePolicyDelivery` implementers, so no
  other adapter's stamping changed.
- **4332578869 (cleanup preserves terminal events/timers/TTL/original startup error)** —
  FIXED in product code, and the revision closed the spec gap. Non-throwing
  `removeInstructionFiles` helper (agent-process-manager.service.ts:2367-2378, warn on
  failure) wired into: the startup catch (:730, then `throw error` keeps the ORIGINAL
  spawn error), the stop path (:2056), the timeout path (:2308), and both
  releaseSubprocess spots (:2402, :2440). `handleExit` (:2453) keeps its existing inline
  `.catch` warn — it is synchronous and already non-throwing. Specs:
  agent-process-manager.service.spec.ts:3175 (settled-release case, retained) AND
  :3196 (revision: live-stop case — see below).
- **4332578879 (external resume doesn't assume earlier preambles)** — FIXED.
  acp-session-handle.ts:802-813: external resume passes NO `resumeDeliveredPreambles`, so
  the first resume prompt re-sends the lane policy AND the messaging block; project
  guidance stays omitted because `buildTaskPrompt` ties that to `resumeRestoresContext`
  (cli-adapter.utils.ts:580), not to the preambles. Same-process `continueTurn` keeps its
  per-thread dedup. New assertion: acp-session-handle.spec.ts:603-605 (resume prompt
  contains `Lane policy id: ptah-lane-policy-v1`).
- **4332578889 (missing directory removes ownership, all other containment checks stay)** —
  FIXED, revision completed the dangling-entry case. lane-instruction-file-store.ts:68-103:
  - ENOENT from `realpath` is narrowed by the realm-independent `isEnoent` helper (:15-20,
    `types.isNativeError` + `code === 'ENOENT'`), so a real fs ENOENT under Jest is
    recognized instead of rethrown (root cause 7).
  - An ENOENT no longer drops ownership outright: the owned path is `lstat`ed without
    following the final component (:88-94). An entry that still exists — a dangling link
    or junction, or any replacement entry — KEEPS ownership and the removal is refused as
    a containment change (`Lane instruction directory changed`, :95). Nothing is ever
    deleted through a link.
  - Only an owned path with NO entry left drops ownership (:96-97): a deleted owned
    directory or a deleted workspace root still settles, and a later write works.
  - When both `realpath` calls succeed, `assertInside` (:99) and the changed-directory
    check (:100) still run unchanged, so a link to outside the root is still refused.
  - Regression: spec test `refuses a lane directory swapped for a dangling link instead of
    forgetting it` (lane-instruction-file-store.spec.ts:93-115) — refuses the removal
    twice, proving the claim survived the refusal (a dropped claim would settle the second
    remove as a no-op).

## Changed runtime files (all under `libs/backend/cli-agent-runtime/src/lib/cli-agents`)

| File | Change |
| --- | --- |
| agent-process-manager.service.ts | `getRoleDelivery` at both stamp sites; `removeInstructionFiles` helper on startup/stop/timeout/release/releaseSubprocess; recovery fix: helper moved above the `releaseSubprocess` doc comment it had displaced |
| agent-process-manager.service.spec.ts | +2 stop-cleanup tests: settled-release bookkeeping (recovery, :3175) and live-stop settle + `agent:exited` with a rejected remove (revision, :3196) |
| cli-adapter.interface.ts | + `SdkHandle.getRoleDelivery` (optional, documented) |
| codex-cli.adapter.ts | private `argvLimitPlatform` seam (:325-329) fed to `assertCommandLineWithinLimit`'s existing third parameter; `getRoleDelivery` (:890) |
| codex-cli.adapter.spec.ts | argv-limit test pinned to `win32` via the seam with try/finally restore; `getRoleDelivery` assertion added |
| pi-cli.adapter.ts | `getRoleDelivery` — shared channel (:552) |
| acp-session-handle.ts | external resume keeps both preambles; `fullPromptPreambles` import dropped (still used by codex/cursor/pi) |
| acp-session-handle.spec.ts | resume-prompt canary assertion added |
| lane-instruction-file-store.ts | `remove` handles realpath ENOENT; revision: realm-independent `isEnoent` helper (:15-20) and lstat distinction that refuses a surviving entry (:76-98) |
| lane-instruction-file-store.spec.ts | recovery rewrite (4 restored + 3 new cases), revision: +1 dangling-link case — see below |

## Preserved original tests (store spec)

`lane-instruction-file-store.spec.ts` was an EXISTING tracked spec. OpenCode's rewrite had
DELETED all four original tests and replaced them with three weaker ones (no round-trip
content check, no delete-failure retention case, no write-time symlink-parent rejection,
no traversal rejection). This recovery restored all four verbatim, on the HEAD-proven
mock-backed `store()` helper (`createMockFileSystemProvider` over real fs), and kept
OpenCode's three new cases on the same helper. The revision ADDED one case; nothing was
deleted or weakened. Current file, 8 tests:

1. `writes under a claimed per-run directory and removes only that directory` (restored)
2. `retains its claim after delete fails so a terminal retry removes the directory` (restored)
3. `rejects a symlinked lane parent` (restored)
4. `rejects traversal in an instruction name` (restored)
5. `drops ownership when the owned directory was deleted, so remove settles and a later write works` (recovery, 4332578889)
6. `drops ownership when the workspace root itself is gone` (recovery, 4332578889)
7. `still refuses a directory swapped for a link to outside the root` (recovery, 4332578889)
8. `refuses a lane directory swapped for a dangling link instead of forgetting it` (revision, Grok review moderate 1; spec:93-115)

OpenCode's hand-rolled `realDiskProvider` was removed: only a jest mock can simulate the
delete rejection that test 2 needs.

## Decisions

1. **Keep the `argvLimitPlatform` private seam.** Not public API: a private field read via
   `Reflect.set`, defaulting to `process.platform`, feeding the platform parameter that
   `assertCommandLineWithinLimit` already had. The alternative (a fixture breaching Linux's
   per-argument limit) cannot work because the policy-drop fallback cannot cure a
   per-argument breach. Reversible: delete the field and pass `process.platform` inline.
2. **Mock-backed helper over realDiskProvider** for the store spec — see above.
3. **`handleExit` keeps its inline `.catch`** — synchronous, fire-and-forget, already
   non-throwing; converting it to the async helper would change nothing observable.
4. **Comment placement repaired, not just code** — the `releaseSubprocess` doc ("Takes the
   record rather than looking it up…") had been displaced onto `removeInstructionFiles`;
   the helper now sits before that doc, which is again attached to its method.
5. **No capability removed silently**: `getLanePolicyDelivery` stays on `SdkHandle` (the
   manager no longer reads it, but adapters expose it and specs may pin it); all pre-existing
   tests in the four touched suites are retained or extended, none deleted.
6. **Revision: `types.isNativeError` over `instanceof Error` for the errno guard**
   (lane-instruction-file-store.ts:15-20). The repo's `instanceof Error` convention is
   untouched everywhere else: those sites only narrow an error message and fail harmlessly
   when the check misses. This guard gates a containment-relevant branch, and there a
   missed ENOENT rethrows and broke the two ownership tests (root cause 7).
   `isNativeError` is realm-independent (probe: true from inside a vm context where
   `instanceof Error` is false), keeps the old guard's strictness — native errors only, a
   thrown string or plain `{ code: 'ENOENT' }` object is still rethrown — and matches the
   file's `node:*` import style. A purely structural `typeof error.code === 'string'`
   check was rejected because it would also accept non-error objects. Reversible: swap
   the helper body back to the instanceof form.
7. **Revision: refuse a surviving entry, never delete through it** (store :88-95). The
   review's fix recommendation, taken over the alternative of removing the leftover link:
   `rm` on a link removes the link itself, but the entry can be an arbitrary hostile
   replacement, so keeping ownership and refusing reuses the existing
   `Lane instruction directory changed` error and stays containment-conservative. No
   traversal and no link following: `lstat` does not follow the final component and
   nothing is deleted on this branch.
8. **Revision: ownership retention proven by a SECOND `remove`, not by a write.** Asserting
   that a following `write` fails was rejected: it would pin the mock provider's
   mkdir-through-dangling-link behaviour, not the store's, and adds platform-dependent
   filesystem semantics. A second `remove` refusing again proves the claim survived with
   no such dependency.
9. **Revision: the completed-path stop spec is RETAINED, the live-stop test ADDED beside
   it** (manager spec :3175 and :3196). The settled-release case still locks the
   release-path swallow; the new case keeps the turn in flight (asserts
   `status: 'running'` BEFORE the stop), calls `stop` first, and settles the handle only
   through the stop's own abort — completion is not faked before the stop. It proves the
   rejected remove does not skip the running-branch terminal tail: stop resolves with
   `status: 'stopped'`, `remove` is called exactly once, the failure is logged at warn,
   and `agent:exited` still carries the stopped record.

## Evidence (exact — no new pass is claimed)

- **PASSED (lane-reported, opencode, before its quota stop):** all 4 existing suites, 354
  tests — agent-process-manager, acp-session-handle, codex-cli.adapter (+ the runtime
  changes through the ACP resume fix). That run PREDATES the store-spec rework and the
  revision.
- **FAILED (opencode's last store-spec run, intermediate state):** 2 of 3 tests — the two
  ENOENT ownership-drop tests. The lane then exceeded its check authorization; **that
  intermediate spec was never re-run.** The lane's standalone probe confirmed `realpath`
  yields `code: 'ENOENT'`.
- **EXPLAINED (revision, standalone Node probe, win32, Node v24.15.0 — NOT a Jest run):**
  a probe reproducing the Jest realm design (a `vm.createContext` sandbox with real
  `node:fs` passthrough, the module code evaluated inside the context) measured, for a
  real `realpath` ENOENT on a deleted directory:
  `{ code: 'ENOENT', instanceofInVm: false, isNativeErrorInVm: true }`; the same error
  from the main realm: `{ code: 'ENOENT', instanceof: true }`. This is the reproduced
  root cause of the two failing ENOENT tests and the measured justification for the
  `types.isNativeError` guard. The probe also measured, on this machine: a junction whose
  target does not exist IS creatable on win32; `realpath` on it yields ENOENT;
  `lstat` on it succeeds (`isSymbolicLink: true`); `lstat` on a truly absent path yields
  ENOENT with `isNativeError: true`; `realpath` on a junction to an existing outside
  directory resolves to that outside directory (test 7's premise).
  Probe sources: jest-environment-node `build/index.js:109` (vm.createContext), `:121`
  (main-realm globals copied only for names the context does not already own — `Error` is
  a context intrinsic), `:198` (`global.Error` is the context's own).
- **UNRUN (this recovery and this revision):** no jest, nx, tsc, lint or build — PR805
  holds the heavy-check slot; CI on push is the verifier. The revision's code and spec
  changes are verified by code reading plus the standalone probe only. Both new spec
  cases are UNRUN: the dangling-link refusal (store spec:93-115) and the live-stop
  regression (manager spec:3196). The probe is not a jest-runtime execution: it mirrors
  the environment's realm design, it does not run ts-jest or the module under Jest.

## Quota record

- lane: opencode; family: opencode; cause: monthly Go quota 100% used; reset:
  2026-11-04 11:44 UTC. No opencode retry before the reset. Recorded in context.md.

## Unresolved

1. The store spec (8 tests, including the new dangling-link case) and the two manager
   stop-cleanup tests are UNRUN — CI or the orchestrator's focused run must confirm
   them. The revision's new cases rest on probe-verified fs behaviour, not on a Jest
   execution.
2. The two historical ENOENT failures are now explained (root cause 7) and the guard is
   fixed, but the explanation rests on a probe that mirrors Jest's realm design rather
   than on a Jest run. If the store spec still fails in CI, capture the thrown value
   (`code`, `constructor.name`, `util.types.isNativeError`) before changing the guard
   again — do not guess.
3. Live adherence probes stay deferred until after #803 merges (2026-10-21 user decision).
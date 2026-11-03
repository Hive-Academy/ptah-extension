# Code Logic Review — 10d.C (CLI/TUI) and 10d.V (VS Code) native Codex lane wiring

Review family: claude
Implementer family: codex

Scope: uncommitted diff in W (`git status --short`), read in full:
`libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts` (+spec), `cli-engine/src/lib/container.ts`,
`cli-engine/src/lib/surface-composition.spec.ts`, `cli-engine/package.json`, `apps/ptah-cli/src/di/container.smoke.spec.ts`,
`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts` (+spec), `phase-2-libraries.ts`, `container.ts`,
`container.smoke.spec.ts`, `surface-composition.spec.ts`. Compared against the committed Electron pattern
(`apps/ptah-electron/src/di/codex-lane-composition.ts`, `codex-runtime-composition.ts:154-195`), the shared adapter
(`codex-app-server-lane.adapter.ts`), `registerCodexRuntime` / `resolveGatedCodexRuntime`
(`codex-runtime/src/lib/di/registration.ts`), `verifyCodexBinary` (`codex-protocol-manifest.ts:19-40`) and the pin data.
No checks were run (hard rule). The installed `codex.exe` 0.165.0 is 357,356,336 bytes
(`node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`). This size is used for the cost findings.

| Batch | Score | Verdict |
|---|---|---|
| 10d.C | 7/10 | APPROVED |
| 10d.V | 7/10 | APPROVED |

Both batches meet D27/D28, R1/D26, R3 and the one-home rule. No defect is blocking while the lane gate is closed. The
CLI path is inert today: `CODEX_PARITY_EVIDENCE` has unproved rows, so `registerCliCodexLaneFactory` returns at
`codex-lane-runtime-composition.ts:104`. Score 7, not 8: each batch has one moderate defect (CLI: an unmeasured binary
identity at open; VS Code: an uncached 357 MB hash two times per spawn) and thin specs for some required cases. Not 6:
routing, policy, isolation and disposal are correct and spec-tested where it matters.

---

## Requirement table

| # | Requirement | 10d.C evidence | 10d.V evidence | Result |
|---|---|---|---|---|
| 1 | D27/D28: one helper is the lane routing boundary | `resolveCliCodexLaneRuntime` cli `:91-96`, only caller `:258` | `resolveVsCodeCodexLaneRuntime` vsc `:84-93`, only caller `:231` | Met |
| 2 | Factory bound only when allowed | gate-only `:104`; called before `registerCliAgentRuntimeServices` at `container.ts:769-770` | `!isDevelopment && !gate` returns at `:99`; dev flag `container.ts:53` = `ExtensionMode.Development`; bound before runtime services `phase-2-libraries.ts:263-266` | Met |
| 3 | `PTAH_CODEX_RUNTIME_DEV` never covers lanes | ports omit `devRoute` (`:226-255`), so `registerCodexRuntime` binds `null` (`registration.ts:52-56`) | same (`:187-212`); guard forbids `devRoute`/`readCodexDevRouteOverride` in the lane file (`surface-composition.spec.ts:104-108`) | Met |
| 4 | R1/D26: consumer `lane`, approvals declined, kind-only line | `consumer !== 'lane'` refused `:177`; `requestUserInput` forwards to the adapter sink with `toolName: undefined` `:250-253`; sink line at adapter `:247-253` | `:161`; `:208-211`; spec proves the single `userInput` line and no message text (spec `:120-154`) | Met |
| 5 | R3: separate context per open | new child scope + new `CodexRuntime` per open `:209,256`; parent refusal `:207-208` | `:213-215,229` | Met |
| 6 | `lane` identity marker | `createCodexThreadIdentityStore(..., 'lane')` `:111-112`; reads filter `consumer !== 'lane'` `:126`; spec `:227-258` | `:105-106`, `:119` | Met (VS Code has no persist spec) |
| 7 | One CODEX_HOME for profiles, credentials, catalog, user MCP | `home()` `:113-121` feeds profiles `:133`, adapter credentials/catalog via the `home` ctor arg `:273`, catalog `:181`; user MCP reads `lane.identity.normalizedHome` (adapter `:192-194`) | `:107-114`, `:126`, `:165`, `:240` | Met (user-MCP case not spec-tested in either batch) |
| 8 | MCP not stripped | `userMcpServerNames: []` is filled from discovery by the adapter, same as Electron | same | Met |
| 9 | Detection: SHA-256 against `findCodexExecutablePin`, no spawn | `:158-174` | `:67-81`, `:151-158` | Met, see C-1, V-1 |
| 10 | Catalog: `CODEX_LANE_DEFAULT_MODEL`, neutral tmpdir cwd | `:180-194` | `:164-178` | Met |
| 11 | Empty home: one visible message | `:114-117`; spec `:206-225` | `:108-110`; spec `:156-169` | Met |
| 12 | Disposal once; failed open disposes | `:211-224`, `:261-269`; specs `:279-337` | `:217-236`; specs `:200-257` | Met, see V-2 |
| 13 | VS Code chat stays legacy | n/a | exemption narrows only the native-wiring regex for one path (`surface-composition.spec.ts:104-108`); host-binding regex still applies; import of the lane file pinned to phase 2 (`:92-95`) | Met |
| 14 | Specs portable (Windows/Linux) | homes via `normalizeCodexHomeKey`/`normalizeCodexWorkspaceKey` (spec `:237-238,253-254`); `resolve()` comparisons at `:191,199,239` | pin mocked to `process.platform/arch` (spec `:27,69-74`), `realpathSync` for the executable | Met |

---

## 10d.C defects

1. **moderate — the runtime port claims a verified binary identity that `open()` never measures.**
   `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:228-231` sets `binary.sha256: pin.binarySha256` and
   `versionOutput: pin.version` directly from the pin. `CodexAppServerProcess.initialize` then runs
   `verifyCodexBinary(binary, pin)` (`codex-app-server-process.ts:159-167`). That check compares the pin with itself, so it
   always passes. The only real hash is in the probe (`:168-171`), which the adapter calls before each open
   (adapter `:161,187`). Electron (`codex-lane-composition.ts:195`) and VS Code (`codex-lane-runtime-composition.ts:184`)
   measure the file inside `open()`. Failure scenario: the native package is replaced (npm update, a partial write)
   between `runSdk`'s probe and `runtime.open`, or a later caller calls `runtime.open` without the probe. The process
   starts an unreviewed executable and the pin check reports `ok`. The spec at
   `codex-lane-runtime-composition.spec.ts:279-310` shows the gap: it opens a file that contains `fixture` and the open
   succeeds. Fix: let the probe return the measured digest and pass it into the ports, or reuse one cached inspect
   helper (see V-1) in `open()`. Fix before the lane gate opens.

2. **minor — the probe accepts an explicit path that `open()` always refuses.**
   `codex-lane-runtime-composition.ts:162` hashes `explicitPath ?? resolveCodexNativeBinaryPath()`. `open()` accepts only
   the native path (`:204-206`). An explicit path with the reviewed digest at another location passes detection and
   `runSdk`'s probe, and then fails with "does not match the host binary". Electron (`codex-lane-composition.ts:156-157`)
   and VS Code (`:154-155`) refuse the mismatch in the probe. Fix: compare `explicitPath` with the native path in the probe.

3. **minor — a pin or digest failure is visible only as a class name.**
   The probe throws `Codex executable pin mismatch` (`:171`) or `Reviewed Codex executable pin unavailable` (`:161`).
   The adapter logs only `{ errorClass: 'Error' }` and reports `installed: false` (`codex-app-server-lane.adapter.ts:143-146`).
   The spec pins exactly that (`codex-lane-runtime-composition.spec.ts:172-175`). An operator cannot tell "not installed"
   from "wrong binary". This is shared adapter behavior, also in Electron and VS Code. Note it for the adapter owner.

4. **minor — required spec cases are thin.**
   (a) "The same CODEX_HOME reaches user MCP discovery" has no case (spec covers credentials and catalog at `:181-204`,
   profiles at `:227-239`). (b) The TUI case is source text only (`apps/ptah-cli/src/di/container.smoke.spec.ts:510-516`),
   and the "TUI" call in `codex-lane-runtime-composition.spec.ts:144-147` repeats the CLI call. (c) The dispose spec
   asserts that `CodexAccountUsageClient` is not closed only implicitly (usage is `null`).

5. **minor — the 357 MB executable is hashed once per spawn and once per catalog probe, without a cache.**
   `codex-lane-runtime-composition.ts:168-169` reads the whole file each time the adapter calls the probe
   (adapter `:161,187`). Detection is cached by `CliDetectionService` (`cli-detection.service.ts:142-145`), so detect cost
   is one hash per process. Electron caches by `(path, size, mtimeMs)` (`codex-runtime-composition.ts:163-190`).

6. **minor (duplication) — `canonical`, `pathEntry`, `paths`, `ownedContext`, the profile resolver, the identity store
   and the catalog profile are copied three times** (cli `:46-157,180-194`; vsc `:24-178`; Electron `:49-182`). The copies
   have already drifted: the empty-home rule (cli `:114-117` vs Electron `:109`), the probe (C-2) and the identity at open
   (C-1). A shared host-neutral helper in `cli-agent-runtime` or `codex-runtime` would stop more drift. No defect beyond C-1/C-2.

## 10d.V defects

1. **moderate — the 357 MB executable is hashed two times per lane spawn and two times per catalog probe, with no cache.**
   `inspectVsCodeCodexBinary` (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:67-81`) reads the full
   file. The probe calls it (`:153`), and `open()` calls it again (`:184`). `runSdk` calls the probe and then `open()`
   (adapter `:187,293`). `listModels` calls the probe and then `openCatalog` -> `open()` (adapter `:161-166`). Each lane
   start and each catalog refresh after 30 s therefore reads about 714 MB. This adds a hash delay of roughly a second or
   more to each start on a typical disk. Electron does the same check once per `(path, size, mtimeMs)` and caches it
   (`apps/ptah-electron/src/di/codex-runtime-composition.ts:163-190`). The correctness is right: the digest is compared
   with the pin, the version comes from the matching pin, which is valid because the digest identifies the build. The
   cost is not right. Fix: memoize the inspection by `(realpath, size, mtimeMs)`, as Electron does, and drop the entry on
   failure. Deriving `versionOutput` from the pin (`:79`) instead of a `--version` spawn is acceptable. It removes the
   spawn that Electron does once per cache key.

2. **minor — a failed dispose hides the open error.**
   `codex-lane-runtime-composition.ts:233-235` runs `await dispose(); throw error;`. If `CodexRuntime.close()` or
   `scope.dispose()` rejects, the caller gets the dispose error and the open error is lost. The CLI batch catches and
   logs the dispose error (cli `:261-268`). Electron has the same pattern as VS Code (`codex-lane-composition.ts:226-228`).

3. **minor — the gate-admitted routing spec cannot fail on its target bug.**
   `codex-lane-runtime-composition.spec.ts:259-277` registers one runtime object and expects the helper to return it. A
   helper that ignored the gate and resolved the raw `Runtime` token returns the same object, so the case passes either
   way. Fix: register a gate stub that records `isEnabled('lane', platform)`, or make the raw token unresolvable and
   resolve only via `resolveGatedCodexRuntime`. The closed-production case (`:279-295`) is effective.

4. **minor — no spec for a digest mismatch or a missing pin.**
   The fixture always writes a matching digest (spec `:66-74`). Neither
   `Codex executable digest does not match the reviewed pin` (`:76-77`) nor `Reviewed Codex executable pin unavailable`
   (`:69`) has a case. The missing-binary case exists (`:100-118`). As in C-3, the adapter log has only the error class.

5. **minor (D27 consequence, information) — development mode on a platform without a pin removes a working legacy lane.**
   The pin exists only for win32/x64 (`codex-executable-pin-data.ts:5-14`). In `ExtensionMode.Development` the factory
   is bound on every platform (`:99`). On macOS or Linux detection then fails with "pin unavailable" and Codex shows as
   not installed, with no legacy fallback. Electron unpackaged has the same behavior. This follows D27 as written. Record it
   for 10d.P developers on non-Windows machines.

6. **minor (duplication)** — see C-6. `inspectVsCodeCodexBinary` and the CLI probe are a second and third copy of the
   Electron inspection without its cache.

---

## Answers to the coordinator checks

1. **Routing (D27/D28):** correct in both hosts. CLI binds only on the gate (`:104`) and routes only through
   `resolveGatedCodexRuntime` (`:95`). VS Code binds on dev or gate (`:99`) and routes gated-first, raw only in dev
   (`:88-92`). No dev route reaches lanes.
2. **R1/D26, R3, marker:** met (table rows 4-6).
3. **One CODEX_HOME, MCP kept:** met (rows 7-8). User-MCP home is not spec-tested (C-4a).
4. **Detection by SHA-256:** correct for both against `findCodexExecutablePin`, no spawn in create/detect. The hash runs
   once per process for detect (cached by the detection service), so detect cost is acceptable. Spawn and catalog cost is
   not (V-1, C-5). A mismatch or missing pin gives `installed: false` and a warning with the error class only (C-3).
   CLI `open()` does not re-measure (C-1).
5. **Disposal:** once-only and failed-open cleanup are correct and spec-tested in both. VS Code loses the open error if
   dispose fails (V-2).
6. **VS Code chat guard exemption:** narrow and correct. It removes only `registerCodexRuntime*`/`CODEX_RUNTIME_TOKENS`
   for the one lane file (`surface-composition.spec.ts:104-108`). It keeps the dev-route and host-binding bans, and pins
   the single import to phase 2 (`:92-95`). Specs are excluded from the scan (`:98-99`), so the lane spec does not need the
   exemption. The lane scope is a child container, so chat resolution on the root does not see it.
7. **Specs fail on the bug and are portable:** mostly. Exceptions: V-3 (cannot fail), C-1 (the spec confirms the gap
   instead of guarding it). Paths use `normalizeCodexHomeKey`/`normalizeCodexWorkspaceKey`, `resolve` and `realpathSync`.
   I see no Windows/Linux break. A macOS `/var` symlink would break `resolve(f.home)` comparisons at CLI spec `:191,199,239`,
   but macOS is not in the stated CI matrix.
8. **Duplication:** C-6 / V-6, minor. It has already caused C-1 and C-2.

## Decisions

- **Both batches APPROVED with a moderate defect each.** Options: REVISE for C-1/V-1, or APPROVED with follow-ups.
  Evidence: the CLI path is inert while the lane gate is closed (`:104`), and the adapter hashes before each open, so C-1
  is a time-of-check gap, not an open bypass today. V-1 is cost, not correctness. Reversible: the coordinator can treat
  C-1 and V-1 as required before the gate-opening release step (D27 P14/P15). I recommend fixing both in one shared,
  cached inspect helper (C-6).
- **Adapter log content (C-3) is reported, not counted against the batches.** It lives in `cli-agent-runtime`, outside
  both scopes, and Electron has it too. Reversible.
- **V-5 is information, not a defect.** D27 says "unpackaged (dev) -> native default" without a platform condition, and D28
  maps VS Code dev to `ExtensionMode.Development`. Reversible if the coordinator adds "and a pin exists" to the dev condition.

# Code logic review — batch 10b-2b (TASK_2026_714_c8a2)

- Review family: claude
- Implementer family: codex
- Scope: uncommitted diff of `codex-app-server-lane.adapter.ts` (+ spec) and the new files
  `codex-app-server-lane-binary.ts` (+ spec), `codex-app-server-lane-auth.ts` (+ spec),
  `codex-app-server-lane-models.ts`. All files read in full. Parity baseline:
  `codex-cli.adapter.ts` (detect 338-359, models 377-464, ensureTokensFresh 501-527),
  `codex-native-binary.ts`, `codex-model-catalog.ts`, agent-sdk `codex-native-binary-path.ts`.
- No check was run (read-only review by instruction). Compile findings come from reading the code
  against `tsconfig.lib.json` (`strict: true`).

VERDICT: REVISE

Score: 5/10. The core security property holds: the hash check runs before any spawn, and the
credential probe never falls back to the default home. One likely strict-mode compile error and
two catalog failure modes (rejection with no fallback, no timeout) stop approval. The score is
not 3-4 because the design is sound and each fix is local. It is not 6-7 because the compile
error and the hang break the batch as delivered.

## Defects

1. **blocking — likely TS18048 under strict.**
   `codex-app-server-lane.adapter.ts:164` reads `this.catalogProbe.output`. The `if` at line 150
   narrows only the local `cached`, not `this.catalogProbe`. On the path where the `if` is not
   taken, `this.catalogProbe` keeps its declared type `{...} | undefined`, so the access is
   "possibly undefined". Fix: keep the probe in a local, e.g.
   `let probe = this.catalogProbe; if (!probe || ...) { probe = {...}; this.catalogProbe = probe; }`
   and then `return await probe.output;`.

2. **major — `listModels()` rejects instead of using the curated fallback.**
   `codex-app-server-lane.adapter.ts:144` calls `this.binary.resolve()` outside the `try`.
   `NativeCodexLaneBinaryProbe.resolve` throws on a pin mismatch, a version mismatch, a missing pin
   for the platform, or a non-native basename (`codex-app-server-lane-binary.ts:35-44`). Then
   `listModels()` rejects. The legacy `listModels` never rejects (`codex-cli.adapter.ts:415-424`).
   The preserve row requires the curated fallback on a visible failure. Fix: put the resolve in the
   same `try`, warn with the error class, and return the fallback.

3. **major — the catalog read has no timeout.**
   `codex-app-server-lane.adapter.ts:151-160` awaits `runtime.openCatalog()` and
   `context.listModels()` with no bound. `runSdk` bounds its open with
   `withCodexLaneStartupTimeout` (line 282). The legacy catalog probe is bounded (8 s, comment at
   `codex-cli.adapter.ts:395-398`). A hung App Server start hangs every model-list request. The
   hung promise is cached, so for 30 s every caller joins it. After 30 s a new context opens while
   the old one never closes, so processes can leak. Fix: wrap the IIFE in a startup timeout with an
   `AbortController`, and close a late context the way `openContext` does at lines 274-281.

4. **major — the full binary is hashed on every `detect`, `listModels` and `runSdk` call.**
   `codex-app-server-lane-binary.ts:38-39` streams the whole executable through SHA-256 each call.
   `listModels` hashes before it checks the 30 s cache (adapter line 144 before line 150), so the
   cache does not remove the cost that it was made for (legacy comment
   `codex-cli.adapter.ts:395-398`: one model-list load reads the catalog twice). Each `runSdk`
   also hashes and spawns `--version`. Fix: memoize the verified result by
   `realpath + size + mtimeMs` (from the `stat` at line 29), and hash again only when one of these
   changes. The runtime spawn check stays the final gate.

5. **minor — a failed catalog read is cached for 30 s.**
   `codex-app-server-lane.adapter.ts:161` stores the promise before it settles, and a rejected
   promise stays cached. A transient failure therefore shows the curated fallback for 30 s, and each
   call logs the warning again. The legacy code avoids this (`codex-cli.adapter.ts:446`: "a cached
   promise cannot replay an error"). Fix: clear `this.catalogProbe` in the `catch` when it still
   holds that promise.

6. **minor — `detect()` rejects on a pin or version mismatch.**
   `codex-app-server-lane.adapter.ts:128` lets the probe error escape. `CliDetectionService`
   catches it, sends it to Sentry as an error and logs "Error detecting"
   (`cli-detection.service.ts:152-160`) on every detection. No result for `codex` is reported. The
   legacy `detect` never rejects (`codex-cli.adapter.ts:338-359`). Fix: catch the error, log a
   warning with the error class, and return `installed: false`. Spawn stays blocked because
   `runSdk` validates again.

7. **minor — the inferred model source label can be wrong.**
   `codex-app-server-lane.adapter.ts:351-352` labels any model equal to `gpt-6-sol` as
   `'ptah-default'`. That includes a user setting that names `gpt-6-sol` explicitly. The legacy
   code passes `options.modelSource ?? 'unknown'` (`codex-cli.adapter.ts:745`). The row says
   "same source label". Fix: derive `'ptah-default'` only when `resolved.lane.identity.model` was
   empty and the default was applied (track it at line 184). Otherwise use `options.modelSource`
   or `'unknown'`, as in the legacy code.

8. **minor — an empty `options.model` fails the profile build with an opaque error.**
   `codex-app-server-lane.adapter.ts:184` uses `??`, so `''` is kept. The profile schema
   `text` (`codex-execution-profile.ts:12-15`) needs `min(1)`, so `runSdk` throws
   "Invalid Codex execution profile input". The legacy code omits an empty model
   (`codex-cli.adapter.ts:571`, `...(options.model ? { model } : {})`). Fix: use
   `options.model || resolved.lane.identity.model || CODEX_LANE_DEFAULT_MODEL`.

9. **minor (10d wiring) — the default credential probe and `openCatalog` do not know the lane home.**
   `codex-app-server-lane-auth.ts:70-72` reads `process.env.CODEX_HOME`. The lane context runs in
   the profile's `normalizedHome`, which the host profile resolver selects
   (`codex-execution-profile.ts:273-285`). `openCatalog(binaryPath)` (adapter line 76) also takes no
   home or profile. If 10d selects a per-account home, `ensureTokensFresh` and the catalog can read
   a different account than the one the lane runs. This matches legacy behavior today, because the
   legacy lane also used `process.env`. Fix in 10d: inject a probe bound to the resolved home, and
   give `openCatalog` the home or a catalog profile. Add a 10d.E spec that the catalog context is
   not the chat context (R3).

## Spec quality

- No `any`, `as unknown as`, `@ts-ignore` or `eslint-disable` in the changed specs. No pending real
  timers were added. The clock spy is restored in `finally`.
- Binary spec mocks `findCodexExecutablePin` with the full row shape (no excess properties against
  `CodexExecutableManifestRow`). The "changed binary" case asserts that `probeCliVersion` is not
  called, which proves hash-before-spawn.
- Gaps: no spec for `listModels` when the binary probe throws (defect 2), for a catalog hang
  (defect 3), for a cached failure (defect 5), for `detect` on a pin mismatch (defect 6), or for
  `CODEX_HOME=''` (the probe returns `unreadable`, which is correct, but it is not pinned).
- Not verified (no typecheck allowed): `credentials: { check: jest.fn(async () => 'fresh') }`
  (adapter spec harness) can infer `Promise<string>` and fail assignment to
  `Promise<CodexLaneCredentialStatus>` under Jest 30 typings. If typecheck flags it, write
  `async (): Promise<CodexLaneCredentialStatus> => 'fresh'`.

## Removal of `CodexLaneCapabilityPendingError`

Sound. `libs/backend/cli-agent-runtime/src/index.ts` does not export the lane adapter module. A
text search of `libs` and `apps` found no remaining reference, except the historical
`batch-10b-1-report.md`.

## Parity table

| Preserve row | Item | State |
| --- | --- | --- |
| Detection and actual native binary | Detect without SDK import | kept (agent-sdk path resolver only) |
| | Packaged Electron root, both vendor layouts | kept (binary spec 61-69) |
| | Pin mismatch rejected before spawn | kept (hash before `--version`, spec 71-81) |
| | Version of the binary actually used | kept (exact `codex-cli <pin>` output required) |
| | Explicit path forwarded to runtime open | kept (`open(..., binary.path)`) |
| | Detection never fails the detection pass | gap (defect 6) |
| | Cost of detection / spawn | gap (defect 4) |
| Credential check and account home | Read-only, no refresh or login | kept |
| | Explicit `CODEX_HOME` only, no default-home fallback | kept (stricter than legacy for `''`) |
| | Shared stale-token rule | kept (`isCodexAccessTokenStale`) |
| | Zod at the `auth.json` boundary | kept |
| | Home matches the lane's selected account | gap for 10d (defect 9) |
| Model selection and catalog | `CodexContext.listModels` with pagination | kept (runtime handles cursors) |
| | Curated seven-model fallback with label | kept |
| | Fallback only on visible failure | gap (defects 2, 3) |
| | 30 s binary-keyed cache, no replayed error | gap (defect 5) |
| | Spawn model and Ptah default in profile | kept, but empty-string gap (defect 8) |
| | Same source label | gap (defect 7) |
| | No silent switch of a rejected run | kept (terminal advice fails the run, no retry with another model) |

## Five logic questions

1. Silent failure: a cached rejected catalog promise returns the fallback for 30 s with only a
   warning log (defect 5).
2. User action with unexpected behavior: a user who sets `gpt-6-sol` sees the "Ptah default"
   source in model advice (defect 7).
3. Input that gives a wrong answer: an explicit `CODEX_HOME` that points at another account gives
   that account's status. This is by design and matches legacy.
4. Dependency failure: a hung App Server hangs `listModels` (defect 3). A pin mismatch rejects
   `listModels` and `detect` (defects 2, 6).
5. Missing from requirements: how the catalog context selects its account home (defect 9).

## Re-review (revision 1)

- Review family: claude
- Implementer family: codex
- Scope: all of `codex-app-server-lane.adapter.ts`, `codex-app-server-lane-binary.ts`,
  `codex-app-server-lane-catalog.ts` (new), `codex-app-server-lane-auth.ts`, read in full. The
  changed spec cases in the adapter, binary and auth specs were read. No check was run (read-only
  review by instruction).

VERDICT: APPROVED

Score: 8/10. Each of defects 1-8 is fixed at the cited location, and each fix has a spec case. No
new blocking or major defect was found. The four new defects are minor. The score is not 9 because
the catalog cache lost its binary key and a close failure can discard a good catalog. It is not 7
because the timeout, late-close and cache-clear logic is correct on each path that I traced.

### Per-defect status

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| 1 | TS18048 on `this.catalogProbe.output` | fixed | `codex-app-server-lane.adapter.ts:152-167`. A local `probe` is narrowed to defined after the `if` (the false branch requires `probe` truthy), so `probe.output` at 167 compiles. |
| 2 | `listModels` rejects on a binary failure | fixed | `adapter.ts:155-156` is inside the `try`. The catch at 168-173 warns with the error class and returns the fallback. Spec "falls back visibly when binary verification fails". |
| 3 | Catalog read has no timeout | fixed | `codex-app-server-lane-catalog.ts:4,33-51`. An 8 s race bounds open and list. A late context closes at 22-25. A context open during the timeout closes at 38-44. `closeOnce` (15-18) prevents a double close. The race attaches handlers to `operation`, so a late rejection is not unhandled. The timer is cleared in `finally` (50). |
| 4 | Full hash on each call | fixed | `codex-app-server-lane-binary.ts:51-54` memoizes by realpath, size, mtime, pin hash and pin version. `adapter.ts:154` checks the 30 s cache before `resolve`. Spec "reuses a verified realpath and rehashes when its mtime changes". |
| 5 | Failed catalog cached for 30 s | fixed | `adapter.ts:169` clears the entry only when it is still the same probe, so a newer probe from another caller stays. Spec asserts `openCatalog` count 4 and `resolve` count 5. |
| 6 | `detect()` rejects on a pin mismatch | fixed | `adapter.ts:130-141` returns `installed: false` and warns with the error class. Spawn stays gated by `runSdk` at 180. |
| 7 | Wrong `ptah-default` label | fixed | `adapter.ts:188,356`. The label is `ptah-default` only when the request and the profile model are both empty. Spec "labels only an applied default". |
| 8 | Empty `options.model` | fixed | `adapter.ts:189` uses `||`. Spec "uses the lane default for an empty requested model". |
| 9 | Probe and catalog do not know the lane home | deferred to 10d | Not changed (`codex-app-server-lane-auth.ts:23-25`, `adapter.ts:77`). Still open for 10d. |
| A2 | Missing home or `auth.json` on Windows | fixed | `codex-app-server-lane-auth.ts:30-33` maps `ENOENT` and `ENOTDIR` to `missing`. Other read errors stay `unreadable`. `'code' in error` narrows to `unknown`, and the `===` compare compiles under strict. |

### New defects

1. **minor — the catalog cache is no longer keyed by the binary.**
   `codex-app-server-lane.adapter.ts:121,154,164`. `binaryPath` is written but never compared. A
   fresh entry is served without a check of the current binary. After a Codex update inside the
   30 s window, the old binary's catalog shows. The legacy cache is binary-keyed (parity row
   "30 s binary-keyed cache"). The impact is small because `runSdk` verifies the binary again before
   any spawn. Fix: remove the dead field, or accept the 30 s window and say so in a comment. Do not
   resolve the binary before the cache check, because that undoes defect 4.

2. **minor — a close failure discards a successful catalog.**
   `codex-app-server-lane-catalog.ts:26-30`. When `listModels()` succeeds and `close()` then
   rejects, the `finally` rethrows the close error. The adapter then shows the curated fallback
   (`adapter.ts:168-173`), and the warning names the close error class, not a close failure. Fix:
   in the `finally`, catch the close error, log it as a close failure, and keep the listed models.

3. **minor — a close failure of a late context is not logged.**
   `codex-app-server-lane-catalog.ts:22-24`. After the timeout, `await closeOnce(opened)` can
   reject. The race has already settled, so the error goes nowhere. `runSdk` logs the same case
   (`adapter.ts:281-284`). Fix: `await closeOnce(opened).catch((error) => logger.warn(...))` before
   the `throw`.

4. **minor — the memo trusts size and mtime, and one spec depends on mtime resolution.**
   `codex-app-server-lane-binary.ts:51-54`. A rewrite that keeps the size and the mtime (same
   mtime tick, or a reset with `utimes`) skips the hash. This is the tradeoff that defect 4 asked
   for. It is acceptable only while the runtime spawn check stays the final gate, so state that in
   the class comment at line 21. In the spec "validates an explicit path ... before spawn"
   (`codex-app-server-lane-binary.spec.ts:76-83`), `'fixture'` and `'changed'` are both 7 bytes,
   and no `utimes` call follows the rewrite. On a file system with a coarse mtime (FAT, HFS+), the
   memo can hit and the expected `pin mismatch` does not occur. Fix: set a different mtime with
   `utimes` after the rewrite, as the next spec case does, or write content with another size.

### Spec quality (revision 1)

- Each fake-timer case restores real timers in `finally` and asserts `jest.getTimerCount() === 0`.
  The `Date.now` spies are restored in `finally`. No `any`, `as unknown as`, `@ts-ignore` or
  `eslint-disable` was added. The credential mock now has the explicit
  `Promise<CodexLaneCredentialStatus>` return type.
- The late-close case uses two `await Promise.resolve()` steps after `resolveLate`. That is enough
  for one native `await` plus a synchronous `close()` call, but it is order-sensitive. It is not a
  defect.

### Five logic questions (revision 1)

1. Silent failure: a close error after a good list shows the fallback (new defect 2). A late close
   error is not logged (new defect 3).
2. User action with unexpected behavior: none new.
3. Input that gives a wrong answer: a binary update inside 30 s shows the old catalog (new
   defect 1).
4. Dependency failure: a hung start or list now gives the fallback after 8 s, and the context
   closes. The App Server process has its own initialize timeout
   (`codex-app-server-process.ts:552-572`), so a hung start is bounded at the process level too.
5. Missing from requirements: the catalog account home (defect 9, 10d).

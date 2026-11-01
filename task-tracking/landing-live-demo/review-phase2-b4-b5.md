# Review: Phase 2 B4 (replay recorder) + B5 (scenario sanitizer)

Reviewer: independent, read-only. Scope: `apps/ptah-electron/src/replay/**`, `apps/ptah-electron/scripts/sanitize-replay-scenario.mjs`, diff of `ipc-bridge.ts` and `esbuild.config.cjs` against main. Nothing was built or run; the verdicts below are from reading the code, plus one `require('jiti')` shape check.

## Verdict: APPROVE WITH CHANGES

The recorder is well gated and the bridge taps are placed correctly. The sanitizer has the right structure: allow-lists fail closed, there is a final scan, and output is deterministic. But its privacy rules are a **weaker subset** of the B2 contract scanner, and its final assertion uses that weaker subset. Fix M1 and M2 before any real capture is published.

## 1. Ship gate

OK:
- `esbuild.config.cjs:71` sets `false` when `NODE_ENV=production`.
- The constant is declared in `replay-define.d.ts:6`.
- Jest gets a `false` default through the `globalThis` shim in `replay-recorder.ts:11-13`.
- All 7 uses in `ipc-bridge.ts` are guarded by `__PTAH_REPLAY_RECORDER__ &&` (lines 187, 232, 350, 360, 482, 505, 809).
- No stray references exist elsewhere.
- Runtime gate (`replay-recorder.ts:300-353`): define, `!isPackaged`, `NODE_ENV==='development'`, `PTAH_REPLAY_RECORD==='1'` and a valid absolute out path are all required, with early `null` returns. Path validation (`:134-158`) rejects relative paths, `..`, and any `dist` or `public` segment.
- Cost when disabled: one null check on the hot path. There is no allocation, try/catch or cloning. In the stream flush path, `singleMessage` and `batchMessage` are new locals, but the objects were already allocated for `send`.

**M1 (major) — the build constant fails open.** `isProd ? 'false' : 'true'` makes the recorder code live in any build whose `NODE_ENV` is not exactly `production`. Examples are a local-production or packaging run without `NODE_ENV` set, or an Nx configuration named something else. `!app.isPackaged` still protects the shipped app. But the "stripped from release" claim then rests on one environment variable.
Fix: invert the default, e.g. `process.env.NODE_ENV === 'development' ? 'true' : 'false'`. Also add a post-build assertion that `dist/**/main*.js` does not contain `PTAH_REPLAY_RECORD`. `scripts/validate-deps.js` is a natural place, since the pre-push hook already runs it.

**M2 (minor) — tree-shaking is unverified.** `ipc-bridge.ts` imports `replay-recorder` unconditionally, and the module has a top-level side-effect `if` (`:11`). It should fold to nothing, because `typeof false` is a constant. Nobody has checked that. The grep gate in M1 covers it.

**M3 (minor) — Jest relies on an import side effect.** The constant is defined only if `replay-recorder` is imported first. Any spec or module that uses the identifier without importing it gets a `ReferenceError`. Put the default in `jest.setup.ts` (`globals`) or in the Jest config `globals` too.

## 2. Tap correctness (`ipc-bridge.ts`)

OK:
- The request tap (`:482`) sits after the sender and display-window checks and before `handleMessage`.
- The response tap (`:505`) sits after `flushStreamQueue()` and the `send`, so ordering is preserved. The timeline sees stream pushes before the response, and `rpc:response` never enters the timeline (`recordPush` filters it, including inside a batch).
- Pushes are recorded after `send` in `sendToRenderer` and in the flush's single and batch branches. The batch envelope is kept as is.
- Correlation is by `correlationId`.

**B1 (major) — recorder exceptions can change bridge behaviour.**
- `ipc-bridge.ts:505` runs inside the RPC `try`. If `recordRpcResult` throws after the response has been sent, the outer `catch` (`:507+`) sends a **second** `rpc:response` with `Internal error`. `cloneJson` swallows most failures, but `stableSerialize` (`replay-recorder.ts:90`) does not guard against cycles or getters. `cloneJson` returns the original object on failure, and a cyclic object would then overflow the stack in `stableSerialize`.
- `ipc-bridge.ts:809`: `dispose()` calls `recorder.flush()` unguarded. A disk error (full disk, permission, the out dir removed) throws before `ipcMain.removeAllListeners(...)` runs, so listeners leak and the bridge is half-disposed.
Fix: make every public `record*` method catch internally and `console.warn`. Wrap the `dispose()` flush in try/catch. Alternatively, wrap each tap site.

**m1 (minor)** — `pendingCalls` entries leak if `handleMessage` throws, because the catch path never calls `recordRpcResult`. They are keyed by correlation id, so the growth is slow. Delete the entry in the bridge catch, or cap the map.

## 3. Recorder

**R1 (major) — non-atomic write plus O(n²) flush.**
- Default `writeFile` (`replay-recorder.ts:198-202`) is a direct `writeFileSync`. A crash, `kill -9` or power loss mid-write leaves truncated JSON, which is the very capture the user wanted. Fix: write to `${file}.tmp`, then `renameSync`.
- Every 250 ms during streaming, `flush()` calls `getSnapshot()`. That deep-clones the whole timeline (`cloneJson(this.timeline)`) and then `JSON.stringify(..., null, 2)` on the Electron **main thread**. Cost grows with session length. This is dev-only, but a long capture will visibly stutter the app and skew the recorded `at` values. Fix: skip the clone in `flush()` (serialize directly), drop the indentation, and use a longer debounce (e.g. 2 s). Better, append NDJSON and assemble the final JSON on quit.
- The timeline is never bounded. Add a soft cap and a warning.

OK:
- `rpcCases` is emitted only when a method has at least 2 distinct param keys with at least 2 distinct data payloads (`:340+`). `rpc[method]` keeps the first observation, or the latest when only one param set was seen. Errors go to `rpcErrors`, with the message normalized by `formatRpcError`.
- Flush on `will-quit` and on `dispose` is present.

**m2 (minor)** — a method can appear in both `rpc` and `rpcErrors`, e.g. success first and then failure. The scenario consumer must define a precedence; check the B2 player. The `will-quit` listener is registered per factory call and never removed (a single instance in practice).

**m3 (minor)** — the raw capture contains secrets, paths and PII by design. Add a header note and a `.gitignore` entry for the capture location. The out-path rule does not stop `PTAH_REPLAY_RECORD_OUT` from pointing inside the repo, e.g. under `task-tracking/`.

## 4. Sanitizer

OK:
- Fail-closed RPC and push allow-lists, with a `strict` mode and `rpc:response` always dropped.
- Credential-named keys are dropped (`:1041-1051`) and object keys are themselves sanitized.
- Placeholders for tool_result, diff and file content unless allow-listed, with the allow-list matched on the sanitized path.
- Deterministic UUID remap with one global map, so the `tabId` / `sessionId` consistency holds across rpc, rpcCases, timeline and bootMessages.
- Timestamp shift against `timeBase`.
- A final `scanScenarioPrivacy` with a throw.
- Idempotency looks right in principle, and a test exists (`scenario-sanitizer.spec.ts:440`).

**S1 (major) — the privacy scan is not the B2 scan.** `scenario-sanitizer.ts:346-380` claims to mirror `libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts`. It omits several B2 rules, so the final assertion gives false assurance. A scenario can pass here and fail the B2 loader scan, or leak:
- Home paths: B2 `home` (`:11`) also matches `~/`, `/root`, `/var/folders/`, `C:/Users/`. The sanitizer's `HOME_TEST_RE` matches only `/home/`, `/Users/` and `C:\Users\`. A string like `~/.ssh/id_rsa` passes untouched.
- Secret shapes: B2 `secretShape` (`:19`) covers `glpat-`, `sk-proj-`, `AIza`, `npm_`, `hf_`, `ASIA`, `github_pat_`. The sanitizer's test regex covers only `sk-|ghp_|AKIA|xox..`. Replace patterns cover a few more, but the **scan** does not.
- `credentialAssignment` (B2 `:20`: `password=…`, `"token":"…"` inside strings) has no counterpart in the scan. `redactSecrets` helps on replacement, but the scan cannot catch a miss.
- The hostname rule is a fixed TLD list (`:358-359`: com|net|org|io|dev|live|app|co|ai|xyz|edu|gov). B2 matches any `[a-z]{2,}` TLD. `db.corp`, `host.internal`, `x.local`, `repo.sh`, `foo.cloud`, `a.me` survive in both replace and scan.
- Absolute-path prefix characters: B2 also allows `,{>[` before a `/`, and `C:/…` with forward slashes. The sanitizer uses `[\s"'=:(]` only, so `["/etc/x"]`-style cases are missed after `,`, `{`, `>`.
Fix: import the rule set from one shared module. B2 is `scope:web`, so move the regexes into `libs/shared` or a tiny dependency-free file used by both. Failing that, copy B2's regex list verbatim and add a parity spec that runs the same canary corpus through both scanners.

**S2 (major) — escaped and encoded bypasses.**
- Nested JSON strings: a Windows path inside a JSON-encoded string appears as `C:\\Users\\bob`. `HOME_TEST_RE` and the preScan username regex expect single backslashes, so neither matches. Neither does `ABSOLUTE_PATH_GLOBAL_RE`'s `[A-Z]:\\[^\s"']+`: its `\\` in the pattern matches a single backslash and then needs a non-quote run, so it may match, but the username scrub in preScan will not run. Result: username leaks. Also, a nested JSON string is never parsed, so structural rules (credential key names, `tabId`) do not apply inside it.
- URL-encoded values (`%2Fhome%2Fbob`, `sk%2Dant…`, `%40` emails) are neither decoded nor flagged.
- Base64 or hex shorter than 201 chars is allowed through, including base64 of a path or email.
Fix: add a "decode-then-scan" pass for scan purposes only: `decodeURIComponent` and try `JSON.parse` on strings that start with `{` or `[`, and handle `\\\\` unescaping. Fail closed on any hit. Tighten the base64 threshold, e.g. to 40 chars, for alphabet-only tokens with no spaces.

**S3 (major) — free text is only regex-scrubbed.**
- Tool-result placeholders apply only when `eventType==='tool_result'` and the field is a **string** named `output|result|content` (`:1079-1090`). If `content` is an array of blocks (the normal shape for SDK tool results) or an object, it falls through to the generic regex scrub. Source code, file listings and command output then reach the scenario.
- The same applies to `thinking`, assistant `text`, and `toolInput.command` (shell commands containing arbitrary data). The plan may accept prose for chat text, but tool results should fail closed.
Fix: for `tool_result`, replace any non-allow-listed `output|result|content|stdout|stderr` regardless of type with the placeholder, and recurse into `content[]` text blocks.

**S4 (minor)**
- `redactedFields` (and the CLI's stdout report) record the **raw** key path (`:1046`). A secret used as an object key therefore prints to the terminal. Sanitize the path before recording.
- Two keys that sanitize to the same string silently overwrite each other (`result[sanitizedKey]`).
- IPv4 replacement turns version strings (`1.2.3.4`) into `ptah.live`.
- Numeric timestamps are clamped to 0–24 h offset while ISO strings are only shifted (`:960-985`). The behaviour is inconsistent, and string-encoded epoch values are untouched.
- Any number in 1e12–3e12 (large byte counts) is treated as a timestamp.
- The UUID remap uses first-seen order. A raw UUID that happens to equal an already-assigned fake one would be merged, but this is only theoretical.

## 5. CLI (`sanitize-replay-scenario.mjs`)

OK:
- It runs without a build. `require('jiti')` returns a function with `createJiti` (checked, jiti 2.6.1), and the sanitizer's import is only `../services/diagnostics/log-redaction`, which is dependency-free. Output is written only after success.
- Required args are validated; unknown args throw; `--help` exits 0.

Findings:
- **C1 (minor)**: `--in` equal to `--out` overwrites the raw capture. Refuse that, and refuse an out path that resolves under `dist/` or `public/` (reuse `isValidReplayOutputPath`-style logic).
- **C2 (minor)**: no top-level try/catch. Failures surface as an uncaught stack (exit 1), which is acceptable. But `JSON.parse` errors and the privacy-scan message can echo raw input and paths. Print `error.message` only, and exit 1 explicitly. The scan summary prints paths (sanitized), not values, which is good.
- **C3 (minor)**: `--allow-file` allows any path with no check that it is relative. Warn when the pattern is absolute.
- **C4 (minor)**: the write is not atomic. Use temp-then-rename here too.

## 6. Tests

Covered (by title): the 5-way gate and path validation, rpc/rpcCases/rpcErrors, rpc:response exclusion, batch and order through a real `IpcBridge`, flush on dispose, allow-list drift against the shared `RPC_METHOD_NAMES`, the strict mode, the canary scrub, idempotency/determinism, and the CLI.

Gaps:
- **T1**: no test for B1 failure isolation: the writer throwing in `dispose()`, or a cyclic payload.
- **T2**: no test for the atomic write or for the debounced flush timing under load.
- **T3**: no canaries for the S1/S2 cases above: `~/`, `/root/`, `glpat-`, `AIza`, `hf_`, a `.internal` host, `C:\\Users\\` in a nested JSON string, `%2F`-encoded paths, secrets in object keys, `password=` in free text, array-shaped tool_result content.
- **T4**: no parity spec between the sanitizer scan and the B2 `privacy-scan.ts` over a shared corpus. This is the test that would have caught S1.
- **T5**: no test that a production-like define produces no recorder: run esbuild with `NODE_ENV=production` over `ipc-bridge.ts` and assert the bundle has no `PTAH_REPLAY_RECORD`.

## Fix order
1. B1, S1, S2, S3, M1 (before any real capture is published).
2. R1, T1, T3, T4, T5.
3. The rest.

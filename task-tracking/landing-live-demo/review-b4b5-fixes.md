# Review: B4/B5 fixes (Electron replay recorder and sanitizer)

Scope: `git diff main...HEAD -- apps/ptah-electron/`. Read in full: `replay-recorder.ts`, the `ipc-bridge.ts` tap lines, `esbuild.config.cjs`, `validate-deps.js`, `sanitize-replay-scenario.mjs`, and the privacy-scan, decode and final-scan parts of `scenario-sanitizer.ts`. I did not read the spec files line by line. No builds, tests, nx or verify were run. I ran the CLI on `/tmp` copies and a few ad-hoc leak probes through jiti (`/tmp/rv/*.cjs`). No source files were edited.

## Verdict

**REVISE.** The recorder fixes (M1, B1, R1) are real and correct. The sanitizer fixes (S1, S2, S3) are real but incomplete. The sanitizer has a credential leak that the final fail-closed scan also misses (F1). That leak must be fixed before real captures are published to the landing page. The recorder cannot be active in a production build.

| Severity | Count |
| --- | --- |
| Blocker | 0 |
| Major | 2 (F1, F2) |
| Minor | 7 |

## 1. Claimed fixes

| Fix | Real? | Evidence |
| --- | --- | --- |
| M1 define defaults to `false` | Yes | `esbuild.config.cjs:71-76`. It is `'true'` only when `!isProd && NODE_ENV==='development' && PTAH_REPLAY_RECORDER_BUILD==='1'`. Any unset or other value gives `'false'`, so it fails closed. |
| M1 production-bundle check | Yes, with a small false-positive risk (F7) | `validate-deps.js:99-118` fails on any of the 4 markers in `main.mjs`. Whether tree-shaking removes the recorder is unverified here (no build run). The spec reportedly runs `esbuild.build` to check. |
| B1 failure isolation | Yes | See section 2. |
| R1 atomic and incremental writes | Yes, with caveats (F5) | `replay-recorder.ts:106-112` writes `.tmp` then `renameSync`. Debounce is 2000 ms. Timeline entries are stringified once in `recordPush` (~l.484) and joined at flush. |
| S1 scan parity | Mostly | Regexes at `scenario-sanitizer.ts:351-404` match B2 `privacy-scan.ts` (credentialField, secretShape, credentialAssignment). The sanitizer also adds `sk_`-less prefixes only. It therefore inherits B2's gaps (F1). |
| S2 decode-before-scan | Yes | Nested JSON, URL-decoding, backslash-unescape and base64 are bounded by `MAX_DECODE_DEPTH=4` (l.406, ~l.640-700). The base64-encoded home path was redacted in my probe. Other escapes are not decoded (F6). |
| S3 array/object placeholders | Yes | The `[{type:'text'}]` and object forms are replaced with placeholders. For `chat-tool-call` the tool output became `[sanitized tool output]` without `--allow-file`. |
| CLI `--in === --out` guard, atomic write | Yes | `sanitize-replay-scenario.mjs:96-107, 52-57`. |

## 2. Recorder: production safety and failure isolation

- **Never active in production:** four independent layers back this up.
  - The esbuild define is false for production, unset or unknown `NODE_ENV`.
  - `createReplayRecorderIfEnabled` also checks `!app.isPackaged`, runtime `NODE_ENV==='development'`, `PTAH_REPLAY_RECORD==='1'` and a valid absolute output path outside `dist`/`public`/`..` (`replay-recorder.ts:271-325`).
  - Every tap in `ipc-bridge.ts` is guarded by `__PTAH_REPLAY_RECORDER__ && this.recorder`.
  - `validate-deps` fails the push if the markers survive.
  - A caller can pass an explicit `recorder` to the `IpcBridge` constructor and skip the factory gates (`ipc-bridge.ts:176-190`). The taps are still stripped when the define is false, so this is harmless in production.
- **Never breaks IPC:**
  - Every tap goes through `tapReplayRecorder` (try/catch plus a permanent disable).
  - Every recorder method runs in `runSafely`.
  - `flush` catches write errors.
  - `dispose()` calls `flush` through `tapReplayRecorder` before `removeAllListeners` (`ipc-bridge.ts:811-816`).
  - The RPC result tap runs after `send('rpc:response')`, so a failing tap cannot cause a duplicate response.
  - The call tap runs before `handleMessage`, but `tapReplayRecorder` never throws.
  - The factory's own construction is wrapped in try/catch and returns null.

## 3. Findings

### F1 (MAJOR): `*_PASSWORD=`, `*_SECRET=` and `sk_live_` credentials survive sanitization and the final scan

Evidence: `scenario-sanitizer.ts:392` and `:390`, mirroring `libs/web/landing/.../privacy-scan.ts:19-20`.

- `CREDENTIAL_ASSIGNMENT_GLOBAL_RE` starts with `\b(?:password|secret|token|...)`. `\b` does not match after `_`, so `DB_PASSWORD=`, `MY_SECRET=` and `AWS_SECRET_ACCESS_KEY=` are not matched.
- `SECRET_SHAPE_TEST_RE` has no `sk_live_` or `rk_live_` prefixes.
- The probes below ran through `sanitizeScenario` as `chat:chunk` text deltas, and `scanScenarioPrivacy` returned `[]` for the same strings:
  - `DB_PASSWORD=hunter2hunter2` is emitted unchanged.
  - `export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG` is unchanged.
  - `stripe_key = "rk_live_abcdefgh12345678"` is unchanged.
  - `sk_live_abcdefghijklmnopqr` is unchanged.
- Impact: chat text and non-allow-listed free text are kept. A dev who runs `cat .env` and has the assistant echo it would publish live secrets to the landing page. The "fail-closed" final scan gives false assurance.

Fix: in both `scenario-sanitizer.ts` and B2's `privacy-scan.ts` (keep parity):

- Replace the leading `\b` in the assignment regex with `(?<![A-Za-z0-9])` and drop the trailing `\b`. Use a suffix-tolerant form such as `[A-Za-z0-9_]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_]*["']?\s*[=:]`.
- Add `(?:sk|pk|rk)_(?:live|test)_` to the secret-shape prefix list.
- Add the canaries above to the shared S1 canary list in both specs.

### F2 (MAJOR): the sanitizer is not idempotent on committed scenarios, and `--strict` is not a check mode

I ran `node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs --strict --in X --out Y --id <id>` on `/tmp` copies of the five `libs/web/landing/src/lib/live-demo/scenarios/*.json`. All 5 succeeded and the final privacy scan passed (no throw), but only 3 are byte-identical:

| Scenario | Result |
| --- | --- |
| `command-center` | unchanged |
| `multi-agent` | unchanged |
| `tribunal-council` | unchanged |
| `orchestration` | **changed**: the sanitizer silently drops the top-level `start` field (`{mode:'on-send',prompt}`), which the scenario contract requires (`replay-scenario.types.ts:98`). The sanitizer never copies `start` into its output (final `scenario` object, `scenario-sanitizer.ts:~1944-1962`). |
| `chat-tool-call` | **changed**: the source lacks `id`, `title`, `config` and `bootMessages`, which the sanitizer adds. Unicode `’` is re-encoded as a literal character. `tool_result.output` becomes `[sanitized tool output]` because no `--allow-file` was passed, and an element at old line ~422 is dropped. |

- `--strict` only throws on disallowed RPC/push types (l.1666, 1727, 1781, 1838). It does not validate or compare. No check-only mode exists.
- Impact: an author who re-runs the sanitizer on an already-reviewed scenario silently loses `start` (the on-send demo then stops working), and the tool-output change is silent.

Fix:

- Copy `start` through `sanitizeValue` (validate `mode` in `{'auto','on-send'}`, scan `prompt`) into the output in `sanitizeScenario`.
- Add a `--check` flag to the CLI. It sanitizes in memory, compares the result to the input with `JSON.stringify`, exits non-zero on a diff or scan finding, and writes nothing.
- Add a spec that runs `sanitizeScenario` over each committed scenario with `allowFiles` set, and expects deep equality.

### F3 (minor): home-path project directory names are kept

`/home/jdoe/projects/secret-app/src/a.ts` becomes `/workspace/acme-app/secret-app/src/a.ts`. The real project directory name survives when it is not covered by `config.workspaceRoot` or `wsInfo`. The username is removed. Fix: when a home-path prefix is replaced, also drop the first one or two segments after it, or require `--workspace-path` and fail if no root is known.

### F4 (minor): other host, user and name leaks pass

- UNC path `\\fileserver\share\docs\a.txt` is emitted unchanged (host leak).
- Git remote `git@github.com:jdoe/private-repo.git` becomes `demo@example.invalid:jdoe/private-repo.git`, so the user and repo name remain.
- A `Jane Doe` name outside an email context is kept (this is inherent to a free-text scrubber; document it).

Fix: add UNC detection `\\\\[^\\\s]+\\` to the path rule and the scan. Handle `scp`-style `user@host:owner/repo`.

### F5 (minor): recorder cost and robustness

- `flush()` (`replay-recorder.ts:~540-560`) calls `serializedTimeline.join('')` only to test truthiness, then joins again. It also does `this.timeline.slice()` and stringifies the `rpc` and `rpcCases` headers on every flush. Use `this.serializedTimeline.join(',')` once, and return no snapshot from the timer path.
- The timeline keeps both the parsed entry and the string for each push. Drop `this.timeline` and keep only the strings, plus a count.
- The `setTimeout` flush timer is not `unref()`'d. Add `.unref?.()`.
- The raw capture contains unsanitized RPC data, including settings and keys. `writeFileSync` uses the default mode. Pass `{ mode: 0o600 }` and log a warning that the output is raw.
- Stuck-write edge: a fixed `${file}.tmp` can be left behind if `rename` fails, and a concurrent second Electron instance would collide. Use `${file}.${process.pid}.tmp`.

### F6 (minor): escapes that are not decoded

`/home/jdoe` and `\x2fhome\x2fjdoe` (literal backslash sequences) pass unchanged. JSON strings already decode `\uXXXX`, so this only applies to double-escaped text. Zero-width characters inside paths, such as `/ho​me/jdoe/x`, also pass. Fix: strip `​-‏﻿` before scanning, and add `\\u00XX` and `\\xXX` unescaping to `unescapeBackslashes`.

### F7 (minor): the `validate-deps` marker `ReplayRecorder` can false-positive

`validate-deps.js:100-105` greps the whole bundle for the bare substring `ReplayRecorder`. A bundled dependency that contains it would block every push with a misleading message. Impact is low and the check is fail-safe. Fix: keep it, but print which marker matched with ~60 characters of context.

### F8 (minor): timeline cap is silent to the sanitizer

At 10,000 entries the recorder drops further pushes and warns once (`replay-recorder.ts:~436`). The output file looks like a normal, shorter capture. Fix: write a `"truncated": true` field into the capture header.

## 4. Five logic questions

- **Silent failure:** F1 (the final scan reports clean while secrets remain), F2 (`start` dropped), F8 (cap truncation).
- **User action:** re-running the sanitizer on a committed scenario (F2). Running with `--strict` expecting validation.
- **Input that gives a wrong answer:** `*_PASSWORD=` env lines, `sk_live_` keys, UNC paths, scp-style git remotes.
- **Dependency failure:** disk full or rename failure disables the recorder permanently after one warning. This is acceptable for a dev tool, and IPC is unaffected.
- **Missing:** a check-only CLI mode, and a round-trip spec over the committed scenarios.

## 5. Not verified

- The production-bundle check was not run (no builds allowed); I relied on reading `esbuild.config.cjs`, `validate-deps.js` and the spec's reported behaviour.
- I read the sanitizer's scan and decode paths and exercised them with about 45 probes. I did not read every `sanitizeValue` branch.

# Code logic review — TASK_2026_714_c8a2 batch 1b

Scope: uncommitted diff in `libs/backend/codex-runtime/tools/evidence-harness.ts` and `evidence-harness.spec.ts` (working tree vs HEAD), plus the realm-safe `errorCode()` helper committed in `f9e7fbfc6` and its uses in `missing()` and `killTreeSync`. Both files were read in full. Jest, nx, tsc, the codex binary, and git writes were not run. No `code-style-review.md` findings are repeated here.

Reviewed behaviour: app-server notifications may carry optional integer `emittedAtMs`; `.strict()` stays; case notes may contain only allowlisted harness messages, known error names, and rejected top-level key names; the first failure is the one recorded.

## Five logic questions

1. **Silent success.** Unknown top-level keys still throw inside `FrameDecoder.push` (`evidence-harness.ts:126-130`) and `RpcChild` marks the case failed (`:339-342`). A success-looking note is produced when `receive()` throws for a parsed frame: the stdout `catch` discards that error and records `invalid or oversized protocol frame` (`:339-340`, `:351-352`). An event-cap stop or a throwing notification handler is stored as a protocol-frame failure. `killTreeSync` returns without throwing when `String(error.code) === 'ESRCH'` (`:279`, `:284`), including when `code` is not a string errno.

2. **User action.** A second stdout chunk after the first rejected frame appends another `Rejected frame keys:` line. `stopSync` (`:416-419`) does not remove the `data` listener, and the key push (`:341`) ignores `this.failure`. Normal `stopSync` then `close` leaves notes empty (`spec:69-76`), because `ending` is set before `fail('child stopped')` (`:418-419`, `:351-352`).

3. **Wrong answer from input.** `emittedAtMs` must be an integer `>= 0` (`:20`). `-1`, `1.5`, and a numeric string fail `safeParse` and throw (`spec:34-36`). A non-integer is not stored. A top-level key that matches `/^[A-Za-z0-9_./:-]+$/` is copied into notes with no length cap (`:128-129`, `:341`). That charset admits `CODEX_HOME`, `auth.json`, and temp paths. `sanitize` (`:143-155`) does not strip those when the artifact is written (`:830-847`). The markdown table omits notes (`:848-849`); the JSON artifact keeps them.

4. **Bad dependency result.** `JSON.parse` and Zod failures are replaced with a fixed `Error` (`:125-130`). Zod issue text, which echoes input, is dropped. `stderr` is resumed and never read (`:333`). `recordCaseFailure` (`:102-108`) keeps a message only on exact allowlist membership; any other message becomes `unclassified error (<name>)`, and a name outside `errorNames` becomes `Error`. `String(error.code)` (`:175`) accepts a non-string `code`. `missing()` (`:177-178`) and the ESRCH checks then treat that coercion as an errno.

5. **Unspecified requirement.** The new tests do not cover a regex-legal secret key, a second bad chunk, `frame too large`, inbound `event limit reached`, stderr bytes, or the sanitized JSON artifact. `errorCode` has no direct spec; the symlink test only reads `EPERM` / `EACCES` / `ENOTSUP` (`spec:262-266`).

## Findings

### S1 — Serious — stdout `catch` records a substitute error and hides the first failure

`evidence-harness.ts:336-342` catches every failure from `push()` and `receive()`, then calls `fail(new Error('invalid or oversized protocol frame'))`. `fail` (`:351-352`) records that substitute when it is the first failure.

`push` throws `frame too large` at `:121` and `:136` before any key list is set. `receive` throws `event limit reached` at `:348-349` after a successful parse, and calls `onNotification` synchronously at `:373`. Those errors are allowlisted (`:48`, `:67`) and would have been stored verbatim by `recordCaseFailure`. The `catch` never passes them through. `rejectedFrameKeys` stays empty on these paths (`:117`), so the note is only the protocol-frame line.

`assertHealthy` (`:357`) later throws the substitute. `runHarness` (`:816-818`) records it again; dedupe keeps a single wrong line. The case stops. The evidence says the wire frame was invalid.

The new spec (`spec:42-57`) sends one schema-invalid frame, so the substitute text matches the real failure. It does not prove this ordering.

### S2 — Serious — rejected key names copy unsanitized frame bytes into notes and the JSON artifact

`evidence-harness.ts:128-129` keeps up to 10 own keys matching `/^[A-Za-z0-9_./:-]+$/`, with no per-key length cap (a frame may be `MAX_FRAME_BYTES`, `:13`). `:341` appends them with `notes.push`, outside `recordCaseFailure`.

Frame values and Zod messages are not copied. A key is still frame content. `auth.json`, `CODEX_HOME`, and `tmp/codex-home/auth.json` match the regex. `sanitize` (`:147-155`) redacts bearer tokens, `sk-` keys, JWTs, and 48+ character runs of `[A-Za-z0-9_+/=-]`. It does not redact paths, `CODEX_HOME`, or `auth.json`. `runHarness` writes `results` through that sanitizer (`:830-847`), so those key names reach the JSON artifact. Notes are the same strings.

`spec:42-53` puts `private` in values and in the spaced key `bad key`, then asserts `notes` lack `private` and `bad key`. `foo` and `key0` are expected in the note. A regex-legal key such as `CODEX_HOME` or `tmp/auth.json` would be recorded and the assertions would still pass. The spec does not prove check (b) for key names, stderr, or artifacts. Stderr isolation holds in code at `:333`, and this spec never writes stderr.

### M1 — Moderate — key-line append can double-record

`fail` records only the first error and only when `!this.ending` (`:351-353`). The key line at `:341` runs on every rejected chunk, with no `includes` check. `recordCaseFailure` dedupes equal notes (`:108`); the key push does not. A second `data` event before the child stops adds a second `Rejected frame keys:` line. `spec:42-57` writes one chunk and does not prove check (c) for this path.

Identical `recordCaseFailure` calls do dedupe (`spec:59-66`). `stopSync` before `close` does not record `child stopped` (`spec:69-76`, implementation `:416-419`). Those two cases hold.

### M2 — Moderate — `errorCode()` can treat a non-fs `code` as `ENOENT` or `ESRCH`

```174:178:libs/backend/codex-runtime/tools/evidence-harness.ts
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}
function missing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}
```

Committed in `f9e7fbfc6`. The helper avoids `instanceof`, so a cross-realm Node `SystemError` whose `code` is the string `ENOENT` or `ESRCH` is classified correctly. A string `EPERM`, `EACCES`, `ENOTDIR`, or `EINVAL` does not match, so `canonical` (`:183-185`), `markerExists` (`:217`), and both `killTreeSync` catches (`:279`, `:284`) rethrow that error.

`String(error.code)` does not require a string. `String(['ENOENT']) === 'ENOENT'` and `String(['ESRCH']) === 'ESRCH'`. An object with a `toString` that returns those errnos matches too. `'code' in error` is also true for an inherited `code`. On that input:

- `markerExists` returns `false` (`:217`) and reports the marker absent.
- `canonical` walks to the parent (`:184`) and can miss or shift an overlap check.
- `killTreeSync` returns (`:279`, `:284`) as if the process were already gone, then cleanup deletes `auth.json` while the child can still be alive.

Real `fs` and `process.kill` errors use a string `code`, so this does not reclassify a normal `EPERM`. There is no direct test that a non-string `code` stays unclassified. The symlink spec only uses `errorCode` to skip `EPERM` / `EACCES` / `ENOTSUP` (`spec:262`).

## Checks that hold

- Header adds optional `emittedAtMs: z.number().int().nonnegative()` and every envelope keeps `.strict()` (`:20-24`). `spec:27-40` accepts the `remoteControl/status/changed` notification and rejects `foo` plus invalid timestamps.
- Schema failure throws a fixed error (`:130`). The RPC test expects that message (`spec:49-51`). Values in that fixture are absent from notes.
- Allowlist is exact. A path or `private-auth` message, a hostile `name`, and a string stderr-like value become `unclassified error (Error)` or `unclassified error (TypeError)` (`:102-108`, `spec:59-66`).
- First `fail` wins over a later `child stopped` when `failure` is already set (`:351-353`, `spec:54-56`).

## Decisions

- Key names are an allowed category in the task, and they still have to satisfy check (b). Recording path-capable, unbounded keys is a defect. Reversible by capping length and rejecting keys that are not short protocol identifiers. Evidence: `:128-129`, `:341`, `:143-155`, task checks (b).
- `errorCode` stays acceptable for real string errnos. The missing `typeof code === 'string'` guard is still a defect because the review question was whether a non-fs code can be swallowed. Evidence: `:175`, `:279`.

## Verdict

**REVISE.** Score **6/10**.

Unknown keys still fail closed, and frame values, Zod text, and raw stderr are not what `recordCaseFailure` stores. That is why this is not a 3-4. Two serious evidence-integrity holes are present: the stdout catch persists the wrong reason, and rejected key names can carry paths and auth-shaped tokens into notes and the JSON artifact. The new specs do not catch either hole. A 7 would need those paths closed and asserted.

Counts: 0 blocking, 2 serious, 2 moderate. Failure modes: substitute inbound error; unsanitized key in the artifact; second key line; non-string `code` aliased to `ENOENT`/`ESRCH`.

## Fix re-check

Diff re-read: `git diff -- libs/backend/codex-runtime/tools/evidence-harness.ts evidence-harness.spec.ts`. Jest was not re-run. The orchestrator reported scoped Jest 38/38 and `nx` typecheck `codex-runtime` pass.

### S1 — CLOSED

The stdout `catch` reads `error.message` and passes it to `fail()` only when `failureMessages.has(message)`. Any other message becomes `invalid or oversized protocol frame`. `frame too large` and `event limit reached` are in that set, so those throws are recorded as themselves. The spec writes `MAX_FRAME_BYTES + 1` bytes with no newline, then expects `assertHealthy` to throw `frame too large` and `notes` to equal `['frame too large']`. That is the post-loop size check, and it fails if the substitute message returns.

### S2 — CLOSED

Rejected keys must match `/^[a-z][A-Za-z0-9]{0,31}$/` (lowercase start, at most 32 alphanumerics, no `_`, `/`, `.`, or `:`). `CODEX_HOME`, `tmp/auth.json`, and a 40-character key fail that filter. The spec puts all three on the bad frame and asserts notes do not match `/CODEX_HOME|auth\.json|kkkk/`. The expected key line is still `method, params, foo, key0` through `key6`.

### M1 — CLOSED

The key line is pushed only when `rejectedFrameKeys.length` is non-zero and `notes.includes(keys)` is false. The spec writes the same bad frame twice and expects exactly one failure line and one key line.

### M2 — CLOSED

`errorCode()` returns `error.code` only when `typeof error.code === 'string'`. The spec expects `'ENOENT'` for a string code, and `undefined` for `['ESRCH']` and for an object whose `toString` returns `'ENOENT'`. A non-string code no longer reaches `missing()` or the `ESRCH` checks.

## Verdict

**APPROVED.** Score **8/10**.

All four findings are closed in the diff, and each has a spec that fails on the old behaviour. An 9 would need an inbound `event limit reached` spec beside the oversized-frame case; that path uses the same allowlist branch. This re-check did not execute Jest.

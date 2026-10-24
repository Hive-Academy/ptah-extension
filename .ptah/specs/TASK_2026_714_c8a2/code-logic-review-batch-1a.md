# Code logic review — batch 1a evidence harness

Reviewer: Grok CLI
Implementer: Codex CLI
Review family: grok vs codex
Task: TASK_2026_714_c8a2
Scope read in full: `libs/backend/codex-runtime/tools/evidence-harness.ts`, `evidence-harness.spec.ts`, `evidence-cases.json`, `generate-protocol-manifest.mjs`, `src/index.ts`, and `.ptah/specs/TASK_2026_714_c8a2/batch-1a-report.md`. Cross-checked `research-report.md` method table and `evidence-cases.json` levels. Not executed: harness, generator, codex, nx, jest, tsc, lint, build. No source edits.

**Verdict:** APPROVED
**Score:** 3/10 (first round; fix-round score and the execution decision are in `## Fix round re-review`, which supersedes this verdict line's old meaning)

The turn counter, child-env allowlist, dry-run early return, 1 MiB frame cap, and empty production export are implemented and cited below, so this is not a 1–2 foundation failure. Blocking confinement plus serious cleanup and path checks means it must not run with a real `auth.json`. That is why it is not a 5–6.

## Answers

### 1. Turn cap

One `TurnBudget` is created at `evidence-harness.ts:472` and passed into every `runCase` (`:501`). `used` only increases (`:34-41`). Nothing resets it. `claim()` runs synchronously inside `RpcChild.request` before `stdin.write`, and only for `turn/start` and `thread/compact/start` (`:186-198`). A false claim throws `not run: cap` and does not write. A claim that then gets an RPC error, a failed write, or a dead child stays consumed (`:188` before `:197` and `:192`). The spec drives two children through eight failing claims and a ninth refusal (`evidence-harness.spec.ts:21-41`). There is no client retry loop: a non-observed case sets `stop` and later behavioural cases are marked not run (`evidence-harness.ts:500-503`). `thread/resume`, `thread/fork`, and `turn/steer` are never sent. `thread/start` (`:404`) is not charged; research treats it as thread creation, not a turn (`research-report.md:23`). `turn/interrupt` (`:390`) is not charged; research treats it as cancel (`research-report.md:40`).

The counter does not see model inferences inside an already started turn. The wait loop runs until `turn/completed` or 120s (`:414-416`). `approvalPolicy: never` (plan and yolo, `:275-277`) never hits the approval cap of 4 (`:344`). `thread/tokenUsage/updated` is stored (`:381`) and never compared to a budget. Compaction display math (`:491-496`) moves a count between rows and does not refund `budget.consumed`.

### 2. Credential safety

`createExperiment` copies only `auth.json` into `<temp>/home` and chmod 0600 (`:84-91`). It does not copy `config.toml`. `cleanupExperiment` always `rmSync`s `auth.json` and the whole home, including when `keep` is true; `--keep` deletes only the rest of the experiment when false (`:97-103`). The spec checks that call order with a fake disk (`evidence-harness.spec.ts:55-83`). `runHarness`'s `finally` calls that cleanup on success and on thrown case errors (`:505-508`). Artifact construction does not read the auth file. Errors from setup are replaced with a fixed string (`:92-94`). The main failure path writes a fixed stderr line (`:532-534`).

`childEnvironment` is already an allowlist, not a copy of `process.env` (`:105-110`). `OPENAI_API_KEY`, `HTTPS_PROXY`, and the caller's `CODEX_HOME` fail the regex and are then overwritten for `CODEX_HOME` / `HOME` / `USERPROFILE`. The spec freezes a source object and asserts those keys do not survive (`evidence-harness.spec.ts:85-92`). `process.env` is not assigned. It should stay an allowlist. Residual: `PATH` is forwarded verbatim (`:107`) and is not written to `--out`.

Gaps that block a real run are findings 2 and 3: signal handlers are installed after the copy, and nothing proves the temp home is outside the real Codex home.

### 3. Isolation

The harness and the generator never open the user's `config.toml` or `~/.codex`. MCP is an argv `-c` override (`:308-314`), `shell: false` (`:315-317`), and the fixture has no sockets (`:229-251`). Scratch is `join(root, 'scratch')` inside the experiment root (`:86`), a sibling of `workspace` and `home`.

`realpathSync` is used for the binary, the auth source, the artifact collision check, and the server's reported `codexHome` (`:265`, `:396`, `:462-471`). Approved file paths use `resolve` plus `existsSync` (`:345-348`, `:377`). That does not defeat a symlink or junction. There is no comparison of the experiment root to `homedir()/.codex` or to the pre-existing `CODEX_HOME`. The generator has the same temp-home gap (`generate-protocol-manifest.mjs:14-19`).

### 4. Process safety

Windows `stop()` calls `taskkill.exe /PID <pid> /T /F` (`:208-213`). POSIX kills the detached process group (`:214-216`, spawn `detached` at `:317`). Frame length is checked before `JSON.parse` (`:52-55`); the spec covers a split oversized frame (`evidence-harness.spec.ts:109-114`). Zod failures throw inside `FrameDecoder.push` and are caught by the stdout handler, which fails the child with a generic error (`:142-146`). That path does not skip `runCase`'s `finally` → `stop()` (`:437-439`).

`stop()` treats `taskkill` error and close as completion (`:212`) and, after a 5s race, throws `child teardown not confirmed` (`:219-222`). The harness `finally` still deletes the home (`:505-508`) even if the process is alive. A second SIGINT is not handled (finding 2). The spec never spawns `taskkill` or a process group (`fakeChild` has `pid: undefined`, `evidence-harness.spec.ts:13-17`).

### 5. Sanitization

`sanitize` (`:65-78`) redacts caller-supplied secrets longer than 3 characters, `Bearer` tokens, `sk-…`, three-part `eyJ` JWTs, labeled `access_token` / `refresh_token` / `id_token` / `api_key` / `authorization`, 48+ character opaque tokens, and object keys matching auth/secret/token/prompt/stderr. SHA-256 fields are kept. The spec covers that set (`evidence-harness.spec.ts:127-136`).

It does not redact emails, account ids, or unlabeled secrets shorter than 48 characters (`ghp_`, `xoxb-`, session cookies) unless the key name matches. Full prompts, wire params, model text, and stderr are not fields of the artifact (`:509-521`). Stderr is resumed and dropped (`:139`). `outputDelta` is tested for the fixture substring and not stored (`:382-384`). The markdown table is id, status, turns, and a fixed cleanup string (`:524-525`). Those status strings are harness literals, not model text.

### 6. Approval flow

Each server request is held through a 200 ms delay. The marker must be absent before the delay and still absent after it, or the handler throws (`:345-348`). The outcome is checked again after the turn (`:418-429`). `respond` runs only after those checks (`:366`). A method that is not in `manifest.methods.serverRequests`, or is not the one expected method for that case, throws before `respond` (`:341-344`). The default handler also throws (`:135`). Nothing in this file sends `accept` for an unknown method.

Command cases require the exact quoted marker command (`:354-356`). File accepts require one validated change whose `resolve`d path equals the scratch marker (`:357-359`, `:373-378`). MCP requires server `marker`, tool `write_marker`, and the slot (`:361-364`); the second call is forced to `deny` (`:349-350`). Plan and auto-edit set `decision: "deny"` in `evidence-cases.json:6-7`, so a command approval is declined.

Yolo does not get that protection (finding 1). Throw paths never write a `decline` frame; they rely on the later kill (finding 6). The literals `accept` and `decline` (`:366`) are not checked against a pinned schema. The schema files are not generated yet (`batch-1a-report.md:74`).

### 7. Dry-run and what the spec actually proves

`runHarness` returns before `createExperiment`, `spawn`, and artifact writes when `--run` is absent or `--dry-run` is also set (`:454-456`). The spec asserts the fake disk is untouched for `[]`, `--dry-run`, and `--run --dry-run` (`evidence-harness.spec.ts:95-101`). Invoking the file as main still reads `evidence-cases.json` (`:531`). That is a repo read, not a write and not an auth read.

The spec does exercise real logic for the counter, the env allowlist, the frame cap, UTF-8 split, envelope rejection, and string redaction. Cleanup, dry-run disk, and "no config.toml" are assertions on `jest.fn()` disk doubles (`:7-11`, `:55-83`). No test drives `onRequest`, a signal, `realpath`, a symlink, `taskkill`, or a second Ctrl+C. The batch report's own statement matches this: fake-only safety tests (`batch-1a-report.md:75`).

### 8. Anything else

`src/index.ts:1-2` is `export {}`. The package alias points at that file (`tsconfig.base.json`). Repo search shows no production import of `evidence-harness`. A failed run does not flip a production feature flag.

`policy('yolo')` still selects `danger-full-access` / `never` (`:275`), and `policy('plan')` selects `approvalPolicy: 'never'` (`:277`). `networkAccess: false` is not pinned; `config/read` checks only model, sandbox mode, approval policy, and `model_max_output_tokens` (`:280-283`, `:400-403`). Research says read-only network access defaults to false (`research-report.md:25`); the harness would not notice a binary that defaulted the other way. The copied `auth.json` sits on the same machine as the agent. A read-only sandbox that can read outside the workspace can put that file into model context. The harness never blocks a tool path outside the experiment except for the three marker booleans.

The generator does not copy auth (`generate-protocol-manifest.mjs:14-19`). It does run whatever `--binary` is, with `spawnSync` timeout 30s and no Windows tree kill (`:21-25`). Version stdout is written into the manifest unsanitized (`:45-46`, `:76-82`).

## Five logic questions

1. Silent success: yolo marks `observed` when both markers exist, interrupt was requested, and the terminal status is `interrupted` (`:425`). Writes or reads anywhere else do not affect that boolean (`hasUnexpectedMarker` returns false for yolo, `:328-334`).
2. User action: a real `--run` walks the case list until a gate fails, so a passing plan/auto-edit case still reaches yolo (`evidence-cases.json:6-8`, loop `:481-503`). A second Ctrl+C, or Ctrl+C during `copyFileSync`, exits before `cleanupExperiment`.
3. Wrong answer: `resolve(path) === target` (`:377`) treats a symlink at the marker path as the intended file. `existsSync` on a broken symlink is false, so the absence check (`:345-348`) still passes and `writeFileSync` follows the link.
4. Dependency failure: an oversized or non-Zod frame fails the child and still enters `stop()` (`:142-146`, `:437-439`). A `taskkill` failure still falls through to home deletion while the child can remain (`:208-224`, `:505-508`). A wrong approval `decision` literal is not rejected locally (`:366`); the server's default is unproven because the schema was not generated.
5. Unspecified but required by the hard rules: an OS write jail, an egress block, a proof the temp home is disjoint from the real Codex home, and cleanup on `uncaughtException` / a second signal. The case table does not provide these.

## Findings

### 1. Blocking — yolo is unsandboxed, auto-approves any command, and the watchdog cannot see damage

`evidence-cases.json:8` runs `yolo-interrupt` at level `yolo` with `decision: "accept"`. `policy` maps that to `sandbox: danger-full-access` and `approvalPolicy: never` (`evidence-harness.ts:274-275`) and the same strings are passed as `-c` overrides (`:312-313`) and on `thread/start` (`:404`). For `kind: 'boundary'` the command-equality check is skipped (`:354` requires `kind === 'command'`), and the decision falls through to `accept` (`:349-350`). `hasUnexpectedMarker` returns false for this level (`:328-334`), so the 20 ms guard never aborts. The success gate only requires the two marker files plus an interrupt (`:425`). Plan uses `approvalPolicy: never` as well (`:277`, `evidence-cases.json:6`), so a sandbox miss there also runs commands with no harness approval. No `networkAccess: false` is sent (`:400-403`). The copied auth file is on disk at `experiment.home/auth.json` (`:89`) for the whole case. A confused or hostile tool call can read it, write outside the experiment, or open a network connection, and the case can still be recorded as `observed`.

Fix: delete the yolo case from any real `--run` until the child is in an OS jail whose writable set is only the experiment root and whose network is closed. Do not pass `danger-full-access`. For every level, respond `decline` unless the command string or the file path is the single fixed marker, and abort the child when any observed path is outside `realpath(experiment.root)`. Pin `networkAccess: false` and refuse the run when `config/read` does not show it.

### 2. Serious — auth deletion is not bound to every process-death path, and a live child can outlive it

`createExperiment` copies auth at `:474` and `:89`. `SIGINT` / `SIGTERM` listeners are registered after that copy (`:477-479`) with `process.once`. The handler only sets `signaled` (`:478`). The first Ctrl+C therefore waits for the in-flight request (up to `REQUEST_TIMEOUT_MS`, `:14` and `:195`) before `finally` at `:505`. A second Ctrl+C is the default terminate, which does not run `finally`. There is no `uncaughtException`, `unhandledRejection`, or Windows `SIGBREAK` handler. The generator's `finally` (`generate-protocol-manifest.mjs:84-86`) has the same single-exit shape and no tree kill (`:21-25`).

`stop()` on Windows swallows `taskkill` failure (`:212`) and may throw after 5s (`:219-222`). `runHarness` still calls `cleanupExperiment` (`:507`). The home can be removed while an app-server or MCP grandchild is alive and still holding the token.

Fix: register persistent `SIGINT`, `SIGTERM`, and `SIGBREAK` handlers, plus `uncaughtException` / `unhandledRejection`, before `copyFileSync`. On the first signal, set the flag, kill the tree, delete the home, then exit. Ignore further signals until that finishes. Do not delete auth until `taskkill` (or the POSIX group kill) has been observed to reap the pid, and retry the kill once. Apply the same order in the generator.

### 3. Serious — the temp Codex home is not proven to be outside the real one

`createExperiment` uses `mkdtempSync(join(tmpdir(), 'ptah-codex-evidence-'))` (`:85-86`) and never compares `realpath` of that directory with `realpath(homedir() + '/.codex')` or with the `CODEX_HOME` value already in the parent environment. The generator does the same (`generate-protocol-manifest.mjs:14-19`). If `TEMP` or `TMPDIR` is the real Codex home, or a directory inside it, the copy and the later `rmSync(experiment.root)` (`evidence-harness.ts:102`) operate inside the user's Codex directory. The server check at `:396` only checks that the reported home equals the temp home. It does not check that this home is disjoint from the user's home.

Fix: `realpath` the new root before the copy. Abort with no copy if that path equals, contains, or is contained by the real Codex home (parent `CODEX_HOME` when set, otherwise `homedir()/.codex`). Use the same predicate in the generator. Do not follow a symlink as the temp root.

### 4. Serious — marker checks are not symlink-safe, so a write can land outside the root and still pass

File approval compares `resolve(changes[0].path)` to `target` (`:377`) and never `realpath`s the final file, its parent, or the experiment root. Absence uses `existsSync` (`:345-348`, `:271-272`). On Node, `existsSync` is false for a dangling symlink, and `fs.writeFileSync` follows a symlink. Auto-edit is `workspace-write` (`:276`) with `decision: "deny"` for approval requests (`evidence-cases.json:7`), so a workspace write that does not ask approval can create a symlink at `workspace/<id>.marker` pointing outside the experiment. The auto-edit gate treats that workspace marker as the required success (`:424`). The MCP fixture writes with `flag: 'wx'` and no `realpath` confinement (`:246`). Ask-level command cases are safer only because the approved command string is fixed (`:354-356`); auto-edit and yolo are not.

Fix: reject any marker path whose parent `realpath` is not inside `realpath(experiment.root)`. Reject non-regular files and links immediately before `respond` and again before scoring the case. Make the fixture `realpath` the destination and refuse paths outside the two allowed files' real parents.

### 5. Moderate — one charged turn can spend an unbounded number of model inferences

`claim()` covers only `turn/start` and `thread/compact/start` (`:186-190`). After a successful claim, the client waits up to 120s (`:414-416`) and will approve up to four tool calls (`:344`). Plan and yolo never enter that cap (`approvalPolicy: never`, `:275-277`). Usage notifications do not call `claim()` (`:381`). A single case can therefore perform many model rounds while `budget.consumed` stays at 1. The planned table still sums to 8 client charges (`evidence-cases.json` turn costs; guard at `:453`). This is not a ninth `turn/start`, and there is no client retry. It can still burn more than eight inferences.

Fix: abort the child when a usage event or a second model-visible item arrives beyond a per-turn inference cap of 1, and shorten the turn deadline to the minimum the protocol needs. Count that abort as a consumed turn, which the code already does for the original `turn/start`.

### 6. Moderate — unknown approvals are not explicitly declined, and the decision literal is unchecked

Unknown or unexpected server requests throw (`:341-344`) and the handler catch only calls `fail` (`:168`). `respond` is not called, so no `decline` frame is written. Safety then depends on `stop()` killing the server before it applies a default. The body that is sent on the success path is hard-coded `{ decision: 'accept' | 'decline' }` (`:366`). `schemaText` is used only to search for `modifiedInput` (`:487`). No schema file exists yet (`batch-1a-report.md:74`), so this review cannot show that `decline` is the deny vocabulary.

Fix: on every rejection path, `respond` with the schema's deny value before `fail`, if the schema enum contains it. Load that enum from the pinned schema in the same check as `loadManifest` (`:260-268`). If the enum is missing, do not start a turn.

### 7. Moderate — redaction misses account identifiers and short secrets

`sanitize` (`:69-72` and the key test at `:76`) does not match an email address or an account id. Secrets shorter than 48 characters are kept unless they are `sk-` tokens, three-part JWTs, Bearer tokens, or a labeled key. Current artifacts do not store prompts or stderr (answer 5), so this does not by itself leak `auth.json`. It will miss those shapes if `config/read`'s `model` or `approval_policy` string, or a future note, contains them. Both artifact files are written after `sanitize` of the object (`:509-525`); the markdown table is a separate unsanitized concatenation of harness-controlled status strings.

Fix: add email and account-id replacements, and redact values whose keys match `account`, `email`, `cookie`, or `session`. Run the markdown rows through the same function.

### 8. Moderate — the spec's safety claims are mocked or absent on the paths that can cause harm

Counter, env filter, frame cap, and redaction tests call the real functions (`evidence-harness.spec.ts:21-54`, `:85-136`). Disk cleanup, partial-copy cleanup, and dry-run use `fakeDisk` (`:7-11`, `:55-101`) and never hit `rmSync`, signals, or `spawn`. No test constructs an approval frame, a symlink, a `CODEX_HOME` inside the temp root, or a Windows pid. `fakeChild` sets `pid: undefined` (`:16`), so `stop()` skips `taskkill` (`evidence-harness.ts:208`). A green run of this file does not show that a real `--run` will confine writes or delete auth after Ctrl+C.

Fix: add tests that drive `onRequest` with an unknown method, a mismatched command, a symlink path, and a yolo case, and assert zero `accept` responses. Add a test that the temp-root predicate rejects a home inside a fake Codex home. Keep those tests on the fake disk; do not spawn Codex.

## Failure modes

1. Sandbox fail-open or yolo full access writes or reads outside the experiment, including `home/auth.json`, and the case is still `observed` (finding 1).
2. Second SIGINT, SIGINT during the copy, or an uncaught exception leaves `auth.json` in the temp directory (finding 2).
3. `taskkill` or the POSIX group kill fails; the orphan keeps the token after `rmSync` (finding 2).
4. A symlink at a marker path redirects the write outside the root and the gate still passes (finding 4).
5. One `turn/start` runs a tool loop until the 120s deadline and spends more than one model inference (finding 5).

## Decisions

1. Block execution on the yolo / no-jail behaviour rather than treating it as an accepted spike. Options: allow the case because the batch planned it, or refuse a real `--run` until an OS jail exists. Evidence: the user hard rule that only marker files inside the experiment root may be touched, `policy` at `evidence-harness.ts:275`, and `batch-1a-report.md:78`, which leaves YOLO to this review. Reversible after a jail is added and this review is repeated.
2. Rate the in-turn agent loop as moderate, not as a bypass of the eighth `turn/start`. Options: call every sampling round a cap breach, or count only client methods this file can send. Evidence: `claim()` at `:186-190` and the case-file sum of 8. The extra inferences stay a finding because the hard cap is eight model turns and the wait is 120s. Reversible if the operator defines the cap as API rounds instead of `turn/start`.

## Unverified

Codex 0.155.1's actual deny enum, read-only read scope, and whether an unanswered approval defaults to allow. The schema export does not exist. Windows `taskkill /T` and POSIX process-group behaviour were not run. Diagnostics were not re-requested; this review did not edit source.

## Fix round re-review

Reviewer: Grok CLI. Implementer of the fix: Codex CLI. Review family: grok vs codex. This section supersedes the header verdict. The sections above are the first-round record and were not rewritten.

Scope read for this pass: current `libs/backend/codex-runtime/tools/evidence-harness.ts` (771 lines), `evidence-harness.spec.ts` (the new `review regression guards` block at lines 146–276), `evidence-cases.json`, `generate-protocol-manifest.mjs`, and `batch-1a-fix-report.md`. Not run: harness, generator, codex, nx, jest, tsc, lint, build. No source edits. `src/index.ts` was not re-read; the fix report's file list does not include it.

**Verdict:** APPROVED
**Score:** 7/10

Zero open Blocking and zero open Serious. That is the bar for a real `--run`. The score stays in the 7–8 band, not 9, because a failed tree kill still leaves the temp `auth.json` in place, token accounting is observed rather than enforced by the provider, and Codex 0.155.1's sandbox behaviour is still unverified. It is not 5–6: the four holes that made a real run unacceptable (full access, `approvalPolicy` `never`, handlers installed after the copy, no disjoint-home check) now fail closed in the source.

### Status of findings 1–8

| # | Status | Evidence in the current code | What is left |
| --- | --- | --- | --- |
| 1 | CLOSED | `policy` returns only `read-only` or `workspace-write`, and `approvalPolicy` is `untrusted` (`evidence-harness.ts:424-427`). `assertSafeSandbox` rejects `danger-full-access` and `external-sandbox`, including camel-case, and is applied to that policy, to outgoing RPC params (`:305-306`), to `config/read` (`:431`), and to the thread result (`:634`). `markerApprovalDecision` accepts only the exact marker command, one validated file item, or the fixed local MCP `slot: original` call; plan, a second round, `decision !== 'accept'`, and every other method return `decline` (`:448-463`). The pre-check at `:574-575` uses the same function, so an unknown request never reaches `respond` with `accept`. | The binary's enforcement is still unverified. A `workspace-write` child can touch a non-marker file inside the experiment workspace without an approval item; the 20 ms guard only fails the case when a watched marker appears early (`:553-558`, `:561`). |
| 2 | PARTIAL | Fatal listeners are `process.on` for `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`, and Windows `SIGBREAK`, installed at `:705-706`, before `createExperiment` at `:708`. The destination is registered at `:150` before `copyFileSync` at `:154`. `createFatalCleanup` (`:211-215`) and the normal `finally` (`:734-736`) call `stopSync` / `killTreeSync` before `cleanupExperiment`. A second signal enters the same handler again because it is not `process.once`. The generator installs the same events at `generate-protocol-manifest.mjs:39-41` before `mkdtempSync` at `:109`, and `invoke` kills in `finally` (`:85-88`). The generator never copies `auth.json`. | Not an every-death guarantee. `killTreeSync` throws when `taskkill` (or the POSIX group kill) fails and the pid is still alive (`:197-200`, `:202-204`). The fatal handler then skips `cleanup()` and `process.exit(1)` (`:211-215`). Uncatchable process death cannot run this JavaScript. This residual is Moderate: the copy can remain under the temp directory; it is not deleted while that known child is alive. |
| 3 | CLOSED | `assertDisjointHomes` (`:108-118`) `lstat`s the root and the home, `realpath`s them, and rejects equality or nesting in either direction against `homedir()/.codex` and a set `CODEX_HOME`. Missing protected paths are rebuilt from the realpath of the existing ancestor (`:100-106`). The check runs at `:153` before the copy. The generator uses the same predicate at `generate-protocol-manifest.mjs:42-62`, called at `:114` before any binary spawn, and rejects a symlink root at `:110`. | A protected home that does not exist is compared through its existing ancestor. No `config.toml` is read or copied. |
| 4 | CLOSED | `markerExists` (`:121-141`) rejects a symlink root, a symlink parent, a non-regular file, and a realpath outside the experiment, and it runs the inspection twice. Dangling links throw instead of counting as absent. The approval hold uses it before and after the 200 ms wait (`:578-581`). The shared writer (`:349-376`) checks before and after `openSync` with `O_EXCL` and `O_NOFOLLOW` when the constant exists. `checkObservedPaths` (`:466-487`) rejects escaping paths and symlink components on request params and notifications. | A parent directory can still be swapped between the `lstat` and the `open`. `O_NOFOLLOW` is omitted when the constant is missing (`:374`). That race is not an open Serious for this single-user temp experiment. |
| 5 | PARTIAL | Case deadline is 60 s (`:14`, armed at `:562`). Observed cumulative ceiling is 12,000 (`:15`, `:228-231`, `:616-619`). A missing usage event throws before the next case (`:659`, `:731`). `markerApprovalDecision` declines when `approvals !== 0` (`:450`); the handler then aborts. A second tool item throws (`:611-612`). The outcome path interrupts (`:547-558`). Compaction is a separate `claim()` and shares that case deadline (`:652-657`). `TurnBudget.claim` still only moves forward (`:36-42`) and still runs before the write (`:305-309`). | One `turn/start` can still contain more than one provider sampling until the deadline, the 1,024 output-token override (`:526`), or the observed ceiling. Usage events can lag billing. This is not an open Serious and it does not add a ninth charged client turn. |
| 6 | CLOSED | The default request handler writes a decline and throws (`:244-246`). Parse and gate failures decline when the frame has an id (`:277-286`). `decline` writes `{ decision: denyLiteral }` even after `fail` (`:323-329`). The approval `catch` declines unless `respond` already happened (`:589-592`). `schemaDenial` (`:490-504`) uses `decline` or `deny` from the pinned schema when that enum exists. | Where the enum is absent the literal stays the unverified fallback `decline` (`:249`, `:504`). Writing the frame does not prove the server applied it. `stopSync` is the backstop. |
| 7 | CLOSED | `sanitize` redacts emails, `acct`/`account`/`org`/`user` prefixes, UUIDs, `gh*_` and `xox*-` prefixes, and labeled account/email/cookie/session/token/refresh values (`:71-79`). Keys matching account, email, cookie, session, token, refresh, and the older secret names are replaced, except the named numeric usage counters (`:82-86`). The markdown table is passed through `sanitize` (`:759`). | An unlabeled secret shorter than 48 characters with none of those prefixes is still kept. Artifacts still do not store prompts, wire params, stderr, or auth contents (`:66`, `:253`). |
| 8 | PARTIAL | The new block calls the real guards: `assertSafeSandbox` and `policy` (`evidence-harness.spec.ts:151-157`), `RpcChild.request` refusing `danger-full-access` before `stdin.write` (`:160-168`), `markerApprovalDecision` for every level plus file and MCP identity (`:171-190`), `assertDisjointHomes` on a real temp directory including a missing nested path (`:192-200`), `markerExists` on a real symlink (`:203-219`), `createExperiment` plus two `createFatalCleanup` calls that delete a real dummy `auth.json` and do not delete the source (`:222-248`), a real decline frame (`:251-261`), `UsageBudget` (`:264-268`), and `sanitize` including a markdown string (`:271-276`). | Jest was not executed by the implementer and was not executed in this review. The symlink test returns without an assertion on `EPERM`, `EACCES`, or `ENOTSUP` (`:210-213`). The fatal test mocks `stopSync` (`:235`), so `taskkill` and a delivered signal are untested. That is a gap in evidence, not a hole in the harness. |

### Residual limits in the fix report

None of them is a reason to refuse the bounded run on this machine.

- Unverified Codex policy and readback shape: `config/read` is before `thread/start` and `turn/start` (`:629-642`). A missing `network_access: false`, a sandbox string other than the selected one, an approval policy other than `untrusted`, or any `danger-full-access` string aborts the case with no model turn. Fail-closed is the right posture for a first real run.
- Tree kill can fail, and a hard process kill can skip JavaScript cleanup. The handler no longer deletes the home while it still sees a live child. The leftover is a temp copy, which is the safer side of the old bug. An operator can delete that temp directory if `cleanup` is reported failed (`:739`, `:761`).
- Marker checks are not an OS jail. Writes are supposed to be confined by `workspaceWrite` with `writableRoots: [experiment.workspace]` and `networkAccess: false` (`:639-641`), and the child env points `TMP`/`TEMP`/`TMPDIR` at the experiment scratch (`:173-174`). An extra file inside that temp root is deleted unless `--keep` is set (`:162-168`). `--keep` still deletes the home.
- The 12,000-token figure is an observed ceiling, not a provider bill cap. Combined with eight `claim()`s, a 60-second case deadline, one tool item, and `model_max_output_tokens=1024`, it does not recreate the old unbounded 120-second tool loop.
- The decline vocabulary can be wrong for a method the schema does not name. The child is then killed. Do not treat the resulting transcript as protocol proof; the fix report already says that.
- Redaction was not fed a live secret. The artifact shape still omits auth contents and prompts.
- Tests were not executed. That does not by itself make the source unsafe. The orchestrator can run the spec later; it is not required to withhold this experiment.

### New findings

No new Blocking or Serious defect. The fix does not reintroduce `danger-full-access` or `approvalPolicy: "never"` on any path that builds a child (`:424-427`, `:522-529`, `:632`, `:642`).

### Failure modes still accepted for the run

1. `taskkill` or `kill(-pid)` fails and the temp `auth.json` remains until manual cleanup (finding 2, Moderate residual).
2. The binary's `config/read` matches the safe profile but the process does not enforce it. The harness cannot detect that until a marker or an unexpected tool item appears (`:553-558`, `:611-612`).
3. One charged `turn/start` uses the 60-second and 1,024-output budget, and observed usage can under-count (finding 5).

## Decisions

1. Treat finding 2's kill-failure path as a closed Serious and an open Moderate residual. Options: keep it Serious until deletion is unconditional, or accept kill-before-delete with a possible leftover temp copy. Evidence: `createFatalCleanup` at `evidence-harness.ts:211-215` and fix-report decision 4. Reversible if a later round adds an OS container.
2. Approve execution. Options: withhold until Jest is run and Codex readback is known, or allow the bounded `--run` because the pre-turn gates fail closed. Evidence: findings 1 and 3 closed at the lines above, network gate at `:432` and `:629-631`, turn cap unchanged at `:36-42` and `:305-309`. Reversible by not passing `--run`.

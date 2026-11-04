# Batch 10 report: native carry-over route, projector and Electron port

Task: TASK_2026_865_2a1d, Batch 10 (Tasks 10.1 and 10.2). Executor: backend-developer subagent.
I ran no git commands, so the working tree is uncommitted. `decisions.md` also shows as modified,
but I did not make that change.

## Files changed

Paths are relative to the worktree
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.

- CREATED `libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.ts`
  - New pure function `projectCodexCarryOverTranscript(tail): CarryOverTranscript`.
  - New exported type `CodexCarryOverTail`, which is
    `Awaited<ReturnType<CodexHistoryReader['readHistoryTail']>>`.
- CREATED `libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts`
  - `NativeSessionHistoryPort` gains the optional `readHistoryTail?(session, bound, signal?)`.
  - New `NativeCarryOverBound` (`Parameters<CodexHistoryReader['readHistoryTail']>[2]`).
  - New `CarryOverRouteOptions extends CarryOverReadOptions { nativeBound? }`.
  - `readCarryOverTranscript` now has a native route: it calls `readHistoryTail` and projects
    the result.
  - The error collapsing is moved into a private `collapseNativeErrors`. `nativeHistory` and the
    new `nativeHistoryTail` both use it, and its behaviour is unchanged.
- MODIFIED `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts`
  - Batch 4's "refuses a native session" case is replaced by the native-route cases listed under
    Tests.
- MODIFIED `apps/ptah-electron/src/di/codex-runtime-composition.ts`
  - The body of `readHistory` became the private closure
    `runHistoryRead<T>(session, signal, read)` inside `createElectronCodexHistoryPort`. The
    closure owns:
    - the busy cap;
    - identity, home and workspace validation;
    - realpath, the profile build and the resume identity;
    - the binary check and the scope;
    - the timeout and abort race;
    - scope disposal and error mapping.
  - `readHistory` and the new `readHistoryTail` are thin callers of that closure. Each passes a
    callback that checks its own runtime method and throws `runtimeFailed` when the method is
    missing.
  - The `hasHistoryReader` type guard is deleted. This fixes the Batch 9 note: an old runtime
    with only `readHistory` still serves `readHistory`.
  - `ElectronCodexHistoryPort` gains `readHistoryTail(session, bound, signal?)`.
  - The diff is mostly re-indentation. The logic is moved unchanged.
- CREATED `apps/ptah-electron/src/di/codex-history-port.spec.ts`
- NOT MODIFIED: `libs/backend/codex-runtime/src/index.ts`. Every type is derived from
  `CodexHistoryReader['readHistoryTail']`, which is already exported.

## Design notes

- **Native route** (`readCarryOverTranscript`). The steps, in order:
  1. `nativeSession` runs unchanged. A non-native id goes to the legacy read with `options`
     passed through by reference, so the Claude route is unchanged.
  2. No `nativeBound` gives `nativePortUnavailable`, before `getNative` is called (see
     Decisions).
  3. An absent port, or a port without the `readHistoryTail` function, gives
     `nativePortUnavailable`.
  4. The router calls `readHistoryTail(session, bound, options.signal)`.
  5. Errors are collapsed exactly as in `nativeHistory`: an `ElectronCodexHistoryError` passes
     through, and any other error becomes `nativeReadFailed` with the error as its cause.
  6. The router projects the tail. A projection throw becomes `nativeReadFailed`.
  7. `readHistory` is never called on this route.
- **Projector**, following the plan's item mapping (plan lines 1042-1068).
  - `userMessage`:
    - `text` parts are trimmed and joined with `\n`;
    - `image` and `localImage` become `[image omitted]`;
    - `mention` and `skill` become `[file: <basename(path)>]` (`/` or `\` separators);
    - `audio` and `localAudio` are dropped.
  - `agentMessage`: the trimmed `text`, for both phases.
  - Fixed lines:
    - `commandExecution` → `[tool: shell]`
    - `fileChange` → `[tool: apply_patch]`
    - `webSearch` → `[tool: web_search]`
    - `imageView` → `[image omitted]`
  - Named lines:
    - `mcpToolCall` → `[tool: <tool>]`
    - `collabAgentToolCall` → `[tool: <tool or 'agent'>]`
    - `functionCallOutput` → `[tool: <name>]`
    - `dynamicToolCall` → `[tool: <tool>]`
  - Name rule:
    1. Whitespace runs become one space.
    2. `[` and `]` are removed.
    3. The result is trimmed, cut to 64 characters and trimmed again.
    4. A blank result becomes `tool`.
  - These give nothing: `reasoning`, `contextCompaction`, `hookPrompt`, and every other or
    unknown item. That includes `plan`, `sleep`, `subAgentActivity`, `imageGeneration` and
    review-mode items, none of which the plan maps.
  - The projector reads only `type`, `text`, `content`, `tool` and `name`, plus `path` on mention
    and skill input parts. It never reads tool inputs, outputs, commands, cwd, diffs, MCP
    arguments or results, content items, namespace or reasoning.
  - Each item that projects to text becomes one piece. Consecutive same-role pieces merge with
    `\n\n`, the same separator the Claude projection uses, so pieces merge across turn
    boundaries too. An empty piece is dropped.
  - `compactionSummary` is always `false`, and so is `startsAtCompactionSummary`.
    `windowCoversWholeHistory` is set to `coversWholeHistory`.
  - The item union has an unknown arm (`{ id, type: string }`), so a `switch` does not narrow on
    it. A local type guard, `isItem(item, type)`, narrows instead. It is sound because the schema
    refines the unknown arm so that it never carries a known type
    (`codex-protocol-schemas.ts`, `item`).
- **Electron cap.** One `activeReads` counter is shared by both methods, so any mix of the two
  allows at most two reads. The guard is still checked and incremented synchronously, before the
  first `await`.

## Tests

`codex-carry-over-projector.spec.ts` (Task 10.1 projector):

- User and agent prose, with both phases, map to alternating turns.
- A `describe.each` case per tool kind checks its single line: `commandExecution`, `fileChange`,
  `mcpToolCall`, `webSearch`, `collabAgentToolCall` and `imageView`.
- Sentinel checks (AC 3.5, 3.6, 3.9). One secret sentinel appears in:
  - command text, cwd, actions and output;
  - the file diff and path;
  - the MCP server, arguments and result;
  - the web query and results;
  - the collab prompt and agent state;
  - the image-view path;
  - reasoning summary and content;
  - hook prompt fragments.

  The sentinel is absent from both the text and the JSON of the whole transcript.
- `reasoning`, `contextCompaction`, `hookPrompt` and an unknown item give no turns.
- Image, mention and skill placeholders, with POSIX and Windows paths, and dropped audio
  (AC 3.7).
- F2 `functionCallOutput` cases:
  - string output gives exactly `[tool: read_file]`;
  - content-item output gives the same line;
  - no sentinel in either case.
- F2 `dynamicToolCall`, for both `completed` and `failed`: a sentinel in `arguments`,
  `contentItems` and `namespace`, and the result is exactly `[tool: lookup]`.
- Each named tool item adds exactly one line.
- Name rule: a newline plus `]` injection, a blank or bracket-only name, and a 100-character
  name cut to 64.
- `contextCompaction` in the window gives `startsAtCompactionSummary === false` (AC 3.8).
- `coversWholeHistory` passes through as `windowCoversWholeHistory`, for both `true` and `false`.
- Same-role merging across turns, and empty turns dropped.
- An empty thread gives no turns.

`session-history-router.spec.ts` (Task 10.1 router):

- A native id goes to `readHistoryTail(session, bound, signal)`:
  - the bound is passed by reference;
  - `readHistory`, `getLegacy` and the legacy read are each called 0 times;
  - the result equals the projection.
- A `coversWholeHistory: false` tail projects to `windowCoversWholeHistory: false`.
- `nativePortUnavailable` for an absent port, a null port, and a port without
  `readHistoryTail`.
- A port error with the name `ElectronCodexHistoryError` and code `runtimeFailed` passes through
  by reference.
- Each of these becomes `nativeReadFailed`, with the error as its cause and fixed text:
  - a bare `CodexSessionHistoryError('pageLimitExceeded')`;
  - an unknown error whose message holds a path.
- A projection throw gives `nativeReadFailed`.
- A caller without `nativeBound` is refused with `nativePortUnavailable` before
  `getNative`, before any native read and before any legacy read.
- The Claude route is unchanged:
  - the existing cases still pass;
  - a Claude session given a `nativeBound` still goes to the legacy read, with its options
    unchanged and no tail read;
  - an invalid native identity is still propagated (existing case).

`codex-history-port.spec.ts` (Task 10.2), against a real `createElectronCodexHistoryPort` with
temporary home and workspace directories:

- Identity validation for both methods. Each case below is rejected before any scope or runtime
  call:
  - no execution;
  - another runtime;
  - another execution session id;
  - another provider;
  - another Codex home (`homeMismatch`);
  - another workspace key.
- A missing workspace path gives `pathUnavailable`.
- The bound reaches `runtime.readHistoryTail` by reference. The profile cwd and resume identity
  are checked, `readHistory` is not called, and the scope is disposed.
- `readHistory` regression:
  - same runtime call, same result, resume thread id, the controller signal aborted after
    settling, scope disposed, and no tail call;
  - error mapping unchanged: `malformedPage` → `malformedPage`, `threadNotFound` →
    `threadNotFound`, and an unknown error → `runtimeFailed` with fixed text.
- Tail error mapping: `pageLimitExceeded` → `runtimeFailed`, `requestRejected` →
  `runtimeFailed`, `malformedPage` → `malformedPage`.
- A runtime without `readHistoryTail` gives `runtimeFailed`, the scope is disposed, and the same
  runtime still serves `readHistory`. The reverse case also holds: a runtime without
  `readHistory` gives `runtimeFailed` there and still serves `readHistoryTail`.
- `busy` at the third concurrent read, with one full read and one tail read in flight. Both
  methods give `busy`. After the first two settle, a new read succeeds.
- Timeout path, for each method, with `timeoutMs: 20`:
  - `timeout` is raised;
  - the runtime's signal is aborted;
  - the scope is disposed;
  - the slot is freed, so the next read succeeds.
- An already aborted caller signal gives `cancelled` with no runtime call, for each method.

## Verification

- Jest run 1 (agent-sdk; ts-jest with type diagnostics on):
  `node scripts/verify.mjs --exec --task batch10-jest -- npx jest -c libs/backend/agent-sdk/jest.config.ts …/session-history-router.spec.ts …/codex-carry-over-projector.spec.ts`
  → `Test Suites: 2 passed, 2 total; Tests: 47 passed, 47 total`. Exit code 0.
- Jest run 2 (ptah-electron; ts-jest):
  `node scripts/verify.mjs --exec --task batch10-jest -- npx jest -c apps/ptah-electron/jest.config.ts …/codex-history-port.spec.ts …/codex-runtime-composition.spec.ts`
  → `Test Suites: 2 passed, 2 total; Tests: 42 passed, 42 total`. Exit code 0.
  - Jest also printed "A worker process has failed to exit gracefully". I did not find out which
    of the two suites caused it, because the two-run limit was used up. The port's timer is
    `unref()`'d, and the never-settling fake promises hold no handle. If the Batch 10 verify
    shows the same message, run `--detectOpenHandles` on the new spec.
- `ptah_get_diagnostics`, scoped to the changed files, was called 3 times. Every call returned
  "TypeScript check unavailable": two calls hit the 45 s timeout and one found the worker
  terminated. No diagnostics result was obtained. ts-jest type-checked each spec file and
  everything it imports, which covers all four production files.
- I also ran a scoped eslint on the 6 changed files, under the lock: 0 errors and 3 warnings,
  all in `codex-runtime-composition.ts`:
  - `max-lines`: the file was already 868 lines at HEAD, over the 700-line limit, and is now
    about 896;
  - `preserve-caught-error` at :367;
  - unused `verifyBinary` at :699.

  The last two are outside the lines I edited.
- Not run, by the user's decision: `npm run verify -- -p @ptah-extension/agent-sdk,ptah-electron`.
  CI covers it.
- rpc-handlers compile surface: `chat-carry-over.service.ts:214` passes `{ tailBytes, signal }`,
  which is still valid because `nativeBound` is optional. `chat-carry-over-transcript.ts:9`
  uses the router's return type, which is unchanged. Neither is type-checked by this batch's
  runs.

## Decisions

- **`nativeBound` is optional in the router's options. A native session without it is refused
  with `nativePortUnavailable` before any read.**
  - Options considered:
    - (a) Required. This breaks the rpc-handlers caller's typecheck until Batch 11, and the
      pre-push Electron build gate runs on the Batch 10 commit.
    - (b) Optional, with the fail-closed refusal. CHOSEN.
    - (c) Optional, with a default bound inside agent-sdk. Rejected: the plan puts the constants
      in rpc-handlers (Batch 11).
  - Evidence:
    - `chat-carry-over.service.ts:214-221` passes no bound today.
    - batches.md says Batch 11 adds the constants and passes `nativeBound`.
    - Batch 4's behaviour for a native session, "refused before any read", is kept exactly until
      Batch 11 enables it.
  - Reversible: yes. Batch 11, or a later change, can make the field required once its caller
    passes it.
- **Legacy options are passed by reference, including `nativeBound` when present.** The Claude
  reader ignores the extra field, and the existing case asserts that `options` reaches it
  unchanged (`toBe`). Destructuring would break that "Claude route unchanged" guarantee.
  - Reversible: yes.
- **`index.ts` is not edited.** The tail and bound types are derived from
  `CodexHistoryReader['readHistoryTail']` in both projects, as plan line 952 allows.
- **Unmapped item kinds give nothing.** This covers `plan`, `sleep`, `subAgentActivity`,
  `imageGeneration`, `enteredReviewMode` and `exitedReviewMode`. The plan's mapping lists them
  nowhere, and its rule is "unknown items give nothing". `plan` holds agent text, but carrying it
  would go beyond the plan.
  - Reversible: yes.
- **Merge separator `\n\n`.** It matches the Claude carry-over merge of same-role records
  (`session-history-reader.service.ts`, `projectCarryOverTranscript`). Inside one user message,
  parts are joined with `\n`, as inside one Claude message.

## Not done or out of scope

- Batch 11 (the rpc-handlers constants, eligibility and passing `nativeBound`) is not touched, as
  instructed.
- `codex-runtime-composition.ts` is still over the 700-line `max-lines` limit (it was before this
  batch). Splitting the history port into its own module would fix it, but the batch's file list
  does not include that.
- A8 and A10 (manual Electron reads) are still open, as in Batch 9.

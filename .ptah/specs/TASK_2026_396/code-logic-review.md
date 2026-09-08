# Code-logic review — TASK_2026_396

## Verdict

APPROVE WITH NITS — The in-scope change (the Codex resume lane) is correct: the
probe is gone, the Codex thread id reaches the spawn, and the user's typed
follow-up reaches the model. One blocker-severe defect exists on the `ptah-cli`
lane, but it lives in `ptah-cli-registry.ts`, which the frozen scope forbids
editing; it is reported here as OUT OF SCOPE / follow-up, not as a reason to
reject this change.

## Findings

1. **[blocker — OUT OF SCOPE / follow-up]** The `ptah-cli` resume lane drops the
   user's typed follow-up. `ptah-cli-registry.ts:682-685`:

   ```ts
   const isResume = !!options?.resumeSessionId;
   const effectivePrompt = isResume
     ? 'Continue working on the previous task. Pick up where you left off.'
     : task;
   ```

   This change makes `resumeSessionId` always set on the `ptah-cli` lane
   (`agent-rpc.handlers.ts:878`), so `isResume` is always `true`, so
   `effectivePrompt` is always the hardcoded string and the `task` argument
   (the user's typed words, passed at `agent-rpc.handlers.ts:875`) is never
   used. The feature is "send a follow-up message"; on this lane the follow-up
   never reaches the model. The `mailbox.prompt` at `ptah-cli-registry.ts:688`
   and `ptah-cli-registry.ts:705` carries the hardcoded string, not the user's
   text. Failure scenario: a user types "now add unit tests for it" into a
   finished `ptah-cli` agent's resume box; the model instead receives "Continue
   working on the previous task. Pick up where you left off." and the typed
   instruction is lost. This is a pre-existing design in a frozen file; this
   change extends it from "only when the transcript file existed" to "always".
   Not fixable here.

2. **[nit]** Stale comments and dead mock setup in the spec file. The probe no
   longer exists, but `agent-rpc.handlers.resume-parent-session.spec.ts:173-175`
   still comments "The workspace resolves to a project dir and the CLI session
   file exists." and sets `mockReaddir.mockResolvedValue(['D-ws'])` /
   `mockAccess.mockResolvedValue(undefined)`. Lines `244-248` still comment
   "`sessionFileExists` escapes the workspace root with /[:\\/]/g → '-', so
   'D:/ws' becomes 'D--ws'." and set the same mocks. The renamed test at line
   193 is now named "preserves the resume and parent session ids when the
   filesystem probe would fail" and sets `mockAccess.mockRejectedValue(...)`,
   but there is no filesystem probe to fail. None of these setups are observed
   by the handler anymore (the new TASK_2026_396 block correctly asserts
   `mockReaddir`/`mockAccess` were never called). The tests pass; the prose is
   misleading. The spec file is in scope and could have been cleaned.

3. **[nit]** `workspaceRoot` (`agent-rpc.handlers.ts:784`) is computed but
   unused on the non-`ptah-cli` (Codex) path. Before this change it fed
   `sessionFileExists`; now the Codex branch at lines 801-808 never reads it.
   `AgentProcessManager.spawn` does not take a working-directory argument from
   the caller (it resolves its own at `agent-process-manager.service.ts:399`).
   Dead computation on one of two branches.

4. **[nit — OUT OF SCOPE]** `agent-process-manager.service.ts:461-465` warns
   `resume_session_id provided for codex which does not support session resume`
   whenever `request.resumeSessionId && request.cli !== 'copilot'`. Codex does
   support resume (`codex-cli.adapter.ts:640-641`, `codex.resumeThread`). This
   change makes the warning fire on every Codex resume (before, only when the
   probe found the file), so log noise increases for a condition that is not an
   error. The file is out of scope and the line is pre-existing; reported only
   because the change amplifies it.

## Answers

### Q1 — Does the user's typed follow-up reach the model, for both paths?

**Non-`ptah-cli` (Codex): YES, it reaches the model.**

- `agent-rpc.handlers.ts:803` passes `task: params.task` and line 804 passes
  `resumeSessionId: params.cliSessionId` into `AgentProcessManager.spawn`.
- `agent-process-manager.service.ts:411` forwards `request.task` as the `task`
  arg to `doSpawnSdk`.
- `agent-process-manager.service.ts:467-468` calls `runSdk({ task, ...
  resumeSessionId: request.resumeSessionId })`.
- The Codex adapter at `codex-cli.adapter.ts:640-643` builds the thread with
  `codex.resumeThread(options.resumeSessionId, threadOptions)` (resuming) and
  then `const taskPrompt = buildTaskPrompt(options)`.
- `buildTaskPrompt` (`cli-adapter.utils.ts:357-378`) embeds the user's text at
  line 364: `taskPrompt += \`${NATIVE_AGENT_TOOL_POLICY}\n\n${options.task}\``.
- That `taskPrompt` is what `thread.runStreamed(prompt, ...)` sends
  (`codex-cli.adapter.ts:665-669`).

The user's typed words reach the model on the Codex path.

**`ptah-cli`: NO, it does NOT reach the model.**

- `agent-rpc.handlers.ts:875` passes `params.task` as the second arg to
  `PtahCliRegistry.spawnAgent`, and line 878 passes
  `resumeSessionId: params.cliSessionId`.
- `ptah-cli-registry.ts:682-685` computes `isResume = !!options?.resumeSessionId`
  and, when true, sets `effectivePrompt = 'Continue working on the previous task.
  Pick up where you left off.'` — discarding the `task` argument.
- After this change `resumeSessionId` is always set on this lane, so `isResume`
  is always `true`, so the hardcoded string always wins.
- `ptah-cli-registry.ts:688` builds `createPromptMailbox(effectivePrompt)` and
  line 705 passes `prompt: mailbox.prompt` to the SDK `query` call.

Per the review's own rule, dropping the user's typed words is blocker-severe.
This defect is in `ptah-cli-registry.ts`, a frozen file, so it is Finding 1
(OUT OF SCOPE / follow-up), not a reject of this change.

### Q2 — Did this change alter the answer to Q1?

Yes, for the `ptah-cli` lane. The old code set `resumeSessionId` to `undefined`
when the transcript file was missing, so `isResume` was `false` and the user's
`task` was used (as a fresh start). Now `resumeSessionId` is always set, so
`isResume` is always `true` and the user's `task` is always replaced.

Downstream consumers of `resumeSessionId` in `libs/backend/cli-agent-runtime`:

- `agent-process-manager.service.ts:449-451`: spreads
  `cliSessionId: request.resumeSessionId` onto `AgentProcessInfo` only when set.
  Now always set for Codex. Intended (AC2 — lets the frontend dedupe agent
  cards by CLI session).
- `agent-process-manager.service.ts:461-465`: warns for every non-copilot
  resume. Now fires on every Codex resume. The claim "does not support session
  resume" is false for Codex. Pre-existing, out of scope (Finding 4).
- `codex-cli.adapter.ts:640-642`: `options.resumeSessionId ?
  codex.resumeThread(...) : codex.startThread(...)`. Now always resumes.
  Intended (AC2).
- `ptah-cli-registry.ts:746`: `...(options?.resumeSessionId && { resume:
  options.resumeSessionId })`. Now always sends `resume:` to the SDK.
  Intended (AC3').
- `ptah-cli-registry.ts:682-685`: the prompt replacement. Unintended side
  effect — Finding 1.

No consumer branches on `resumeSessionId` being *unset* in a way that breaks
the Codex path. The one behaviour change nobody intended is the `ptah-cli`
prompt drop, which is out of scope to fix here.

### Q3 — Is the deletion complete?

- `sessionFileExists`: no surviving caller in production code. Grep across the
  repo hits only the task spec docs and the spec file's stale comments
  (`agent-rpc.handlers.resume-parent-session.spec.ts:244`). The method itself
  is gone from `agent-rpc.handlers.ts`.
- `fs`, `os`, `path` imports: removed. Grep for
  `import * as (fs|os|path)` and `from 'fs/promises'|from 'os'|from 'path'` in
  `agent-rpc.handlers.ts` returns no matches.
- `workspaceRoot` (line 784): still used on the `ptah-cli` path (passed to
  `resumePtahCliSession` at line 794, which passes it to `spawnAgent` as
  `workingDirectory` at line 877). NOT used on the non-`ptah-cli` path (lines
  801-808). Finding 3.
- Stale spec comments expecting the old behaviour: Finding 2.

### Q4 — What does the user see with a genuinely stale id?

**Codex:** `codex.resumeThread(staleId, threadOptions)` at
`codex-cli.adapter.ts:640-641`, then `thread.runStreamed(prompt, ...)` at line
668. If the SDK rejects the stale id, the rejection propagates out of `runSdk`,
through `doSpawnSdk` (`agent-process-manager.service.ts:467`), through
`spawn`, and is caught by the outer handler catch at
`agent-rpc.handlers.ts:818-826`:

```ts
} catch (error) {
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  this.logger.error('RPC: agent:resumeCliSession failed', ...);
  return { success: false, error: errorMessage };
}
```

The user sees a `{ success: false, error }` response — a clear error, not a
hang and not silent loss. The catch narrows correctly.

**`ptah-cli`:** `PtahCliRegistry.spawnAgent` returns either a handle or an
object with a `status` field. `agent-rpc.handlers.ts:883-885` throws on the
error shape:

```ts
if ('status' in spawnResult) {
  throw new Error(`Ptah CLI agent resume failed: ${spawnResult.message}`);
}
```

That throw is caught by the same outer catch at lines 818-826 and surfaced as
`{ success: false, error }`. A loud failure, as the task intends. If the SDK
instead accepts a stale id and starts a fresh session silently, that is the
SDK's behaviour, not this handler's; this change's design is to let the owning
registry report the failure, and the catch surface is in place to carry it.

### Q5 — Anything else?

- The outer catch at `agent-rpc.handlers.ts:818-824` narrows with
  `error instanceof Error` before reading `.message`. Correct.
- No `@ts-ignore` introduced.
- No `CLAUDE.md` statement is contradicted by this change. The
  `cli-agent-runtime/CLAUDE.md` note about `~/.claude/projects` ("Persistence
  beyond what SDK writes to `~/.claude/projects/`") describes the SDK's own
  writes, not the deleted probe, so it still holds.
- The agent-process-manager warning at lines 461-465 is a pre-existing stale
  log line (Finding 4); this change amplifies it but does not introduce it.
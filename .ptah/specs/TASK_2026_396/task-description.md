# Task description — TASK_2026_396

Written by the Conductor in-process. The root cause was already traced before
the relay started, so a plan lane would only re-derive it.

## Problem

`agent:resumeCliSession` refuses to resume a finished Codex agent. It fails with
a raw Node `ENOENT` naming a path under `~/.claude/projects`. See `context.md`
for the full diagnosis with file:line evidence.

## In scope

1. `sessionFileExists` in
   `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1074` must
   **never throw**. A missing directory, a missing file, or any other fs error
   is an answer (`false`), not an exception.
2. **AMENDED — see "Amendment 1" below.** No resume path may consult the
   `~/.claude/projects` transcript store. Every lane passes `cliSessionId`
   through to the spawn unchanged and lets that vendor's own adapter or registry
   report a resume failure it actually owns.
3. Both call sites must be updated consistently: the non-`ptah-cli` branch at
   lines 804-820 and `resumePtahCliSession` at line 875.
4. Regression coverage for the paths that had none.

## Out of scope

- Any change to the Codex adapter's own resume logic
  (`codex-cli.adapter.ts`). It is correct; it was never reached.
- Any change to the frontend. `agent-monitor.store.ts` and
  `agent-continue-input.component.ts` render whatever the handler returns and
  need no edit.
- Changing the RPC contract, the Zod schema, or the `agent:resumeCliSession`
  method name.
- Refactoring anything else in `agent-rpc.handlers.ts`.

## Amendments (Conductor, after the architecture phase)

The architecture lane produced evidence that invalidated two of my original
criteria. Both amendments are FROZEN and replace what they supersede.

### Amendment 1 — `ptah-cli` passes through as well

My original item 2 gated the probe on "the Claude lane". No such lane exists:
`CliType` is `SYSTEM_CLI_TYPES | 'ptah-cli'` and `'claude'` is not a member
(`libs/shared/src/lib/types/agent-process.types.ts:59-73`). The Zod boundary
rejects anything outside that set
(`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts:31-41`).

`ptah-cli` agents DO run on the Claude Agent SDK, so their transcripts really do
land in `~/.claude/projects`. That fact is true and it is not sufficient. When
the directory match fails, the probe returns `false`, the handler starts a fresh
thread, and the user is told the resume succeeded. The "starting fresh" warning
reaches the log only, never the user. That is the same silent loss this task
exists to remove. A loud failure from the owning registry is the correct
outcome. Therefore `ptah-cli` passes the id through too.

### Amendment 2 — delete `sessionFileExists`, do not repair it

Once both call sites stop consulting the probe, nothing calls it. Wrapping it in
`try/catch` and pinning it with tests through a private-method cast is coverage
for dead code. Delete the method. `fs`, `os`, and `path` are used ONLY inside it
(verified: the sole references are at lines 1078, 1080, 1092, 1098), so delete
those three imports with it.

## Acceptance criteria

A reviewer must be able to check each of these. AC3 and AC4 from the first draft
are withdrawn; AC3' and AC4' replace them.

- **AC1** — With `~/.claude/projects` absent entirely, `agent:resumeCliSession`
  for `cli: 'codex'` returns `{ success: true }` and does not throw.
- **AC2** — The same call for `cli: 'codex'` spawns with `resumeSessionId` set
  to the supplied `cliSessionId`. The Codex thread id is NOT discarded.
- **AC3'** — A `ptah-cli` resume passes the supplied `cliSessionId` unchanged to
  BOTH `PtahCliRegistry.spawnAgent` options and the
  `AgentProcessManager.spawnFromSdkHandle` metadata. The two halves must agree.
- **AC4'** — `sessionFileExists` no longer exists, and the `fs`, `os`, and
  `path` imports are gone. No resume path reads the filesystem.
- **AC5** — The suite passes:
  `npx nx run-many -t test -p @ptah-extension/rpc-handlers`. Read the
  `Running target test for N projects` header and confirm N is 1.
- **AC6** — New specs cover AC1, AC2 and AC3'. Each must assert the `fs`
  mocks were **never called**. A test that asserts only `{ success: true }`
  stays green if a probe creeps back in, so the negative assertion is the
  load-bearing half.

## Non-functional constraints

- `catch (error: unknown)`, narrowed with `instanceof Error` before reading
  `.message`. No `@ts-ignore`.
- No new dependency, no new lib, no new RPC method.
- Keep the change inside `agent-rpc.handlers.ts` and its spec files.
- The handler is platform-agnostic. Do not import `vscode` or Electron.

## Risk

The silent-loss path is the one that matters. A fix that only wraps the probe in
`try/catch` satisfies "no ENOENT banner" while making Codex start a brand-new
empty thread and reporting success. Any implementation that leaves
`resumeSessionId: undefined` on the Codex path fails AC2 and must be rejected.

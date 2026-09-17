# Context — TASK_2026_396

`mode: tribunal-relay`

## User intent

A Codex CLI agent finished. The user typed a follow-up into the agent card's
"Send a follow-up — resumes the session" box. It failed with a raw Node ENOENT
naming a path under `~/.claude/projects`. The user asked for the cause and then
for the fix, delivered by a Relay across CLI vendor lanes in a fresh worktree
based on `origin/main`.

## Worktree

- Branch: `fix/codex-session-resume`
- Base: `origin/main` @ `fb790588d`
- Path: `D:\projects\ptah-extension\.claude-worktrees\codex-resume-fix`

## Lane roster

| Phase           | Lane             | spawnArgs                                                        | Deliverable            |
| --------------- | ---------------- | ---------------------------------------------------------------- | ---------------------- |
| Plan / scope    | Conductor        | in-process (diagnosis already done)                              | `task-description.md`  |
| Architecture    | Codex            | `{ cli: 'codex' }`                                               | `implementation-plan.md` |
| Implement       | Codex            | `{ cli: 'codex' }`                                               | code in-place + `batches.md` |
| Test coverage   | Ollama Cloud     | `{ ptahCliId: 'pc-85830910-3d81-4248-84c1-4fa52752dd19' }`       | specs + `test-report.md` |
| Cross review    | Ollama Cloud     | `{ ptahCliId: 'pc-85830910-3d81-4248-84c1-4fa52752dd19' }`       | `code-logic-review.md` |

Constraint 1 holds: the review lane (Ollama Cloud / GLM) is not the implement
lane (Codex). Constraint 2 holds: the review is genuinely cross-vendor.

## Diagnosis (Conductor, confirmed by reading the source)

`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1074`

```ts
private async sessionFileExists(sessionId, workspacePath): Promise<boolean> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  ...
  const dirs = await fs.readdir(projectsDir);      // line 1080 — throws if absent
  ...
  await fs.access(sessionFile);                    // line 1098 — throws ENOENT
  return true;
}
```

Four findings:

1. **Wrong store.** The probe only looks in `~/.claude/projects`, the Claude Code
   transcript directory. Codex resumes through its own SDK
   (`codex-cli.adapter.ts:640` — `codex.resumeThread(options.resumeSessionId, …)`),
   whose rollouts are not there. The probe can never find a Codex thread id.
2. **Throws instead of returning false.** `fs.access` at line 1098 is unguarded.
   The caller at lines 804-812 expects a boolean and logs "starting fresh" on
   `false`. The rejection escapes to the outer catch at line 830, which returns
   `{ success: false, error }`, and `agent-continue-input.component.ts:278`
   renders the raw Node message.
3. **Same hazard on `readdir`** at line 1080 when `~/.claude/projects` is absent,
   and `resumePtahCliSession` at line 875 calls the same throwing helper.
4. **A quieter second defect.** A bare `try/catch` alone would take the
   "starting fresh" path and call `spawn` with `resumeSessionId: undefined`.
   `codex-cli.adapter.ts:642` then calls `codex.startThread()` — a "successful"
   resume that silently drops the whole conversation. Swallowing the throw
   without making the probe vendor-aware converts a loud failure into a silent
   data loss.

## Why no test caught it

`agent-rpc.handlers.resume-parent-session.spec.ts:244` sets
`mockAccess.mockResolvedValue(undefined)`. Every existing test makes the session
file exist. The rejection path has no coverage at all.

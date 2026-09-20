# Context — unreaped child process trees

## Root insight

This repository largely replaced `shell: true` with `cross-spawn`. On Windows,
cross-spawn IS a shell wrapper for `.cmd` and `.bat` targets: it routes through
`cmd.exe /d /s /c <wrapper>`. Several files document that in their own header
comments and still terminate with a single-process `child.kill()`. The
grandchild survives. A developer machine accumulated 14 orphaned processes in
one session.

## The fix pattern — it already exists here, do not invent one

```ts
void child.whenSpawned.then((pid) => {
  if (pid && !child.killed) {
    void killProcessTree(pid);
  }
});
```

Correct usage:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:342-346`
- `libs/backend/vscode-core/src/utils/exec-git.ts:661-663`

`killProcessTree` is exported from
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44`,
with a local copy at `exec-git.ts:541`. The four rival-CLI adapters already
follow the rule.

## Highest-value suspect — fix first

- `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:98` — spawns
  `npx skills ...` on a 15 s timeout that fires during ordinary slow network
  installs, then kills with `child.kill('SIGTERM')`. The tree is
  `cmd.exe -> node(npx) -> node(skills) -> fetcher`, so roughly three orphans
  per failed attempt. The file header already documents the cmd.exe routing.
  Only the kill was never adjusted.

## Confirmed leaks — no termination path at all

- `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:79-82`
  — the only production `shell: true`. Spawns `clip` / `pbcopy` / `xclip`. No
  kill path, no timeout. `xclip` is known to stay resident.
- same file `:43-48` — `cmd /c start "" <url>` browser launch. No kill path, no
  timeout.
- `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.ts:49-53` —
  `detached: true` + `unref()` with no retained handle, on the OAuth retry path.
  Lower severity: `detached` is defensible here, the missing handle is not.

## Further suspects — timeout-driven `child.kill()` over cross-spawn

- `libs/backend/cli-agent-runtime/.../toolchain-probe.ts:115`
- `libs/backend/cli-agent-runtime/.../cli-adapter.utils.ts:438` (`probeCliVersion`)
- `libs/backend/cli-agent-runtime/.../claude-cli-detector.ts:707`

Two probes with no termination path, lower risk because `where` / `which` / `ps`
essentially cannot hang:

- `libs/backend/cli-agent-runtime/.../claude-cli-path-resolver.ts:222`
- `libs/backend/cli-agent-runtime/.../process-start-time.probe.ts:269`

## Full audit

`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97\.ptah\specs\TASK_2026_479_4e71\child-process-audit.md`
(read-only, in another worktree). It holds the SAFE list and the method.

## Not in scope

The firecrawl MCP orphans. Those are spawned by `claude.EXE` from `.mcp.json`,
not by this repository, which never receives their PIDs. Settled in
TASK_2026_479 and marked blocked. Do not chase it. Do NOT add any sweeper that
enumerates system processes on a timer.

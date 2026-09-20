# Context — an unbounded test run starves the running app

## The measurement

Taken 2026-09-20 on a 16 logical core host, while the user reported UI lag in
Ptah with 7 sessions open. Task Manager attributed 60.4% CPU and 11,210.9 MB to
"Node.js JavaScript Runtime (18)".

Enumerating `node.exe` by command line identified the population:

| Count | Process | Memory each |
|---|---|---|
| 15 | `jest-worker/build/processChild.js` | 207-393 MB sampled, 730-790 MB at peak |
| 4 | `nx/src/daemon/server/start.js` (one per worktree) | 21-122 MB |
| 10 | `firecrawl-mcp` | 1-6 MB |

All 15 Jest workers shared parent PID 16576, `nx/bin/run-executor.js`, under a
single `nx run-many -t test -p @ptah-extension/platform-electron`.

**One project's test run held 15 workers and roughly 10.5 GB.** Ptah itself was
1,191 MB across 7 processes. The MCP servers totalled under 30 MB.

## Why 15

Jest defaults `maxWorkers` to `cores - 1`. This host has 16 logical cores.
15 workers is the default, not a misconfiguration by the caller.

Nx gives every project its own Jest invocation, so the project's own
`jest.config.ts` is the root config for that run. A `maxWorkers` set in the
shared preset therefore applies.

## Why it presents as UI lag

The Electron renderer and the test workers compete for the same cores. A
developer running a suite in one worktree while working in Ptah sees the app
stall, and nothing in the app is at fault. This is separate from the renderer
defect fixed in TASK_2026_482, and it would have made that defect feel worse.

## Scope

Set `maxWorkers: '50%'` in `jest.preset.js`.

Out of scope: the Nx `parallel` setting, which multiplies this by the number of
projects Nx runs at once. It is a real factor and it deserves its own
measurement rather than a guess.

## Prior art in the repository

`apps/ptah-cli/jest.pty.config.cjs:34` and `apps/ptah-cli/jest.e2e.config.cjs:40`
both pin `maxWorkers: 1`, because a pty binds a real console. They set the value
explicitly, so the new preset default does not reach them.

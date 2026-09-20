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

## The second measurement — `parallel` multiplies it

Taken later the same day, after the first fix was committed. A second run was
sampled, this time in the MAIN checkout, which does not carry the preset fix:

```
PID 16108  nx run-many -t test -p @ptah-extension/rpc-handlers ...
  +-- PID 22356  run-executor.js
  +-- PID 21328  run-executor.js
  +-- PID 28884  run-executor.js
```

74 `node.exe` processes, most of them `jest-worker/processChild.js` holding 675
to 1,014 MB each.

Three executors is the Nx `parallel` default. **Nx `parallel` and Jest
`maxWorkers` multiply**: 3 tasks x up to 15 workers is up to 45 worker
processes on a 16-core host. Capping workers alone would have left 24, still
more than the machine has.

So `parallel` is not a secondary factor, and the first fix was incomplete
without it.

## Scope

1. Set `maxWorkers: '50%'` in `jest.preset.js`.
2. Set `"parallel": 2` in `nx.json`.

Both are LOCAL defaults only. `.github/workflows/ci.yml:175` passes
`--parallel=3 --maxWorkers=2` explicitly, and a CLI flag beats a config value,
so CI keeps the numbers TASK_2026_404_edeb measured for a 4-core runner. That
matters: `'50%'` of a 2-core runner is 1.

## What this does NOT fix

A repository default bounds ONE invocation. It cannot bound seven of them. The
host that produced these numbers was running three concurrent test and lint
runs across different worktrees, and each one is entitled to its own budget.
Limiting concurrent sessions is a workflow question, not a config value.

## A correction to the first measurement

The first version of this document implied that capping workers trades speed
for headroom. `.github/workflows/ci.yml:159-163` measured the opposite on the
CI half of the same problem: cli-engine coverage went from 16.9 s to 9.2 s at
`--maxWorkers=2`, and agent-sdk from 17.2 s to 8.1 s. An oversubscribed pool
spends its time context-switching. Capping is faster here, not a trade.

## Prior art in the repository

`apps/ptah-cli/jest.pty.config.cjs:34` and `apps/ptah-cli/jest.e2e.config.cjs:40`
both pin `maxWorkers: 1`, because a pty binds a real console. They set the value
explicitly, so the new preset default does not reach them.

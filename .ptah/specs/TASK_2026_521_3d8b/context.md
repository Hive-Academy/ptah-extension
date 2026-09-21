# Context

## How this was found

`TASK_2026_496_fc4a` is the Gate 0 spike for the MCP Apps host work. Its verdict is **PASS**,
but the PASS carries one mandatory condition, proved by experiment in its assertion A6:

> the session must set `strictMcpConfig: true`. Without it, a settings-file server with the same
> name starts a SECOND upstream process, silently, and takes over the name.

Read `.ptah/specs/TASK_2026_496_fc4a/spike-report.md` before starting. The spike is runnable;
`spike/run-collision.mjs` is the experiment that produced this finding.

## The defect

```text
grep -rn "strictMcpConfig" --include=*.ts libs apps
  → no matches
```

Measured on `origin/main` at `702c41413`, 2026-09-21. The option is never set anywhere, so every
session runs with the permissive default.

## Why it matters

Two upstream connections to one stdio MCP server is the design the engineering critique of
`TASK_2026_490_583c` rejected outright, and for reasons that apply regardless of the apps
feature:

- Two processes mean two separate memories, so state written through one is invisible to the
  other.
- Lock files and fixed ports collide.
- OAuth tokens refresh twice, and the two refreshes can invalidate each other.
- Rate limits are consumed at twice the expected rate.
- The second connection is a second authorization path, and it does not pass through
  `canUseTool`.

The last point is the serious one: it is an authorization bypass, not a performance problem.

## What is not yet known

The spike proved the behaviour against a fake server it controlled. It did **not** establish
whether a user of Ptah can reach this state today, on `main`, without the broker that
`TASK_2026_496_fc4a` prototyped. Answer that first, because it decides the severity:

- If a name collision between a settings-file server and a programmatically registered server is
  already reachable today, this is a live defect.
- If it becomes reachable only once the broker exists, this is a precondition to enforce before
  that work lands.

Record the answer with evidence either way. Do not assume the worse case, and do not assume the
better one.

## Acceptance criteria

1. State, with evidence, whether the collision is reachable on `main` today.
2. Set `strictMcpConfig: true` where the session options are built. Start from
   `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, which already handles
   `mcpServers` and `settingSources`. Verify the line numbers yourself; they move. The collision
   test in criterion 4 must exercise this exact value, not merely check that the option is set.
3. Decide what happens to a settings-file server that the new setting excludes. Silently
   dropping a server the user configured is its own defect. Either surface it, or document why
   silence is correct.
4. A test pins the collision behaviour: a settings-file server with the same name as a
   programmatically registered one must not produce a second upstream process. Fail closed.
5. Confirm the change does not break a legitimate settings-file server with no collision. That
   is the common case and it must keep working.

## Source

`.ptah/specs/TASK_2026_496_fc4a/spike-report.md`, the PASS condition and assertion A6.
`.ptah/specs/TASK_2026_490_583c/critique-engineering.md`, the rejection of the two-connection
design.

# TASK_2026_274 — collapse the subprocess probes

Raised by the code-style review of TASK_2026_270 (commit `9334758c5`).

## Why not a port

I proposed an `IProcessRunner` port during TASK_2026_270. The style reviewer
argued against it and was right: a port earns its keep when behaviour varies per
platform, and here it does not — Electron main, the CLI and the VS Code extension
host are all plain Node processes running the same `cross-spawn` call. A port
would add DI ceremony and a registration site per host to hide a difference that
does not exist.

## Why cross-spawn and not node:child_process

Node 18.20+ / Electron 30+ refuse `execFile` on Windows `.cmd` shims
(CVE-2024-27980), and `python` on Windows frequently is one. Keep `cross-spawn`;
the point of this task is one implementation, not a different one.

## Call sites

- `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts` —
  its header already names itself as the single place to change if a shared
  utility ever lands. This is that landing.
- `libs/backend/cli-agent-runtime/src/lib/.../cli-adapter.utils.ts:202-230`
  (`probeCliVersion`, `spawnCli`).

## Constraint

`platform-core` is meant to stay interface-only for ports. This is deliberately
NOT a port — a concrete utility living alongside them. Say so in the code
comment, or the next reviewer reading `platform-core`'s CLAUDE.md will flag it as
a layering violation.

## Behaviour to preserve

`toolchain-probe` treats an unparseable version as `satisfiesMin: false` even
when `installed` is true — scaffolding against an unknown SDK is worse than
asking. That is a deliberate choice, not an accident of the implementation.

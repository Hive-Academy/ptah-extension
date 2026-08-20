---
id: TASK_2026_297
status: in_review
type: bugfix
title: >-
  `ptah agent-cli resume` has never worked — the one value its allowlist
  permits is the one value the backend cannot route
description: >-
  `CLI_AGENT_ALLOWLIST = ['glm']` makes `glm` the only accepted `--cli` value
  for the whole `ptah agent-cli` command group, and `glm` is not a member of
  `CliType` — which is why the call site casts it through
  `as unknown as CliType`. Downstream, `AgentProcessManager` resolves the CLI
  via `detectAll().find(r => r.cli === cli)`, `glm` matches nothing, and it
  throws "glm CLI is not installed". The command has no reachable success path
  and never has. GLM is a `ptah-cli` PROVIDER selected by `ptahCliId`, not a
  system CLI binary, and the backend already implements that path completely,
  including default-provider resolution. The same command also sends
  `task: opts.task ?? ''` — the same invent-a-value defect TASK_2026_296 exists
  to remove. Documented in four places including a skill that ships to users,
  and its only spec mocks the RPC, so nothing ever exercised the failure.
---

# `ptah agent-cli` speaks a vocabulary the backend does not

Machine-owned metadata carrier. Prose lives in `./context.md`.

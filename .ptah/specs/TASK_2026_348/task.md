---
id: TASK_2026_348
status: done
type: BUGFIX
title: 'Remove the DEP0190 shell:true child_process spawn with unescaped args'
depends_on: []
created: '2026-08-28T18:55:20.159Z'
updated: '2026-08-29T02:10:01.269Z'
description: >-
  Node emits "[DEP0190] Passing args to a child process with shell option true
  can lead to security vulnerabilities" (log.log:548) right after MCP server
  start / license check, most likely from CLI detection of Windows .CMD shims
  (codex.CMD, copilot.CMD at log.log:897-898). Find every spawn/exec with
  shell:true plus an args array, and replace with shell:false + resolved
  executable, or a single properly quoted command string. Add a test that
  asserts no shell:true+args combination remains in cli-agent-runtime /
  auth-providers / vscode-lm-tools.
executor: backend-developer
estimate: S
labels:
  - security
  - cli-agent-runtime
  - windows
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Node emits "[DEP0190] Passing args to a child process with shell option true can lead to security vulnerabilities" (log.log:548) right after MCP server start / license check, most likely from CLI detection of Windows .CMD shims (codex.CMD, copilot.CMD at log.log:897-898). Find every spawn/exec with shell:true plus an args array, and replace with shell:false + resolved executable, or a single properly quoted command string. Add a test that asserts no shell:true+args combination remains in cli-agent-runtime / auth-providers / vscode-lm-tools.

Full context, plan and discussion live in [./context.md](./context.md).

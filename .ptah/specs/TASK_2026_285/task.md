---
id: TASK_2026_285
status: done
type: feature
title: >-
  Antigravity can host a user's MCP server and Ptah has no way to say so — add
  the sixth install target, without the two writers fighting over one file
description: >-
  `McpInstallTarget` is type-locked to `vscode | claude | cursor | copilot |
  codex`, so an intent in `~/.ptah/mcp-installed.json` cannot name antigravity
  and the reconciler has no facet for it. The justification in
  `harness-sync/CLAUDE.md` — "user-installed servers are not offered for `agy`
  by the install surface, so there is no intent to reconcile" — is circular:
  they are not offered because the type forbids expressing them. `agy` reads
  `~/.gemini/config/mcp_config.json`, and `AntigravityCliAdapter` already writes
  Ptah's OWN server into that exact file before every spawn and removes it after
  `done`. That is what makes this more than a one-line union edit: adding a
  facet puts a second writer on a file an unlocked read-modify-write already
  touches on every spawn, so the adapter's cleanup must be unable to delete a
  user's server and a concurrent spawn must be unable to lose one.
updated: '2026-08-25T21:15:31.064Z'
---

# Antigravity as an MCP install target

Machine-owned metadata carrier. Prose lives in `./context.md`.

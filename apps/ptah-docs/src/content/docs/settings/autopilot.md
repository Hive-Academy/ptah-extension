---
title: Autopilot
description: Configure how autonomously agents can act without asking.
---

import { Aside } from '@astrojs/starlight/components';

Autopilot controls how much an agent can do on your behalf without pausing for approval. All settings are off by default — Ptah asks before touching anything that writes to disk or runs a shell command.

## Where it lives

**Settings → Autopilot**, or `autopilot` block in `~/.ptah/settings.json`:

```json
{
  "autopilot": {
    "enabled": false,
    "autoApproveReads": true,
    "autoApproveWrites": false,
    "autoApproveShell": false
  }
}
```

## Toggles

| Toggle              | Effect when enabled                                                                |
| ------------------- | ---------------------------------------------------------------------------------- |
| `enabled`           | Master switch. When `false`, every other toggle is ignored and all actions prompt. |
| `autoApproveReads`  | Allow `Read`, `Glob`, and `Grep` without prompting. Safe for almost all workflows. |
| `autoApproveWrites` | Allow `Write` and `Edit` to workspace files without prompting.                     |
| `autoApproveShell`  | Allow `Bash` / `PowerShell` commands without prompting. **High risk.**             |

<Aside type="caution">
`autoApproveShell` lets agents run arbitrary commands on your machine. Only enable it inside throwaway environments (dev containers, VMs) or when you fully trust the agent configuration.
</Aside>

## Per-session override

Each chat has an "Autopilot" toggle in its header. It inherits the global setting but can be disabled for a single session — useful when you want tighter oversight on a production workspace.

## Hooks

Approval prompts are themselves hooks. You can override the behavior per-workspace by adding a `permissions` block to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Read", "Grep", "Glob"],
    "deny": ["Bash(rm*:*)"]
  }
}
```

Workspace permissions are merged with global autopilot settings. A `deny` rule always wins over an autopilot allow.

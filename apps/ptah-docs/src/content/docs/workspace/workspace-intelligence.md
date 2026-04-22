---
title: Workspace Intelligence
description: How Ptah auto-gathers context about your project and feeds it to agents.
---

# Workspace Intelligence

**Workspace intelligence** is the context layer that sits between your project and the agents working on it. It's why Ptah agents start conversations knowing your stack, conventions, and current state — without you having to paste anything.

## What gets gathered

Every time an agent spawns in a workspace, Ptah automatically attaches:

| Source                 | Content                                                   | Refreshed             |
| ---------------------- | --------------------------------------------------------- | --------------------- |
| **Project structure**  | Top-level layout, key folders, monorepo boundaries        | On workspace change   |
| **Dependencies**       | Direct deps from `package.json`, `requirements.txt`, etc. | When manifest changes |
| **Tech stack summary** | Languages, frameworks, versions (from analysis)           | After each analysis   |
| **Recent files**       | Files you've opened or edited in the last session         | Continuously          |
| **Git state**          | Current branch, last commit, dirty file count             | Real-time             |
| **Enabled plugins**    | Plugin agents/skills active for this workspace            | On config change      |
| **Open chat context**  | Files referenced in the active chat                       | On message send       |

## Why this matters

Two concrete examples:

1. You open a chat in an Angular project and ask _"Add a loading spinner to the dashboard."_ The agent already knows it's Angular 20 with signals, reads the existing dashboard component, and produces a signals-based patch — not a React component, not an old-style `BehaviorSubject` pattern.

2. You switch to a different branch. The next agent invocation sees the new branch name and the different set of dirty files, so it doesn't hallucinate code from the branch you just left.

## Inspecting what the agent sees

To see the exact context bundle passed to an agent for a given run, use **Chat → Show context** in the message overflow menu. The context panel shows each source and lets you toggle any of them off for the next message.

![Context inspector](/screenshots/context-inspector.png)

## Manual overrides

You can pin extra files or notes to the workspace context through `.ptah/context.md`. Anything in that file is appended to every agent invocation in the workspace.

```markdown
# .ptah/context.md

## Conventions

- All new services go under `libs/shared/services/`
- Prefer Zod for input validation, not `class-validator`
- Test files use `.spec.ts`, never `.test.ts`
```

:::tip
Keep `.ptah/context.md` short. It's prepended to every message, so bloating it costs tokens on every turn. Use it for hard rules the agent should never forget; use chat for everything else.
:::

## Privacy

Workspace intelligence is gathered locally and only sent to the provider you've configured for the active chat. Ptah never uploads your analysis cache to its own servers.

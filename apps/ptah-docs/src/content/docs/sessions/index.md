---
title: Session Management
description: How Ptah persists, organizes, and analyzes every AI conversation.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Session Management

Every conversation you have with Ptah is a **session** — a persistent, on-disk record of messages, tool calls, agent handoffs, and metadata. Sessions never disappear when you close the app, never fight over context, and can be searched, analyzed, and resumed weeks later.

![Sessions overview](/screenshots/sessions-overview.png)

## Why sessions matter

- **Nothing is lost.** Close your laptop mid-refactor; reopen it tomorrow; the chat is right where you left it.
- **Context stays isolated.** A session for "add dark mode" doesn't get polluted by your "debug payment webhook" chat.
- **Work is measurable.** Token counts, costs, and quality scores roll up per session so you can see what's actually happening.
- **History is yours.** All transcripts live locally on disk. No cloud required.

## Where sessions live

```
<workspace-root>/.ptah/sessions/
```

Each session is a JSON file containing the full transcript plus a sidecar metadata record. Sessions are scoped to the workspace they were created in, so switching workspaces swaps the session list.

## What's in this section

<CardGrid>
  <Card title="Managing sessions" icon="list-format">
    Create, switch, rename, and delete sessions. [Learn more →](/sessions/managing-sessions/)
  </Card>
  <Card title="Session history" icon="document">
    Browse, search, and filter past conversations. [Learn more →](/sessions/session-history/)
  </Card>
  <Card title="Analytics" icon="bars">
    Performance metrics, quality scores, and trend charts. [Learn more →](/sessions/analytics/)
  </Card>
  <Card title="Cost summary" icon="pencil">
    Tokens, dollars, and duration at a glance. [Learn more →](/sessions/cost-summary/)
  </Card>
  <Card title="Auto-import" icon="download">
    Restore sessions from `~/.claude/projects/`. [Learn more →](/sessions/auto-import/)
  </Card>
  <Card title="Metadata" icon="information">
    Every field Ptah tracks per session. [Learn more →](/sessions/metadata/)
  </Card>
</CardGrid>

## Quick tips

:::tip

- Start a **new session** for each distinct task. It keeps context tight and makes history browsable.
- Use the **tab bar** to switch quickly between active sessions without losing scroll position.
- Commit `.ptah/sessions/` to a private repo if you want shared team history; leave it out of git for personal privacy.
  :::

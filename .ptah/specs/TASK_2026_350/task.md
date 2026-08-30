---
id: TASK_2026_350
status: done
type: BUGFIX
title: >-
  chat:continue must intercept slash commands before the idle resume, not resume
  then kill the query
depends_on: []
created: '2026-08-28T18:55:27.910Z'
updated: '2026-08-29T02:10:02.677Z'
description: >-
  For "/orchestrate asset-audit" chat:continue resumed the inactive session in
  idle+streamInput mode (log.log:2313-2317), then the SlashCommandInterceptor
  fired (log.log:2320), ended the just-started session, waited on "Interrupt
  timed out (5s)" (log.log:2335) and started a second query (log.log:2350);
  handler took 8524ms (log.log:2354). Detect the slash command before the resume
  decision. Also handle the replayed user message that SdkMessageTransformer
  logs as "Unknown message type" with <command-message> content and
  isReplay:true (log.log:2376).
executor: backend-developer
estimate: M
labels:
  - agent-sdk
  - rpc-handlers
  - chat
  - performance
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

For "/orchestrate asset-audit" chat:continue resumed the inactive session in idle+streamInput mode (log.log:2313-2317), then the SlashCommandInterceptor fired (log.log:2320), ended the just-started session, waited on "Interrupt timed out (5s)" (log.log:2335) and started a second query (log.log:2350); handler took 8524ms (log.log:2354). Detect the slash command before the resume decision. Also handle the replayed user message that SdkMessageTransformer logs as "Unknown message type" with <command-message> content and isReplay:true (log.log:2376).

Full context, plan and discussion live in [./context.md](./context.md).

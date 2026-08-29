---
id: TASK_2026_349
status: in_review
type: BUGFIX
title: Do not send the 1M-context beta header when auth method is Claude CLI
depends_on: []
created: '2026-08-28T18:55:23.717Z'
updated: '2026-08-28T18:55:23.717Z'
description: 'SdkQueryOptionsBuilder logs "Enabling 1M context beta for Anthropic direct" (log.log:2312,2349) while authMethod is claudeCli; the CLI then prints "Warning: Custom betas are only available for API key users. Ignoring provided betas." (log.log:2331,2365). Gate the beta on an actual API-key/auth-token credential, and cover with a unit test for claudeCli, apiKey and authToken paths.'
executor: backend-developer
estimate: XS
labels:
  - agent-sdk
  - auth
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

SdkQueryOptionsBuilder logs "Enabling 1M context beta for Anthropic direct" (log.log:2312,2349) while authMethod is claudeCli; the CLI then prints "Warning: Custom betas are only available for API key users. Ignoring provided betas." (log.log:2331,2365). Gate the beta on an actual API-key/auth-token credential, and cover with a unit test for claudeCli, apiKey and authToken paths.

Full context, plan and discussion live in [./context.md](./context.md).

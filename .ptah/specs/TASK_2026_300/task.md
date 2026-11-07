---
id: TASK_2026_300
status: backlog
type: feature
title: >-
  Enrich the markdown renderer: bare file references and fenced-diff upgrades
updated: 2026-11-07T00:00:00.000Z
description: >-
  Markdown links that name a file are now clickable. Add the remaining recognized-pattern
  upgrades in `libs/frontend/markdown`: bare `path:line` references in prose and fenced diffs
  styled like `diff-display`. Gate them on the `'full'` preset; do not give the agent new tools.
---

# Enrich the markdown renderer, not the agent

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Upgrade recognized patterns in rendered agent markdown, with no agent tools (the tool-based
alternative was rejected, see `context.md`). Remaining work:

1. Bare file references: make a `path:line` in prose or inline code clickable, through the
   existing file-link capture (`libs/frontend/markdown/src/lib/markdown-file-links.ts`,
   `file-link-target.ts`). Today only a markdown link whose target names a file is upgraded
   (`marked-extensions.ts:346-357`).
2. Fenced diffs: render a ```` ```diff ```` block with the `diff-display` styling from
   `libs/frontend/chat-ui`.
3. Tables (sortable or expandable) stay deferred.

Constraints that still hold:

- Extensions emit HTML strings and DOMPurify `FORBID_ATTR` strips event handlers
  (`provide-markdown-rendering.ts:253-276`). Use event delegation over `data-*` attributes; do
  not relax the sanitizer.
- Gate every enrichment on the `'full'` preset (Electron renderer,
  `apps/ptah-extension-webview/src/app/app.config.ts:480`). The `'basic'` preset (landing page,
  `apps/ptah-landing-page/src/app/app.config.ts:30`) and the `'member'` preset get none.

## Current state (2026-11-07)

- Done: markdown links that name a file are captured and opened in the Ptah viewer
  (`3bd2e310e`, `cf8bac264`). `getMarkedExtensions()` now returns six extensions, including
  `createFileLinkExtension` (`marked-extensions.ts:396-405`).
- Not done: bare `path:line` upgrade and fenced-diff upgrade.
- The "WEB product (forum posts, lesson comments)" named in the old description is now the
  `'member'` preset in `provide-markdown-rendering.ts:18-28`.

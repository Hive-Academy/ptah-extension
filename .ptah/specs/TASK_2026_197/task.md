---
id: TASK_2026_197
status: done
type: FEATURE
title: Output-style surface — discover, choose, create, and edit Claude Code output styles inside Ptah
description: >-
  Claude Agent SDK v0.3.150 supports output styles — markdown files with a strict
  four-key frontmatter schema, loaded from `~/.claude/output-styles/` and
  `<project>/.claude/output-styles/`, activated through the merged settings key
  `outputStyle`. Ptah has zero code for this today (`outputStyle` has no matches
  anywhere in libs/ or apps/). Ptah already passes
  `settingSources: ['user','project','local']` at
  sdk-query-options-builder.ts:679, so styles already resolve — but users must
  hand-edit files. This task adds a first-class Ptah surface — a backend
  discovery/parse/CRUD service behind platform-core ports, an RPC namespace, and
  an Angular picker plus editor that works in both the VS Code webview and
  Electron.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

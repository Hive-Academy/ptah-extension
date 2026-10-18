# Context - TASK_2026_695_3fdb

## User request (2026-10-18)

> ship this pr and target s1 in a new pr after we merge that pr

PR #753 (TASK_2026_691_1da5) merged 2026-10-18 15:39 UTC. This task is review item S1 from
`TASK_2026_691_1da5/code-logic-review.md`.

## Problem (S1)

The Command Center shows a provider mark per session (`ptah-provider-mark`, monogram fallback).
For the root and child tabs the provider comes from
`libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`
`tabProvider()`: first `tab.liveModelStats.contextCapacity.providerId`, else the
`tab.sessionStats.modelUsageList` row whose `model` matches the tab's own model.

A session restored from history has no live stats, and the history reader writes no provider:
`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1155` ("Transcripts do not
carry historical provider capacity evidence"). So a restored session always shows a monogram.
The tab type (`libs/frontend/chat-types/src/lib/chat-types.ts`, `TabState`) has no provider field.

## Goal

A restored session shows the provider it actually ran on. Record the provider when the session
runs (the backend knows the active provider then), persist it with the session's metadata, and
return it when the session is resumed / listed, so the frontend can use it as the last fallback
in `tabProvider()`. Never guess the provider from today's active provider for an old session.

Out of scope: the canvas scene, the start view of TASK_2026_694 (PR #757; it may later use the
same field for its cards, but not in this PR).

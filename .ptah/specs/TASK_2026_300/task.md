---
id: TASK_2026_300
status: backlog
type: feature
title: >-
  Enrich the markdown renderer, not the agent — clickable file references and
  recognized-pattern upgrades behind the existing XSS chokepoint
description: >-
  Every coding agent's answer is text, and Ptah renders that text as flat
  markdown while owning 52 components in `libs/frontend/chat-ui` the agent can
  never address — `diff-display` renders when `Edit` executes, never when the
  agent wants to show a change it is proposing; `file-path-link` exists as an
  atom but a `path:line` in prose is grey text. The obvious fix — giving the
  agent tools that emit components — was evaluated and REJECTED: tool definitions
  cost roughly 150-400 tokens each on every request for the session's life, JSON
  args run about 1.5-2x the tokens of equivalent markdown for read-only content,
  and a satisfying output ritual substitutes for doing the work. The version
  worth building does not involve the agent at all. `marked-extensions.ts`
  already carries five extensions (callouts, code-block headers, dividers,
  headings, list cards), so upgrading recognized patterns is the established
  mechanism here rather than a new one — at zero tool definitions, zero output
  tokens, zero attention cost, and zero regression risk, since unrecognized
  markdown renders exactly as it does today. Two constraints shape the design and
  neither is optional: marked extensions emit HTML STRINGS and DOMPurify's
  `FORBID_ATTR` strips every event handler, so interactivity must be event
  delegation over `data-*` attributes (`ALLOW_DATA_ATTR` is already true — no
  sanitizer relaxation, per that lib's guideline 2); and `MarkdownBlockComponent`
  is shared with the WEB product (forum posts, lesson comments), where a
  clickable editor link is a broken affordance, so every enrichment must be gated
  on the existing `'full'` / `'basic'` preset split.
---

# Enrich the markdown renderer, not the agent

Machine-owned metadata carrier. Prose lives in `./context.md`.

---
status: in_review
type: bugfix
title: Cost and token display reports zero instead of the truth
description: >-
  Three defects make the chat header report a cost of $0.0000 and a token count
  of 0 while the session is billing normally. One is fixed. Two remain: a null
  price coerced to 0 on the replay path, and an empty stats payload emitted at
  session resume that overwrites a correct value.
labels:
  - pricing
  - agent-sdk
  - chat-streaming
---

# Cost and token display reports zero instead of the truth

The pricing math is correct. The display path destroys the result in three
places. Evidence, reproduction and file:line references are in `context.md`.

## Acceptance criteria

1. An unknown model price renders as "cost unavailable", never as `$0.0000`.
2. A stats payload that carries no usage never overwrites a populated header.
3. The removed validation ceilings stay removed, pinned by tests.
4. `test`, `typecheck` and `lint` pass for every touched project.

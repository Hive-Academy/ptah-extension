---
id: TASK_2026_295
status: done
type: bugfix
title: >-
  The empty string is a third session-identity state nothing intends, and half
  the codebase reads it as "this session" while the other half reads it as "all
  sessions"
description: >-
  `''` is neither a session id nor the absence of one, yet it is minted in at
  least two places and flows through hooks, the subagent registry, RPC filters,
  MCP spawn attribution, the Angular routing predicates and SQLite. Consumers
  disagree about what it means: `getBackgroundAgents('')` and
  `chat:subagent-query` with `''` read it as "no filter" and return every
  session's agents, while `agentsForSession('')` reads it strictly and returns
  none — so one agent is simultaneously visible in every tab and in no tab.
  `??` chains treat it as present (it is not nullish) and then truthiness tests
  discard it, so fallbacks that exist specifically for this case never fire —
  which is why steering or stopping an interrupted subagent fails with "No
  active session" while a valid session is active. Worst case,
  `chat-ptah-cli.service.ts` builds a transcript path with an empty segment,
  `path.join` collapses it silently, and the caller responds to the resulting
  false by calling `markAsInjected` + `remove`, permanently destroying the
  resume opportunity. Parent task for the sweep that stops `''` being minted,
  makes every consumer state its intent explicitly, and then widens the two
  shared declarations that force `''` to be expressible at all.
---

# Empty session ids: stop minting them, then make them unrepresentable

Machine-owned metadata carrier. Prose lives in `./context.md`.

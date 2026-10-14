# Context
Source: HANDOFF.md follow-up 6 (PR 725 review, Moderate).
- `autopilot-state.service.ts` keeps per-session write counters in a map that is never pruned.
  Long-running hosts grow the map by one entry per session.
- Expected: delete the entry on session release; add a spec.

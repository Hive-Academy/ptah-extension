# Context
Source: HANDOFF.md follow-up 3 (PR 724 review).
- The MCP tool schema bounds `prompt` and `label` length for session handoff, but the
  `ptah.session.handoff` namespace of `execute_code` calls the same service without these bounds.
- Expected: one shared validator (zod) used by both entry points.

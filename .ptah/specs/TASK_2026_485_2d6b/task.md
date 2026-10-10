---
status: done
type: bugfix
title: Stop sending undefined own keys to the electron state worker
description: >-
  saveAgentOutput builds a literal with three optional fields, so an absent
  field becomes an own key holding undefined and the worker protocol rejects the
  message. The failure is deterministic and must not be retried.
updated: '2026-10-10T18:18:03.756Z'
---

# Stop sending undefined own keys to the electron state worker

Use conditional spreads in the `saveAgentOutput` literal, stop retrying this
deterministic failure, and rename the misleading "non-cloneable" guard message.

See `context.md` for the measured evidence.

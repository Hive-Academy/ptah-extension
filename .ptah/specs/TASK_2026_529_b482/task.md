---
id: TASK_2026_529_b482
status: backlog
type: BUGFIX
title: >-
  Filled badge-success and badge-info fail WCAG AA in the anubis theme, and
  anubis-light was never audited
description: >-
  In the default anubis theme the success token is #16a34a and the info token
  is #3b82f6. Both pair with a success-content and info-content of #e8e6e1. The
  measured contrast is 2.64 to 1 for success and 2.95 to 1 for info. WCAG AA
  requires 4.5 to 1 for normal text and 3 to 1 for large text and user
  interface components. Both fail for normal text and success also fails the 3
  to 1 bar. Every filled badge-success and badge-info already rendered in the
  product is affected, so this is a live accessibility defect and not a future
  risk. The anubis-light theme uses a different token set and was never
  measured at all.
---

# Filled badge-success and badge-info fail WCAG AA in anubis

See `context.md`.

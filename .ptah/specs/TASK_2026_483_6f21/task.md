---
status: in_review
type: devops
title: Offline maintenance script to drain the observation queue backlog
description: >-
  171,524 processed observation_queue rows holding 878 MB of a 1.2 GB database
  cannot drain through runtime retention on a contended host. Provide a bounded
  offline drain to be run with the app closed.
---

Runtime retention is now correct but yields only 50 rows per run under sustained
governor contention, which is 4.8 to 14.3 months for this backlog. An offline
script is the right tool because with the app closed there is no main thread to
protect.

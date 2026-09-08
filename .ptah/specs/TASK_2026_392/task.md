---
id: TASK_2026_392
status: done
type: BUGFIX
title: >-
  CI test step is killed ~150 ms after Nx reports success, and nested Jest
  parallelism runs the affected set 5-10x slower than it needs to
description: >-
  The `main` CI job ends with `##[error]The operation was canceled.` between
  141 and 224 ms after Nx prints `Successfully ran target test for 24
  projects`, on six runs across two pull requests. The step is marked
  cancelled, later steps are skipped, and the job fails while every test
  passed. Two hypotheses are eliminated by measurement. A leaked Jest handle
  is refuted: `--detectOpenHandles --runInBand` finds no handle in cli-engine
  or agent-sdk, the one named handle (a 10 s OpenRouter warmup timer in
  cli-agent-runtime) lives inside a worker Jest force-exits after 500 ms, and
  a 150 ms gap is not a hang. The concurrency rule is refuted from the run
  inventory: no cancelled run has any later run on its pull request, and a
  concurrency cancel would set the run conclusion to `cancelled` rather than
  `failure`. What IS measured is real oversubscription — `--parallel=3` caps
  Nx tasks, not Jest workers, and with no `maxWorkers` anywhere each of the
  three coordinators defaults to `availableParallelism() - 1`, so one runner
  is asked for up to ~45 workers under coverage beside the real child
  processes the cli-engine auth specs spawn. RESOLVED: capping workers to 2 was
  the fix. Every run where Nx succeeded had ended cancelled, 4 of 4; on the
  first run carrying the cap both pull requests passed, #468 in 10m17s, and
  both merged. The peak load sits at the END of a run, which is why the kill
  always landed at the finish line and only on the successful path — a failing
  run tears down before reaching it.
executor: devops-engineer
estimate: M
labels:
  - ci
  - jest
  - nx
relates_to: []
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Evidence, eliminated hypotheses, teardown defects found along the way and
ranked recommendations are in [./investigation.md](./investigation.md).

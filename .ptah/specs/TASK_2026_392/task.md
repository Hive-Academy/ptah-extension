---
id: TASK_2026_392
status: in_review
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
  processes the cli-engine auth specs spawn. Capping workers is measurably
  faster, so it ships as a fix on its own merits; whether it also stops the
  kill is the open question this task carries.
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

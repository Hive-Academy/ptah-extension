# Engineering lessons from building Ptah's benchmarks

> **Status:** neither the MCP tool benchmark (TASK_2026_619) nor the memory/skills benchmark (TASK_2026_620) has produced a valid scored result yet. These posts are about how the benchmarks are built and what went wrong, not about how well Ptah or any model performs.

1. [Record/replay cassettes for LLM-backed benchmarks](01-record-replay-cassettes.md): how cassette entries are keyed, why replay never goes live, why record mode does not resume, and the open design decision on a `record-missing` mode.
2. [When the scorecard lies](02-when-the-scorecard-lies.md): four ways the tool benchmark hid its own failures (a baseline that never ran, a false-positive guard, a partial index, a silent skip) and the changes that made them visible.
3. [Long live recordings and timeouts](03-long-recordings-and-timeouts.md): a recording that ran into a 4-hour default timeout at 229 entries, and the options for re-recording.

Related: [cassette charts](../cassette-charts.html) (the 229-entry extraction cassette: drafts per call, kind/type split, salience histogram, top concepts).

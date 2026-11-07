# process-sampler

Measurement tool for remote workers. It samples every process on a Linux host from `/proc`,
groups processes into trees by command-line class, and reports CPU and resident memory per group,
so one run can be compared with another.

## Run

```bash
node tools/process-sampler/src/sampler.js --duration 1800 --out phase-0/amun-pc
```

| Flag               | Default | Meaning                                                                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--duration <sec>` | `60`    | Sampling window. Samples are taken at `0, interval, 2*interval, ...` up to the duration.                                        |
| `--interval <ms>`  | `2000`  | Time between samples.                                                                                                           |
| `--out <file>`     | none    | Writes `<file>.json` and `<file>.md` (a trailing `.json` or `.md` is replaced). The Markdown table is always printed to stdout. |

`SIGINT` or `SIGTERM` ends the run early and still writes the report.

The source is one CommonJS file that uses only Node built-ins. It needs no build and runs on
Node 20 or later, so it can be copied to a worker by itself. It reads `/proc` and nothing else,
and makes no network calls.

Exit codes: `0` success, `1` unexpected error, `2` not Linux (no `/proc`), `64` bad arguments.

## What it measures

- **CPU**: the change in `utime + stime` from `/proc/<pid>/stat` between two samples, divided
  by `CLK_TCK` and the time between the samples (from `/proc/uptime`). The result is a
  percentage of one core, so 250 means two and a half cores. The first sample has no baseline
  and gives RSS only. A process that started after the previous sample counts its ticks from
  its start. A process that exits between two samples loses its last interval.
- **RSS**: field 24 of `/proc/<pid>/stat` times the page size. This is the same counter that
  `statm` reports as `resident`, so the tool does not read `statm`.
- Processes are identified by `pid` plus start time, so a reused pid does not inherit an old
  baseline. A process that exits during a read is skipped.

## Groups

Each process gets one class. The checks run in this order and the first match wins:

| Group           | Matches                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `ptah-worker`   | a `ptah` or `ptah-cli` entry point with `worker` or `interact` in the arguments (the `ptah-cli` app no longer exists in this repo, so this matches only an external binary) |
| `electron`      | `ptah-desktop` anywhere in the command line, or an `electron` binary                                         |
| `cli-lane`      | `codex`, `kimi`, `grok`, `claude` or `gemini` as the binary or the script `node` runs, or their npm packages |
| `nx-jest`       | `nx`, `jest` or `jest-worker` in the first three arguments                                                   |
| `ollama-client` | `ollama` anywhere in the command line                                                                        |
| `other`         | anything else                                                                                                |

A process that matches no class joins its parent's tree. A classified process starts its own
tree unless its parent has the same class. For example, an Electron renderer stays in the
desktop tree, while a `claude` lane that the desktop starts gets a tree of its own, and the
lane's `bash` and `rg` children count toward `cli-lane`. Unclassified chains with no classified
ancestor are `other`.

Per sample, the tool sums CPU and RSS over each group. Over the run it reports mean, p95
(nearest rank) and max per group. These stats cover only the samples in which the group had at
least one process, and `Samples` gives that count. `Max procs` and `Max roots` are the largest
process count and the largest number of separate trees seen in one sample.

## Overhead

The sampler excludes itself from the groups. It reports its own CPU time divided by
`samples x interval`, which is the steady-state share of one core it uses. The limit is 1%. The
report says `within` or `EXCEEDED`, and the JSON has `overhead.withinLimit`. The cost grows with
the number of processes.

## Verify

```bash
npm run verify -- -p process-sampler
```

Specs (`src/sampler.spec.ts`) cover `parseStat`, `classify`, `buildTrees`, CPU deltas,
`aggregate`, Markdown rendering, argument parsing, and the CLI exit codes.

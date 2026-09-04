# Context

## Where this came from

TASK_2026_306 Batch 5 fixed the Electron host's harness boot line. Batch 12
found the VS Code host still had the original defect and **deliberately
declined** to fix it — widening the task a third time was worse than recording
it. This is that record.

## Defect 1 — one host says one thing, the other says another

**Electron, fixed** (`apps/ptah-electron/src/activation/plugin-activation.ts:375-392`):

```ts
`[Ptah Electron] Harness ${verb} (${reason}): sources=${summary.sources}, ` + `detectedTargets=${summary.detectedTargets}/${health.targets.length}, ` + `found=${summary.found}/${summary.expected} (all targets), ` + `${formatClaudeSlice(health)}, ` + `missing=${summary.missing}, foreign=${summary.foreign}, ` + `writeFailed=${summary.writeFailed}`;
```

Aggregate first, from `summarizeHarnessHealth` — the one definition
`harness doctor`, the Marketplace badge and the health push already share. The
claude slice is kept and **labelled**.

**VS Code, unfixed** (`apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294`):

```ts
const claude = health.targets.find((target) => target.target === 'claude');
logger.info('Harness reconciled', {
  reason,
  sources: health.sources,
  expected: claude?.expected ?? 0,
  found: claude?.found ?? 0,
  foreign: claude?.foreign.length ?? 0,
  writeFailed: claude?.writeFailed.length ?? 0,
});
```

One target, under bare field names. The Electron comment at `:359-365` describes
exactly this as the defect the two sites once shared:

> each narrowed to the claude target and printed `found`/`expected` under bare
> field names, while the reconciler's own warn sums all six targets under those
> same names. `found=14/27` beside `found=106/119` from one pass is not a
> disagreement anybody can debug — the two numbers were never measuring the same
> thing.

Fixing one side made the inconsistency _worse_, not better: before, both hosts
were wrong in the same way and at least agreed with each other.

## Defect 1b — the `?? 0` collapse

`claude?.expected ?? 0` renders three distinct facts identically:

| Reality                                     | Rendered |
| ------------------------------------------- | -------- |
| Host never registered the claude target     | `0`      |
| Registered but not detected on this machine | `0`      |
| Registered, detected, nothing desired       | `0`      |

Only the third is a clean pass. The first two are wiring and environment
problems. `formatClaudeSlice` exists specifically to separate them:

```ts
function formatClaudeSlice(health: HarnessHealth): string {
  const claude = health.targets.find((t) => t.target === 'claude');
  if (claude === undefined) return 'claude=not-registered';
  if (!claude.detected) return 'claude=undetected';
  return `claude=${claude.found}/${claude.expected}`;
}
```

The VS Code host still has the `0/0` spelling that hid all three.

## Defect 2 — R4: `formatClaudeSlice` has no spec

A pure function, three branches, no dependencies. Its `0/0` behaviour was an
acceptance criterion of TASK_2026_306 and a named edge case in the review. It is
covered today only incidentally, through whatever exercises the whole boot line.

One spec, three cases:

- target absent from `health.targets` → `claude=not-registered`
- target present, `detected: false` → `claude=undetected`
- target present and detected → `claude=<found>/<expected>`

## The fix, and why the two halves belong together

Move `formatHarnessLine` and `formatClaudeSlice` somewhere both hosts can call
them, and have the VS Code host use them. Then:

- Both boot lines report the same scope, in the same order, with the same names.
- The `?? 0` collapse disappears from the VS Code host for free.
- R4's spec covers both hosts, because there is one formatter to spec.

Watch the host prefix — the Electron version hardcodes `[Ptah Electron]`. That
needs to become a parameter, not a second copy of the function.

## Scope

- One shared formatter, called by both hosts.
- The spec for `formatClaudeSlice` (R4), three cases.
- A spec pinning that the VS Code line leads with the aggregate — otherwise this
  regresses the next time someone edits one host and not the other, which is
  precisely how it got here.

## Out of scope

The reconciler's own WARN. It already sums all six targets and is the scope the
Electron line was aligned _to_. Do not change it to match the hosts.

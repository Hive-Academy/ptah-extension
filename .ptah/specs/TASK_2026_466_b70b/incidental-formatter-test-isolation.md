# Incidental fix — `ptah-cli` formatter spec was not isolated from the environment

Not part of TASK_2026_466. Recorded here because the change rides in this
branch and a reviewer will otherwise ask why an unrelated spec moved.

## What happened

The four-project verification gate went red on a project this task never
touched:

```
FAIL apps/ptah-cli/src/cli/output/formatter.spec.ts
  ● HumanFormatter › writes a colored notification by default
    Expected pattern: /\x1b\[/
    Received string:  "> agent.message {"text":"hi"}"
```

## Cause

`shouldUseColor` (`apps/ptah-cli/src/cli/output/formatter.ts:96`) reads the
AMBIENT environment as well as the `noColor` flag:

```ts
if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') {
  return false;
}
if (process.env['PTAH_NO_TTY'] === '1') return false;
```

**That is correct, and it is not the defect.** `apps/ptah-cli/CLAUDE.md` states
the CLI must respect `NO_COLOR`, `FORCE_COLOR` and `PTAH_NO_TTY`. The Nx
environment on this machine exports `NO_COLOR` — Node says so itself on every
run: `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being
set`.

The spec is the part at fault. It constructs `new HumanFormatter(cap.writer,
{ noColor: false })` and asserts an ANSI escape is present, which makes the
assertion depend on the shell that started jest.

## Proof it is environmental, not a code regression

```
$ npx nx test ptah-cli --skip-nx-cache --testPathPatterns "output/formatter"
Tests: 1 failed, 25 passed, 26 total

$ env -u NO_COLOR npx nx test ptah-cli --skip-nx-cache --testPathPatterns "output/formatter"
Tests: 26 passed, 26 total
```

Same tree, same commit, one environment variable.

## Change

`apps/ptah-cli/src/cli/output/formatter.spec.ts` — a `beforeEach`/`afterEach`
pair on the `HumanFormatter` describe deletes `NO_COLOR` and `PTAH_NO_TTY` and
restores whatever was there. No production file changed.

```
npx nx test ptah-cli --skip-nx-cache
Test Suites: 1 skipped, 67 passed, 67 of 68 total
Tests:       3 skipped, 1018 passed, 1021 total
```

## One note for the record

The figure "ptah-cli 1018 passed" appeared in this task's earlier reporting as a
baseline, carried over from a previous session under a different environment. It
was never re-measured here until now. A baseline taken from a transcript is not
a measurement.

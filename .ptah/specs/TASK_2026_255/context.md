# Context — TASK_2026_255

## What you see

Cards on the Tasks board carrying an amber warning triangle and a `no type`
badge, on tasks whose carrier plainly declares a type. Sixteen of them today.

## The two narrowings disagree

The parser, at `libs/backend/task-specs/src/lib/task-frontmatter.ts:316-330`:

```ts
const typeResult = z.enum(TASK_TYPES).safeParse(rawType);
if (typeResult.success) {
  type = typeResult.data;
} else {
  issues.push({ field: 'type', code: 'invalid_type', ... });
}
```

`z.enum` is case-sensitive, and `TASK_TYPES` is uppercase
(`libs/shared/src/lib/types/task-spec.types.ts:23-32`). So `type: bugfix`
fails, `type` lands as `null`, and an `invalid_type` issue is pushed —
which turns `frontmatterValid` false and renders
`TASK_VALIDATION_CODE_LABELS.invalid_type` at the user: _"The task type is not
one of the recognised types, so no type is shown."_

The doctor, thirteen files away in the same lib
(`task-doctor.service.ts:301-307`):

```ts
/** Narrow a declared string to a `TaskType`, case-insensitively. */
function toTaskType(value: string): TaskType | undefined {
  const upper = value.trim().toUpperCase();
  return (TASK_TYPES as readonly string[]).includes(upper) ? (upper as TaskType) : undefined;
}
```

Two narrowings of one union, in one lib, with opposite answers for the same
bytes. That is the defect — not the case of any particular carrier.

## Why it only bites hand-authored carriers

Both machine write paths are already safe:

- `TaskWriterService.create` / `applyMetadata` take a typed `TaskType`
  (`task-writer.service.ts:29`, `:79`), so TypeScript rejects a lowercase
  literal at the call site.
- The MCP `ptah_task_create` tool constrains the field with
  `enum: [...TASK_TYPES]`
  (`tool-description.builder.ts:54-56`), so an agent going through the tool
  cannot emit one either.

What is left is the path the task-spec contract actively tells agents to use:
writing `task.md` with ordinary file tools. Every one of the sixteen arrived
that way, and they are all recent (234–253), so the rate is roughly "every
carrier authored by hand since the convention settled".

Worth noting the same trap caught the audit that found this. The first sweep
for bad types reported **zero**, because PowerShell's `-notcontains` is
case-insensitive by default; it took `-cnotcontains` to see the sixteen. A
case-insensitive comparison hiding a case-sensitivity bug is the shape of this
whole finding.

## Affected carriers

`TASK_2026_234`, `235`, `237`, `238`, `239`, `240`, `241`, `243`, `245`, `246`,
`247`, `248`, `249`, `250`, `251`, `253`.

(`TASK_2026_252` was the seventeenth and was repaired in `3620b01f9` — it was
written during this session and hit the same trap.)

## Fix direction

**Normalize on read, in the parser**, matching the narrowing the same lib
already ships: uppercase and trim before the enum check, and push no issue when
it then matches. That makes the doctor and the parser agree, and it is the
choice that does not require every future hand-authored carrier to remember a
shouting convention.

Consider whether `status` has the same exposure — it is the other essential
enum, and unlike `type` a failure there EXCLUDES the folder from the board
entirely rather than warning on it, so a lowercase `status: backlog` would make
a task vanish rather than merely lose a badge. Check before assuming; the two
fields are parsed by different code.

Then repair the sixteen. A one-line `Edit` of the `type:` line each, per the
carrier rule — never a whole-file `Write`.

## Verification

- A carrier declaring `type: bugfix` parses to `BUGFIX` with no validation
  issue, and its card shows the type badge rather than the warning triangle.
- `parseTaskFile` and `toTaskType` return the same answer for the same input —
  pinned by a test that feeds both.
- The sixteen carriers listed above render a type on the board.
- Whatever is decided about `status`, it is stated here with evidence rather
  than left open.

## Answer on `status`: same exposure, worse consequence — normalized too

Checked rather than assumed. `status` has the identical case-sensitivity, and
the fix normalizes it alongside `type`.

**Evidence.** The two fields really are parsed by different code, but both by a
case-sensitive `z.enum`:

- `type` — `z.enum(TASK_TYPES)` inline at `task-frontmatter.ts:320` (pre-fix).
- `status` — `STATUS_SCHEMA = z.enum(TASK_STATUSES)` at `task-frontmatter.ts:115`,
  applied at `:270` (pre-fix).

`TASK_STATUSES` is lowercase (`task-spec.types.ts:13-20`) while `TASK_TYPES` is
uppercase (`:23-32`) — the two tuples shout in OPPOSITE directions, so the
narrowing has to fold toward each tuple's own casing rather than uppercasing
both.

**The consequence differs in kind, and it is the worse one.** `status` is an
ESSENTIAL field: a miss returns
`{ kind: 'excluded', excluded: { folderName, reason: 'invalid_status' } }` at
`task-frontmatter.ts:274`, so a carrier declaring `status: Backlog` does not
warn — it leaves the board entirely, along with everything the board feeds. A
`type` miss only costs a badge and raises the amber triangle.

**Not yet fired.** A sweep of every `status:` line under `.ptah/specs` returns
only the six lowercase members, so no task is invisible today. That is luck of
convention, not a guard: `type` shows what happens once hand-authoring drifts,
and it drifted sixteen times.

**Decision: normalize both**, through one shared helper
(`libs/backend/task-specs/src/lib/task-enum-narrowing.ts`) that the parser and
the doctor now both call. A genuinely unrecognised value keeps its old
behaviour exactly — `invalid_type` warns, `invalid_status` still excludes.

**Postscript, unplanned.** By the time the fix landed, eight carriers newer than
the audited sixteen (`256`–`263`) had already been hand-authored with lowercase
types. They were left as written: they parse correctly now, and they are the
plainest evidence that a shouting convention was never going to hold on its own.
